import type postgres from "postgres";
import { sql, json, ensureSchema } from "./db";
import { runIntake, runPlanning, runReview, type IntakeInput, type PlanningInput, type ReviewInput } from "./agents";
import { SimulatedFault, type Usage } from "./llm";
import {
  Handoffs,
  type AgentName,
  type CompanyRules,
  type Fact,
  type HandoffKind,
  type IntakeOutput,
  type PlanOutput,
  type ReviewOutput,
} from "./schemas";

export class NotFoundError extends Error {}

export interface Faults {
  fail_intake?: boolean;
  fail_planning?: boolean;
  fail_review?: boolean;
  rule_violation?: boolean;
}

export interface RunRow {
  id: string;
  session_id: string;
  transcript: string;
  rules: CompanyRules;
  current_version: number;
  max_rounds: number;
  faults: Faults;
  created_at: string;
}

export type StepStatus = "running" | "succeeded" | "failed" | "superseded";

export interface StepRow {
  id: string;
  step_key: string;
  agent: AgentName;
  context_version: number;
  round: number;
  status: StepStatus;
  attempts: number;
  input: unknown;
  output: unknown;
  error: string | null;
  usage: Usage | null;
  started_at: string;
  finished_at: string | null;
}

export interface ContextVersion {
  version: number;
  reason: string;
  facts: Fact[];
  issues: IntakeOutput["issues"];
  created_at: string;
}

export type Action =
  | { kind: "step"; agent: AgentName; version: number; round: number }
  | { kind: "done"; approved: boolean; version: number; round: number };

export const stepKey = (agent: AgentName, version: number, round: number) =>
  agent === "intake" ? "intake" : `${agent}:v${version}:r${round}`;

/**
 * Pure function of persisted state: which step should run next. Because it only looks at
 * succeeded steps for the current context version, resuming never repeats completed work and
 * a fact correction (new version) automatically reruns Planning/Review but not Intake.
 */
export function nextAction(
  steps: Pick<StepRow, "step_key" | "status" | "output">[],
  currentVersion: number,
  maxRounds: number,
): Action {
  const done = new Map(steps.filter((s) => s.status === "succeeded").map((s) => [s.step_key, s]));
  if (currentVersion === 0 || !done.has("intake")) return { kind: "step", agent: "intake", version: 0, round: 1 };
  for (let round = 1; round <= maxRounds; round++) {
    if (!done.has(stepKey("planning", currentVersion, round)))
      return { kind: "step", agent: "planning", version: currentVersion, round };
    const review = done.get(stepKey("review", currentVersion, round));
    if (!review) return { kind: "step", agent: "review", version: currentVersion, round };
    if ((review.output as ReviewOutput).approved) return { kind: "done", approved: true, version: currentVersion, round };
  }
  return { kind: "done", approved: false, version: currentVersion, round: maxRounds };
}

// ---------- Session-scoped reads (every query is filtered by session id) ----------

async function getRun(sessionId: string, runId: string): Promise<RunRow> {
  await ensureSchema();
  if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new NotFoundError("Run not found");
  const [run] = await sql<RunRow[]>`select * from runs where id = ${runId} and session_id = ${sessionId}`;
  if (!run) throw new NotFoundError("Run not found");
  return run;
}

export async function ensureSession(sessionId: string) {
  await ensureSchema();
  await sql`insert into sessions (id) values (${sessionId}) on conflict do nothing`;
}

export async function listRuns(sessionId: string) {
  await ensureSchema();
  return sql`
    select r.id, r.created_at, r.current_version,
      (select count(*)::int from steps s where s.run_id = r.id) as step_count
    from runs r where r.session_id = ${sessionId} order by r.created_at desc`;
}

