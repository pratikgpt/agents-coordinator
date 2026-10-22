"use client";

import { useState, type ReactNode } from "react";
import { FlaskConical, Pause, Play, RotateCcw, StepForward, XCircle } from "lucide-react";
import type { Faults, RunView, StepRow } from "@/lib/orchestrator";
import type { CompanyRules, Fact, IntakeOutput, PlanOutput, ReviewIssue, ReviewOutput } from "@/lib/schemas";
import { Button, Card, JsonBlock, SimulatedTag, STATUS, StatusIcon, StatusPill } from "./ui";
import { ExchangeTab, FactsTab, LogTab, PlanTab } from "./RunTabs";
import { AGENTS, agentName, splitSimulated, type AgentKey } from "./labels";


const FAULTS: [keyof Faults, string][] = [
  ["fail_intake", "Fail the next Intake call"],
  ["fail_planning", "Fail the next Planning call"],
  ["fail_review", "Fail the next Review call"],
  ["rule_violation", "Planning's first draft ignores rule R2"],
];

type Tab = "plan" | "facts" | "exchange" | "log";

export function RunPanel({
  view,
  driving,
  onRun,
  onStop,
  onCorrect,
  onFaults,
}: {
  view: RunView;
  driving: boolean;
  onRun: (all: boolean) => void;
  onStop: () => void;
  onCorrect: (factId: string, text: string) => Promise<void>;
  onFaults: (faults: Faults) => void;
}) {
  const [tab, setTab] = useState<Tab>("plan");
  const [inspect, setInspect] = useState<AgentKey | null>(null);
  const finished = view.status === "approved" || view.status === "needs_attention";
  const facts = view.versions.at(-1)?.facts.length ?? 0;

  const tabs: [Tab, string, string, number | null][] = [
    ["plan", "Plan", "Plan", null],
    ["facts", "Source facts", "Facts", facts || null],
    ["exchange", "Agent exchange", "Exchange", null],
    ["log", "Action log", "Log", null],
  ];

  return (
    <div className="space-y-4">
      <Header view={view} driving={driving} finished={finished} onRun={onRun} onStop={onStop} onFaults={onFaults} />
      <Pipeline view={view} inspect={inspect} onInspect={(a) => setInspect(inspect === a ? null : a)} />

      <div>
        <div role="tablist" className="flex gap-1 border-b border-slate-200">
          {tabs.map(([k, label, short, count]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium ${tab === k ? "border-teal-700 text-slate-900" : "border-transparent text-slate-600 hover:text-slate-900"}`}
            >
              <span className="sm:hidden">{short}</span>
              <span className="hidden sm:inline">{label}</span>
              {count != null && <span className="rounded-full bg-slate-100 px-1.5 text-xs text-slate-600 tabular-nums">{count}</span>}
            </button>
          ))}
        </div>
        <div className="pt-4">
          {tab === "plan" && <PlanTab view={view} />}
          {tab === "facts" && <FactsTab view={view} onCorrect={onCorrect} disabled={driving || view.status === "running"} />}
          {tab === "exchange" && <ExchangeTab view={view} />}
          {tab === "log" && <LogTab view={view} />}
        </div>
      </div>
    </div>
  );
}

// ---------- Header: what this run is, where it stands, what you can do ----------

function Header({
  view,
  driving,
  finished,
  onRun,
  onStop,
  onFaults,
}: {
  view: RunView;
  driving: boolean;
  finished: boolean;
  onRun: (all: boolean) => void;
  onStop: () => void;
  onFaults: (f: Faults) => void;
}) {
  const calls = view.steps.reduce((n, s) => n + (s.usage?.calls ?? 0), 0);
  const cv = view.run.current_version;
  const next = view.next.kind === "step" ? view.next : null;
  const failed = view.status === "failed" && next ? view.steps.find((s) => s.status === "failed" && s.agent === next.agent) : undefined;
  // The R2 fault only applies to the first draft; once that exists it is history, not "armed".
  const firstDraft = view.steps.some((s) => s.step_key === "planning:v1:r1" && s.status !== "failed");
  const r2Used = Boolean(view.run.faults.rule_violation) && firstDraft;
  const armed = FAULTS.filter(([k]) => view.run.faults[k] && !(k === "rule_violation" && firstDraft));
  const status = driving && view.status !== "failed" ? "running" : view.status;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1 basis-80">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={status} />
            {r2Used && <SimulatedTag>Simulated R2 fault in draft 1</SimulatedTag>}
          </div>
          <h1 className="mt-2.5 text-lg font-semibold leading-snug text-balance text-slate-900">{view.run.title}</h1>
          <p className="mt-1 text-[13px] text-slate-600">
            Run <span className="font-mono">{view.run.id.slice(0, 8)}</span> · {new Date(view.run.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
            {calls > 0 && ` · ${calls} model call${calls === 1 ? "" : "s"} · $${view.cost_usd.toFixed(2)}`}
            {cv > 1 && ` · facts corrected (context v${cv})`}
          </p>
        </div>

        {!finished && (
          <div className="flex flex-wrap items-center gap-2">
            {driving ? (
              <Button onClick={onStop}>
                <Pause className="size-4" /> Pause after this step
              </Button>
            ) : (
              <>
                <FaultMenu view={view} onFaults={onFaults} />
                <Button variant="ghost" onClick={() => onRun(false)} disabled={view.status === "running"}>
                  <StepForward className="size-4" /> One step
                </Button>
                <Button variant="primary" onClick={() => onRun(true)} disabled={view.status === "running"}>
                  {view.status === "failed" ? <RotateCcw className="size-4" /> : <Play className="size-4" />}
                  {view.status === "failed" ? `Retry ${next ? agentName(next.agent) : ""}` : view.status === "new" ? "Start run" : "Continue"}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {failed?.error && <FailureCallout step={failed} />}
      {!finished && armed.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-amber-400 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          <SimulatedTag>Simulated fault armed</SimulatedTag>
          {armed.map(([, label]) => label).join(" · ")}
        </div>
      )}
      <Outcome view={view} />
    </Card>
  );
}

function FailureCallout({ step }: { step: StepRow }) {
  const { simulated, text } = splitSimulated(step.error ?? "");
  return (
    <div className="mt-4 flex gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
      <XCircle className="mt-0.5 size-4 shrink-0 text-rose-700" />
      <div>
        <div className="flex flex-wrap items-center gap-2 font-medium">
          {agentName(step.agent)} failed on attempt {step.attempts}
          {simulated && <SimulatedTag />}
        </div>
        <p className="mt-0.5 text-rose-800">{text}</p>
        <p className="mt-1 text-[13px] text-rose-800">Completed steps are saved. Retrying runs {agentName(step.agent)} only.</p>
      </div>
    </div>
  );
}

function FaultMenu({ view, onFaults }: { view: RunView; onFaults: (f: Faults) => void }) {
  const f = view.run.faults;
  return (
    <details className="group relative">
      <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 [&::-webkit-details-marker]:hidden">
        <FlaskConical className="size-4" /> Simulate failure
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
        <p className="mb-2 text-xs text-slate-600">Injected faults are labelled as simulated everywhere they appear.</p>
        {FAULTS.map(([k, label]) => (
          <label key={k} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm text-slate-800 hover:bg-slate-50">
            <input type="checkbox" checked={Boolean(f[k])} onChange={() => onFaults({ ...f, [k]: !f[k] })} className="size-4 accent-amber-600" />
            {label}
          </label>
        ))}
      </div>
    </details>
  );
}

/** The plan's bottom line, so "approved" is never read as "nothing left to decide". */
function Outcome({ view }: { view: RunView }) {
  const plan = view.plan as PlanOutput | null;
  const review = view.review as ReviewOutput | null;
  if (!plan) return null;
  const tasks = plan.tasks;
  const noOwner = tasks.filter((t) => !t.owner).length;
  const noDate = tasks.filter((t) => !t.deadline).length;
  const undecided = tasks.filter((t) => !t.owner || !t.deadline).length;
  const blocking = review?.issues.filter((i) => i.severity === "blocking").length ?? 0;

  const headline =
    view.status === "approved"
      ? undecided
        ? `The Review Agent found no rule violations or unsupported claims. ${undecided} of ${tasks.length} tasks still need someone to decide an owner or date.`
        : "The Review Agent found no rule violations or unsupported claims, and every task has an owner and a date."
      : view.status === "needs_attention"
        ? `Still ${blocking} blocking issue${blocking === 1 ? "" : "s"} after ${view.run.max_rounds} review rounds. A person needs to resolve ${blocking === 1 ? "it" : "them"}.`
        : `Showing draft ${view.plan_round}. Review is not finished yet.`;

  const stats: [number, string, boolean][] = [
    [tasks.length, "tasks", false],
    [noOwner, "need an owner", noOwner > 0],
    [noDate, "need a date", noDate > 0],
    [plan.open_questions.length, "open questions", plan.open_questions.length > 0],
  ];
  return (
    <div className="mt-5 border-t border-slate-100 pt-4">
      <p className="text-sm text-slate-700">{headline}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map(([value, label, warn]) => (
          <div key={label} className={`rounded-lg px-3 py-2.5 ${warn ? "bg-amber-50" : "bg-slate-50"}`}>
            <dd className={`text-xl font-semibold tabular-nums ${warn ? "text-amber-800" : "text-slate-900"}`}>{value}</dd>
            <dt className={`text-xs ${warn ? "text-amber-800" : "text-slate-600"}`}>{label}</dt>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ---------- Pipeline: each agent's status, and what it received and produced ----------

function latestStep(view: RunView, agent: AgentKey): StepRow | undefined {
  const cv = view.run.current_version;
  return [...view.steps].reverse().find((s) => s.agent === agent && (agent === "intake" || s.context_version === cv));
}

function stepStatus(view: RunView, agent: AgentKey, step: StepRow | undefined) {
  if (step) return step.status;
  return view.next.kind === "step" && view.next.agent === agent ? "waiting" : "idle";
}

function Pipeline({ view, inspect, onInspect }: { view: RunView; inspect: AgentKey | null; onInspect: (a: AgentKey) => void }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Agents</h2>
        <p className="text-xs text-slate-600">
          Intake → Planning ⇄ Review, up to {view.run.max_rounds} review rounds. Select an agent to see its input and output.
        </p>
      </div>
      <div className="grid grid-cols-3 divide-x divide-slate-100">
        {AGENTS.map((a) => {
          const step = latestStep(view, a.key);
          const status = stepStatus(view, a.key, step);
          const selected = inspect === a.key;
          return (
            <button
              key={a.key}
              onClick={() => onInspect(a.key)}
              aria-expanded={selected}
              className={`min-w-0 p-3 text-left transition sm:p-4 ${selected ? "bg-teal-50/70 shadow-[inset_0_-2px_0_var(--color-teal-700)]" : "hover:bg-slate-50"}`}
            >
              <div className="flex items-center gap-2">
                <StatusIcon status={status} />
                <span className="text-sm font-semibold text-slate-900">{a.name}</span>
              </div>
              <div className="mt-1 text-xs text-slate-600">
                {STATUS[status]?.label}
                {step && a.key !== "intake" && ` · round ${step.round}`}
                {step && step.attempts > 1 && ` · attempt ${step.attempts}`}
              </div>
              <div className="mt-2 hidden text-[13px] text-slate-800 sm:block">{step?.output != null ? headlineFor(a.key, step, view) : " "}</div>
            </button>
          );
        })}
      </div>
      {inspect && <AgentDetail view={view} agent={inspect} step={latestStep(view, inspect)} />}
    </Card>
  );
}

function headlineFor(agent: AgentKey, step: StepRow, view: RunView): string {
  if (agent === "intake") {
    const o = step.output as IntakeOutput;
    return `${o.facts.length} facts · ${o.issues.length} flags`;
  }
  if (agent === "planning") {
    const o = step.output as PlanOutput;
    return `${o.tasks.length} tasks · ${o.open_questions.length} open questions`;
  }
  const o = step.output as ReviewOutput;
  const blocking = o.issues.filter((i) => i.severity === "blocking").length;
  if (o.approved) return "Approved";
  return step.round < view.run.max_rounds ? `${blocking} blocking → Planning` : `${blocking} blocking → you`;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function describe(agent: AgentKey, step: StepRow, maxRounds: number): { received: ReactNode[]; produced: ReactNode[]; note?: string } {
  if (agent === "intake") {
    const i = step.input as { transcript: string; rules: CompanyRules };
    const o = step.output as IntakeOutput | null;
    const by = (k: string) => o?.facts.filter((f) => f.kind === k).length ?? 0;
    return {
      received: [
        `Meeting transcript, ${count(i.transcript.split("\n").length, "line")}`,
        `Calendar and roster: ${count(i.rules.roster.length, "person", "people")}, ${count(i.rules.holidays.length, "holiday")}`,
      ],
      produced: o
        ? [
            `${count(o.facts.length, "fact")} (${by("decision")} decisions, ${by("requirement")} requirements, ${by("constraint")} constraints), each quoting its transcript line`,
            `${count(o.issues.length, "issue")} flagged: ${o.issues.filter((x) => x.kind === "conflict").length} conflicts, ${o.issues.filter((x) => x.kind === "missing").length} missing`,
          ]
        : [],
    };
  }
  if (agent === "planning") {
    const i = step.input as { facts: Fact[]; issues: unknown[]; rules: CompanyRules; corrections: ReviewIssue[]; simulate_rule_violation: boolean };
    const o = step.output as PlanOutput | null;
    return {
      received: [
        `${count(i.facts.length, "fact")} and ${count(i.issues.length, "flagged issue")} from Intake`,
        `${count(i.rules.rules.length, "company rule")} and a roster of ${i.rules.roster.length}`,
        ...(i.corrections.length ? [`${count(i.corrections.length, "correction")} from Review, with its previous draft`] : []),
        ...(i.simulate_rule_violation
          ? [
              <span key="sim" className="inline-flex flex-wrap items-center gap-1.5">
                <SimulatedTag /> instruction to ignore rule R2
              </span>,
            ]
          : []),
      ],
      produced: o
        ? [
            `${count(o.tasks.length, "task")} with owners, dates and dependencies`,
            `${count(o.recommendations.length, "recommendation")} and ${count(o.open_questions.length, "open question")}`,
            ...(o.changes_made.length ? [`${count(o.changes_made.length, "change")} made in response to Review`] : []),
          ]
        : [],
      note: "Planning never sees the transcript. It works only from Intake's facts.",
    };
  }
  const i = step.input as { facts: Fact[]; rules: CompanyRules; plan: PlanOutput };
  const o = step.output as ReviewOutput | null;
  const blocking = o?.issues.filter((x) => x.severity === "blocking") ?? [];
  const byCode = o?.issues.filter((x) => x.source === "deterministic").length ?? 0;
  return {
    received: [`Draft ${step.round}: ${count(i.plan.tasks.length, "task")}`, `The original transcript, ${count(i.rules.rules.length, "rule")} and ${count(i.facts.length, "current fact")}`],
    produced: o
      ? [
          o.approved
            ? "Approved: no blocking issues"
            : `${count(blocking.length, "blocking issue")}, ${step.round < maxRounds ? "sent back to Planning" : "surfaced to you (round limit reached)"}`,
          `${count(o.issues.length, "finding")} in total, ${byCode} from code rule checks`,
          <span key="sum" className="text-slate-600">
            “{o.summary}”
          </span>,
        ]
      : [],
  };
}

function AgentDetail({ view, agent, step }: { view: RunView; agent: AgentKey; step: StepRow | undefined }) {
  if (!step) {
    return <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-4 text-sm text-slate-600">{agentName(agent)} has not run yet for this context version.</div>;
  }
  const d = describe(agent, step, view.run.max_rounds);
  const secs = step.finished_at ? Math.round((+new Date(step.finished_at) - +new Date(step.started_at)) / 1000) : null;
  const meta = [
    `attempt ${step.attempts}`,
    secs != null && `${secs}s`,
    step.usage && `${(step.usage.prompt_tokens + step.usage.completion_tokens).toLocaleString()} tokens`,
    step.usage?.cost_usd != null && `$${step.usage.cost_usd.toFixed(3)}`,
    step.usage?.model,
  ].filter(Boolean);

  return (
    <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-4">
      <div className="grid gap-5 md:grid-cols-2">
        <Section title="Received">{d.received}</Section>
        <Section title="Produced">{d.produced.length ? d.produced : [step.status === "running" ? "Working…" : "No output"]}</Section>
      </div>
      {d.note && <p className="mt-3 text-xs text-slate-600">{d.note}</p>}
      <div className="mt-4 space-y-1.5 border-t border-slate-200/70 pt-3">
        <p className="text-xs text-slate-600">{meta.join(" · ")}</p>
        <JsonBlock label="Raw input" value={step.input} />
        {step.output != null && <JsonBlock label="Raw output" value={step.output} />}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</h3>
      <ul className="mt-2 space-y-1.5 text-sm text-slate-800">
        {children.map((c, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-slate-400" />
            <span>{c}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