export async function createRun(sessionId: string, transcript: string, rules: CompanyRules, faults: Faults) {
  await ensureSession(sessionId);
  const maxRounds = Math.min(Math.max(Number(process.env.MAX_REVIEW_ROUNDS) || 3, 1), 5);
  const [run] = await sql<{ id: string }[]>`
    insert into runs (session_id, transcript, rules, faults, max_rounds)
    values (${sessionId}, ${transcript}, ${json(rules)}, ${json(faults)}, ${maxRounds})
    returning id`;
  await logEvent(sql, run.id, "info", `Run created (max ${maxRounds} review rounds)`);
  return run.id;
}

export async function setFaults(sessionId: string, runId: string, faults: Faults) {
  await getRun(sessionId, runId);
  await sql`update runs set faults = ${json(faults)} where id = ${runId}`;
  const on = Object.entries(faults).filter(([, v]) => v).map(([k]) => k);
  await logEvent(sql, runId, "warn", on.length ? `Simulated faults armed: ${on.join(", ")}` : "Simulated faults cleared");
}

export async function resetSession(sessionId: string) {
  await ensureSchema();
  await sql`delete from runs where session_id = ${sessionId}`;
}

export async function getRunView(sessionId: string, runId: string) {
  const run = await getRun(sessionId, runId);
  const [versions, steps, messages, events] = await Promise.all([
    sql<ContextVersion[]>`select version, reason, facts, issues, created_at from context_versions where run_id = ${runId} order by version`,
    sql<StepRow[]>`select * from steps where run_id = ${runId} order by started_at, step_key`,
    sql`select id, kind, from_agent, to_agent, context_version, payload, created_at from messages where run_id = ${runId} order by id`,
    sql`select id, level, text, created_at from events where run_id = ${runId} order by id`,
  ]);
  const action = nextAction(steps, run.current_version, run.max_rounds);
  const live = (s: StepRow) => s.agent === "intake" || s.context_version === run.current_version;
  const pending = action.kind === "step" ? steps.find((s) => s.step_key === stepKey(action.agent, action.version, action.round)) : undefined;

  let status: "new" | "ready" | "running" | "failed" | "approved" | "needs_attention";
  if (steps.some((s) => s.status === "running" && live(s))) status = "running";
  else if (action.kind === "done") status = action.approved ? "approved" : "needs_attention";
  else if (pending?.status === "failed") status = "failed";
  else status = steps.length ? "ready" : "new";

  const current = steps.filter((s) => live(s) && s.status === "succeeded" && s.agent !== "intake");
  const latestPlan = [...current].reverse().find((s) => s.agent === "planning");
  const latestReview = [...current].reverse().find((s) => s.agent === "review");
  const cost = steps.reduce((sum, s) => sum + (s.usage?.cost_usd ?? 0), 0);

  return {
    run: { id: run.id, created_at: run.created_at, current_version: run.current_version, max_rounds: run.max_rounds, faults: run.faults, transcript: run.transcript, rules: run.rules },
    status,
    next: action,
    versions,
    steps,
    messages,
    events,
    plan: (latestPlan?.output as PlanOutput | undefined) ?? null,
    plan_round: latestPlan?.round ?? null,
    review: (latestReview?.output as ReviewOutput | undefined) ?? null,
    cost_usd: cost,
  };
}
export type RunView = Awaited<ReturnType<typeof getRunView>>;

// ---------- Writes ----------

type Sql = postgres.Sql | postgres.TransactionSql;

async function logEvent(db: Sql, runId: string, level: "info" | "warn" | "error", text: string) {
  await db`insert into events (run_id, level, text) values (${runId}, ${level}, ${text})`;
}

/** Validates a handoff against its schema before persisting it; an invalid handoff aborts the transaction. */
async function handoff(db: Sql, runId: string, kind: HandoffKind, version: number, payload: unknown) {
  const parsed = Handoffs[kind].safeParse(payload);
  if (!parsed.success) throw new Error(`Handoff ${kind} failed validation: ${parsed.error.message}`);
  const [from, to] = kind.split("->");
  await db`insert into messages (run_id, kind, from_agent, to_agent, context_version, payload)
           values (${runId}, ${kind}, ${from}, ${to}, ${version}, ${json(parsed.data)})`;
}

async function buildInput(run: RunRow, action: Extract<Action, { kind: "step" }>): Promise<IntakeInput | PlanningInput | ReviewInput> {
  if (action.agent === "intake") return { transcript: run.transcript, rules: run.rules };

  const [ctx] = await sql<ContextVersion[]>`select * from context_versions where run_id = ${run.id} and version = ${action.version}`;
  const prior = async <T>(agent: AgentName, round: number) => {
    const [row] = await sql<{ output: T }[]>`
      select output from steps where run_id = ${run.id} and step_key = ${stepKey(agent, action.version, round)} and status = 'succeeded'`;
    return row?.output;
  };

  if (action.agent === "planning") {
    const prevPlan = action.round > 1 ? await prior<PlanOutput>("planning", action.round - 1) : undefined;
    const prevReview = action.round > 1 ? await prior<ReviewOutput>("review", action.round - 1) : undefined;
    return {
      context_version: action.version,
      round: action.round,
      facts: ctx.facts,
      issues: ctx.issues,
      rules: run.rules,
      previous_plan: prevPlan ?? null,
      corrections: prevReview?.issues.filter((i) => i.severity === "blocking") ?? [],
      simulate_rule_violation: Boolean(run.faults.rule_violation) && action.version === 1 && action.round === 1,
    };
  }

  const plan = await prior<PlanOutput>("planning", action.round);
  if (!plan) throw new Error(`Review needs planning round ${action.round}, which has not succeeded`);
  return { context_version: action.version, round: action.round, transcript: run.transcript, rules: run.rules, facts: ctx.facts, plan };
}

/** Atomically consumes a one-shot simulated fault so it fires exactly once. */
async function consumeFault(runId: string, key: keyof Faults): Promise<boolean> {
  const rows = await sql`
    update runs set faults = faults - ${key}::text
    where id = ${runId} and (faults ->> ${key}::text)::boolean is true
    returning id`;
  return rows.length > 0;
}

export type AdvanceResult = { outcome: "ran" | "busy" | "done" | "failed"; error?: string };

/** Executes exactly one step (the next one), so each HTTP request stays short and resumable. */
export async function advanceRun(sessionId: string, runId: string): Promise<AdvanceResult> {
  const run = await getRun(sessionId, runId);
  const steps = await sql<StepRow[]>`select step_key, status, output from steps where run_id = ${runId}`;
  const action = nextAction(steps, run.current_version, run.max_rounds);
  if (action.kind === "done") return { outcome: "done" };

  const { agent, version, round } = action;
  const input = await buildInput(run, action);

  // Claim the step. Succeeded steps are never re-claimed; failed ones (or ones stuck running
  // after a crashed request) can be retried, incrementing attempts.
  const [claimed] = await sql<{ id: string; attempts: number }[]>`
    insert into steps (run_id, step_key, agent, context_version, round, status, input)
    values (${runId}, ${stepKey(agent, version, round)}, ${agent}, ${version}, ${round}, 'running', ${json(input)})
    on conflict (run_id, step_key) do update
      set status = 'running', attempts = steps.attempts + 1, error = null, input = excluded.input,
          started_at = now(), finished_at = null
      where steps.status = 'failed' or (steps.status = 'running' and steps.started_at < now() - interval '5 minutes')
    returning id, attempts`;
  if (!claimed) return { outcome: "busy" };

  const label = agent === "intake" ? "Intake" : `${agent === "planning" ? "Planning" : "Review"} (v${version}, round ${round})`;
  await logEvent(sql, runId, "info", `${label} started, attempt ${claimed.attempts}`);

  try {
    if (await consumeFault(runId, `fail_${agent}`)) {
      throw new SimulatedFault(`[SIMULATED FAULT] ${agent} model call failed (injected from the UI)`);
    }
    const result =
      agent === "intake"
        ? await runIntake(input as IntakeInput)
        : agent === "planning"
          ? await runPlanning(input as PlanningInput)
          : await runReview(input as ReviewInput);

    await sql.begin(async (tx) => {
      const [cur] = await tx<{ current_version: number }[]>`select current_version from runs where id = ${runId} for update`;
      if (agent !== "intake" && cur.current_version !== version) {
        // A fact was corrected while this step ran: keep the output for audit but never hand it on.
        await tx`update steps set status = 'superseded', output = ${json(result.data)}, usage = ${json(result.usage)}, finished_at = now() where id = ${claimed.id}`;
        await logEvent(tx, runId, "warn", `${label} finished after context moved to v${cur.current_version}; output discarded as stale`);
        return;
      }
      await tx`update steps set status = 'succeeded', output = ${json(result.data)}, usage = ${json(result.usage)}, finished_at = now() where id = ${claimed.id}`;

      if (agent === "intake") {
        const out = result.data as IntakeOutput;
        await tx`insert into context_versions (run_id, version, reason, facts, issues)
                 values (${runId}, 1, 'Extracted by Intake Agent', ${json(out.facts)}, ${json(out.issues)})`;
        await tx`update runs set current_version = 1 where id = ${runId}`;
        await handoff(tx, runId, "intake->planning", 1, { context_version: 1, facts: out.facts, issues: out.issues });
      } else if (agent === "planning") {
        await handoff(tx, runId, "planning->review", version, { context_version: version, round, plan: result.data });
      } else {
        const review = result.data as ReviewOutput;
        const blocking = review.issues.filter((i) => i.severity === "blocking");
        if (review.approved) {
          await handoff(tx, runId, "review->user", version, { context_version: version, round, approved: true, unresolved: [] });
        } else if (round < run.max_rounds) {
          await handoff(tx, runId, "review->planning", version, { context_version: version, round, issues: blocking });
        } else {
          await handoff(tx, runId, "review->user", version, { context_version: version, round, approved: false, unresolved: blocking });
        }
      }
      const cost = result.usage.cost_usd == null ? "" : `, $${result.usage.cost_usd.toFixed(4)}`;
      await logEvent(tx, runId, "info", `${label} succeeded (${result.usage.prompt_tokens}+${result.usage.completion_tokens} tokens${cost})`);
    });
    return { outcome: "ran" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await sql`update steps set status = 'failed', error = ${message}, finished_at = now() where id = ${claimed.id}`;
    await logEvent(sql, runId, e instanceof SimulatedFault ? "warn" : "error", `${label} failed: ${message}`);
    return { outcome: "failed", error: message };
  }
}

/** A user correction creates a new context version; downstream steps rerun against it, Intake does not. */
export async function correctFact(sessionId: string, runId: string, factId: string, text: string) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Corrected fact cannot be empty");
  await getRun(sessionId, runId);
  await sql.begin(async (tx) => {
    const [run] = await tx<{ current_version: number }[]>`select current_version from runs where id = ${runId} for update`;
    if (run.current_version === 0) throw new Error("Facts are not available until Intake has finished");
    const [ctx] = await tx<ContextVersion[]>`select * from context_versions where run_id = ${runId} and version = ${run.current_version}`;
    const fact = ctx.facts.find((f) => f.id === factId);
    if (!fact) throw new NotFoundError(`Fact ${factId} not found`);
    if (fact.text === trimmed) return;

    const next = run.current_version + 1;
    const facts = ctx.facts.map((f) => (f.id === factId ? { ...f, text: trimmed, corrected_by_user: true } : f));
    await tx`insert into context_versions (run_id, version, reason, facts, issues)
             values (${runId}, ${next}, ${`User corrected ${factId}`}, ${json(facts)}, ${json(ctx.issues)})`;
    await tx`update runs set current_version = ${next} where id = ${runId}`;
    await handoff(tx, runId, "user->planning", next, { context_version: next, fact_id: factId, before: fact.text, after: trimmed });
    await logEvent(tx, runId, "warn", `${factId} corrected by user; context v${next} created. Planning and Review will rerun; Intake output is reused.`);
  });
}
