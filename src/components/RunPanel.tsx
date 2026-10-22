"use client";

import { useState } from "react";
import type { RunView, StepRow } from "@/lib/orchestrator";
import type { Fact, PlanOutput, ReviewIssue, ReviewOutput } from "@/lib/schemas";
import { Badge, Basis, BASIS_STYLE, Button, Card, JsonBlock, STATUS_TONE } from "./ui";

const AGENTS = [
  { key: "intake", name: "Intake Agent", short: "Intake", role: "Extracts grounded facts and flags gaps" },
  { key: "planning", name: "Planning Agent", short: "Planning", role: "Proposes tasks, owners, deadlines" },
  { key: "review", name: "Review Agent", short: "Review", role: "Checks plan vs transcript and rules" },
] as const;

type Tab = "plan" | "facts" | "collab" | "log";

export function RunPanel({
  view,
  driving,
  onRunNext,
  onRunAll,
  onStop,
  onCorrect,
  onFaults,
}: {
  view: RunView;
  driving: boolean;
  onRunNext: () => void;
  onRunAll: () => void;
  onStop: () => void;
  onCorrect: (factId: string, text: string) => Promise<void>;
  onFaults: (faults: RunView["run"]["faults"]) => void;
}) {
  const [tab, setTab] = useState<Tab>("plan");
  const finished = view.status === "approved" || view.status === "needs_attention";
  const cv = view.run.current_version;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-base font-semibold">Run {view.run.id.slice(0, 8)}</h2>
          <Badge tone={STATUS_TONE[view.status]}>{view.status.replace("_", " ")}</Badge>
          <span className="text-xs text-slate-500">
            {cv > 0 && (
              <>
                <span title="Context version: bumps whenever a source fact is corrected">context v{cv}</span>
                {" · "}
              </>
            )}
            <span title={`$${view.cost_usd.toFixed(4)} across all model calls in this run`}>${view.cost_usd.toFixed(2)} model cost</span>
          </span>
          {(driving || !finished) && (
            <div className="ml-auto flex flex-wrap gap-2">
              {driving ? (
                <Button onClick={onStop}>Pause after this step</Button>
              ) : (
                <>
                  <Button onClick={onRunNext} disabled={view.status === "running"}>
                    {view.status === "failed" ? "Retry failed step" : "Run next step"}
                  </Button>
                  <Button variant="primary" onClick={onRunAll} disabled={view.status === "running"}>
                    {view.status === "failed" ? "Resume run" : view.status === "new" ? "Start run" : "Run to completion"}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
        {view.next.kind === "step" && !finished && (
          <p className="mt-2 text-xs text-slate-500">
            Next: <b>{view.next.agent}</b>
            {view.next.agent !== "intake" && ` · context v${view.next.version} · round ${view.next.round} of ${view.run.max_rounds}`}
          </p>
        )}
        <Outcome view={view} />
      </Card>

      <Pipeline view={view} />
      <FaultControls view={view} onFaults={onFaults} locked={finished || driving} />

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {(
          [
            ["plan", "Final plan", "Plan"],
            ["facts", `Source facts (v${cv})`, `Facts v${cv}`],
            ["collab", `Collaboration (${view.messages.length})`, `Collaboration (${view.messages.length})`],
            ["log", "Action log", "Log"],
          ] as [Tab, string, string][]
        ).map(([k, label, short]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-2.5 py-2 text-sm font-medium sm:px-3 ${tab === k ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            <span className="sm:hidden">{short}</span>
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {tab === "plan" && <PlanView view={view} />}
      {tab === "facts" && <FactsView view={view} onCorrect={onCorrect} />}
      {tab === "collab" && <Collaboration view={view} />}
      {tab === "log" && <EventLog view={view} />}
    </div>
  );
}

// The plan's bottom line, so "approved" is never read as "nothing left to decide".
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
        ? `Approved: no rule violations or invented facts. ${undecided} of ${tasks.length} tasks still need a human decision on owner or date.`
        : `Approved: no rule violations or invented facts, and every task has an owner and a date.`
      : view.status === "needs_attention"
        ? `Not approved after ${view.run.max_rounds} review rounds: ${blocking} blocking issue${blocking === 1 ? "" : "s"} need a human.`
        : `Draft plan from round ${view.plan_round}; review ${review ? "requested changes" : "pending"}.`;

  const stats: [number | string, string, boolean][] = [
    [tasks.length, "tasks", false],
    [noOwner, "need an owner", noOwner > 0],
    [noDate, "need a date", noDate > 0],
    [plan.open_questions.length, "open questions", plan.open_questions.length > 0],
    [`${view.plan_round ?? "–"} of ${view.run.max_rounds}`, "review rounds used", false],
  ];
  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <p className="text-sm text-slate-700">{headline}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {stats.map(([value, label, warn]) => (
          <div key={label} className={`rounded-lg px-3 py-2 ${warn ? "bg-amber-50" : "bg-slate-50"}`}>
            <dd className={`text-lg font-semibold tabular-nums ${warn ? "text-amber-800" : "text-slate-900"}`}>{value}</dd>
            <dt className={`text-xs ${warn ? "text-amber-800" : "text-slate-500"}`}>{label}</dt>
          </div>
        ))}
      </dl>
    </div>
  );
}

function latestStep(view: RunView, agent: string): StepRow | undefined {
  const cv = view.run.current_version;
  return [...view.steps].reverse().find((s) => s.agent === agent && (agent === "intake" || s.context_version === cv));
}

function Pipeline({ view }: { view: RunView }) {
  return (
    <div className="grid grid-cols-3 gap-2 md:gap-3">
      {AGENTS.map((a, i) => {
        const step = latestStep(view, a.key);
        const isNext = view.next.kind === "step" && view.next.agent === a.key;
        const status = step?.status === "running" ? "running" : step ? step.status : isNext ? "waiting" : "idle";
        const reused = a.key === "intake" && step?.status === "succeeded" && view.run.current_version > 1;
        return (
          <Card key={a.key} className={`relative min-w-0 p-3 md:p-4 ${status === "running" ? "ring-2 ring-sky-400" : ""}`}>
            {i < 2 && <span className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 text-slate-400 md:block">→</span>}
            <div className="flex flex-col items-start gap-1.5 md:flex-row md:justify-between md:gap-2">
              <div>
                <div className="text-sm font-semibold">
                  <span className="md:hidden">{a.short}</span>
                  <span className="hidden md:inline">{a.name}</span>
                </div>
                <div className="hidden text-xs text-slate-500 md:block">{a.role}</div>
              </div>
              <Badge tone={STATUS_TONE[status] ?? "gray"}>
                {status === "running" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />}
                {status}
              </Badge>
            </div>
            {step?.error && <div className="mt-2 rounded bg-rose-50 p-2 text-xs text-rose-800">{step.error}</div>}
            {step && (
              <div className="mt-3 hidden space-y-0.5 text-xs text-slate-600 md:block">
                <div>
                  {a.key !== "intake" && `v${step.context_version} · round ${step.round} · `}attempt {step.attempts}
                </div>
                {step.usage && (
                  <div className="tabular-nums">
                    {(step.usage.prompt_tokens + step.usage.completion_tokens).toLocaleString()} tokens
                    {step.usage.cost_usd != null && ` · $${step.usage.cost_usd.toFixed(3)}`}
                  </div>
                )}
                {step.usage && (
                  <div className="truncate font-mono text-[11px] text-slate-400" title={step.usage.model}>
                    {step.usage.model}
                  </div>
                )}
                {reused && <div className="text-emerald-700">Output reused for v{view.run.current_version} (only facts changed)</div>}
                <JsonBlock label="Input" value={step.input} />
                {step.output != null && <JsonBlock label="Output" value={step.output} />}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function FaultControls({ view, onFaults, locked }: { view: RunView; onFaults: (f: RunView["run"]["faults"]) => void; locked: boolean }) {
  const f = view.run.faults;
  const toggle = (k: keyof typeof f) => onFaults({ ...f, [k]: !f[k] });
  const items: [keyof typeof f, string][] = [
    ["fail_intake", "Fail next Intake call"],
    ["fail_planning", "Fail next Planning call"],
    ["fail_review", "Fail next Review call"],
    ["rule_violation", "First plan draft ignores R2 (v1, round 1 only)"],
  ];
  // Toggling has no effect while a step is executing or once the run is finished, so show what was armed instead.
  if (locked) {
    const armed = items.filter(([k]) => f[k]).map(([, label]) => label);
    if (!armed.length) return null;
    return (
      <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/60 px-4 py-2 text-xs text-amber-900">
        <span className="font-semibold">SIMULATED FAULT</span> armed in this run: {armed.join(", ")}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-dashed border-amber-300 bg-amber-50/60 px-4 py-2 text-xs">
      <span className="font-semibold text-amber-900">SIMULATED FAULTS</span>
      {items.map(([k, label]) => (
        <label key={k} className="flex cursor-pointer items-center gap-1.5 text-amber-900">
          <input type="checkbox" checked={Boolean(f[k])} onChange={() => toggle(k)} className="accent-amber-600" />
          {label}
        </label>
      ))}
    </div>
  );
}

function PlanView({ view }: { view: RunView }) {
  const plan = view.plan as PlanOutput | null;
  const review = view.review as ReviewOutput | null;
  if (!plan) return <Empty text="No plan yet for the current context version. Run the pipeline to produce one." />;
  const factText = new Map(view.versions.at(-1)?.facts.map((f) => [f.id, f.text]) ?? []);

  return (
    <div className="space-y-4">
      {review && <ReviewVerdict view={view} review={review} />}

      <Card className="overflow-x-auto">
        {/* Phones get one stacked card per task; the table needs ~760px. */}
        <ul className="divide-y divide-slate-100 md:hidden">
          {plan.tasks.map((t) => (
            <li key={t.id} className="p-3 text-sm">
              <div>
                <span className="mr-1 font-mono text-xs text-slate-400">{t.id}</span>
                {t.title}
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <div>
                  {t.owner ? (
                    <>
                      <div>{t.owner}</div>
                      <Basis basis={t.owner_basis} />
                    </>
                  ) : (
                    <Missing text="Needs owner" />
                  )}
                </div>
                <div>
                  {t.deadline ? (
                    <>
                      <div className="tabular-nums">{t.deadline}</div>
                      <Basis basis={t.deadline_basis} />
                    </>
                  ) : (
                    <Missing text="Needs date" />
                  )}
                </div>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {t.depends_on.length > 0 && `after ${t.depends_on.join(", ")} · `}
                <span className="font-mono">{[...t.source_fact_ids, ...t.rule_refs].join(" ")}</span>
              </div>
            </li>
          ))}
        </ul>
        <table className="hidden w-full min-w-[760px] text-left text-sm md:table">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Task</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Deadline</th>
              <th className="px-3 py-2">Depends on</th>
              <th className="px-3 py-2">Grounding</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {plan.tasks.map((t) => (
              <tr key={t.id} className="align-top">
                <td className="px-3 py-2">
                  <span className="mr-1 font-mono text-xs text-slate-400">{t.id}</span>
                  {t.title}
                </td>
                <td className="px-3 py-2">
                  {t.owner ? (
                    <>
                      <div>{t.owner}</div>
                      <Basis basis={t.owner_basis} />
                    </>
                  ) : (
                    <Missing text="Needs owner" />
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {t.deadline ? (
                    <>
                      <div className="tabular-nums">{t.deadline}</div>
                      <Basis basis={t.deadline_basis} />
                    </>
                  ) : (
                    <Missing text="Needs date" />
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{t.depends_on.join(", ") || "—"}</td>
                <td className="px-3 py-2 text-xs">
                  {t.source_fact_ids.map((id) => (
                    <span key={id} title={factText.get(id)} className="mr-1 cursor-help font-mono text-emerald-700 underline decoration-dotted">
                      {id}
                    </span>
                  ))}
                  {t.rule_refs.map((r) => (
                    <span key={r} className="mr-1 font-mono text-sky-700">
                      {r}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
          <span>Where each owner and date comes from:</span>
          {Object.entries(BASIS_STYLE).map(([k, s]) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
              <span className={s.text}>{k}</span> = {s.label}
            </span>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-violet-900">Recommendations (not decisions)</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {plan.recommendations.map((r) => (
              <li key={r.id}>
                {r.text}
                <div className="text-xs text-slate-500">{r.rationale}</div>
              </li>
            ))}
            {!plan.recommendations.length && <li className="text-slate-400">None</li>}
          </ul>
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-amber-900">Open questions</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {plan.open_questions.map((q) => (
              <li key={q.id}>
                {q.text}
                {q.blocking_task_ids.length > 0 && <div className="text-xs text-slate-500">blocks {q.blocking_task_ids.join(", ")}</div>}
              </li>
            ))}
            {!plan.open_questions.length && <li className="text-slate-400">None</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Missing({ text }: { text: string }) {
  return (
    <span title="Not agreed in the meeting, so left open rather than guessed" className="text-xs font-medium text-amber-700">
      {text}
    </span>
  );
}

function ReviewVerdict({ view, review }: { view: RunView; review: ReviewOutput }) {
  const [more, setMore] = useState(false);
  const notes = review.issues.length;
  return (
    <Card className={`p-4 ${review.approved ? "border-emerald-300" : "border-amber-300"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={review.approved ? "green" : "amber"}>{review.approved ? "Approved by Review Agent" : "Not approved"}</Badge>
        <span className="text-xs text-slate-500">
          plan round {view.plan_round} · context v{view.run.current_version}
        </span>
        <button onClick={() => setMore(!more)} className="ml-auto text-xs font-medium text-sky-700 hover:underline">
          {more ? "Show less" : review.approved && notes ? `Full review · ${notes} minor note${notes === 1 ? "" : "s"}` : "Full review"}
        </button>
      </div>
      <p className={`mt-2 text-sm text-slate-700 ${more ? "" : "line-clamp-2"}`}>{review.summary}</p>
      {view.status === "needs_attention" && (
        <div className="mt-3">
          <div className="text-sm font-semibold text-amber-900">Unresolved after {view.run.max_rounds} rounds — needs a human:</div>
          <IssueList issues={review.issues.filter((i) => i.severity === "blocking")} />
        </div>
      )}
      {more && review.approved && notes > 0 && <IssueList issues={review.issues} />}
    </Card>
  );
}

function IssueList({ issues }: { issues: ReviewIssue[] }) {
  return (
    <ul className="mt-2 space-y-2">
      {issues.map((i) => (
        <li key={i.id} className="rounded-lg bg-slate-50 p-2 text-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={i.severity === "blocking" ? "red" : "gray"}>{i.severity}</Badge>
            <Badge tone={i.source === "deterministic" ? "blue" : "violet"}>{i.source === "deterministic" ? "rule check" : "LLM review"}</Badge>
            {i.rule_ref && <span className="font-mono text-xs text-sky-700">{i.rule_ref}</span>}
            {i.task_id && <span className="font-mono text-xs text-slate-500">{i.task_id}</span>}
          </div>
          <div className="mt-1">{i.problem}</div>
          <div className="text-xs text-slate-600">→ {i.correction}</div>
        </li>
      ))}
    </ul>
  );
}

function FactsView({ view, onCorrect }: { view: RunView; onCorrect: (id: string, text: string) => Promise<void> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const current = view.versions.at(-1);
  if (!current) return <Empty text="Facts appear once the Intake Agent has run." />;

  const save = async (f: Fact) => {
    setSaving(true);
    try {
      await onCorrect(f.id, draft);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Correcting a fact creates context v{current.version + 1}. Planning and Review rerun against the new version; Intake output is reused, and any
        in-flight step from an older version is discarded as stale.
      </p>
      <Card className="divide-y divide-slate-100">
        {current.facts.map((f) => (
          <div key={f.id} className="p-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-slate-400">{f.id}</span>
              <Badge tone={f.kind === "decision" ? "green" : f.kind === "requirement" ? "blue" : "gray"}>{f.kind}</Badge>
              {f.corrected_by_user && <Badge tone="amber">corrected by user</Badge>}
              {editing !== f.id && (
                <button
                  className="ml-auto text-xs text-sky-700 hover:underline"
                  onClick={() => {
                    setEditing(f.id);
                    setDraft(f.text);
                  }}
                >
                  Correct
                </button>
              )}
            </div>
            {editing === f.id ? (
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input value={draft} onChange={(e) => setDraft(e.target.value)} className="flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                <div className="flex gap-2">
                  <Button variant="primary" disabled={saving || !draft.trim()} onClick={() => save(f)}>
                    Save &amp; rerun
                  </Button>
                  <Button onClick={() => setEditing(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="mt-1 text-sm">{f.text}</div>
            )}
            <div className="mt-1 text-xs text-slate-500">
              line {f.source.lines.join(", ")}: “{f.source.quote}”
            </div>
          </div>
        ))}
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold">Flagged by Intake: missing or conflicting information</h3>
        <ul className="mt-2 space-y-1.5 text-sm">
          {current.issues.map((i) => (
            <li key={i.id} className="flex gap-2">
              <Badge tone={i.kind === "conflict" ? "red" : "amber"}>{i.kind}</Badge>
              <span>
                {i.text} <span className="text-xs text-slate-400">{i.related_fact_ids.join(", ")}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {view.versions.length > 1 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold">Context versions</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {view.versions.map((v) => (
              <li key={v.version}>
                <span className="font-mono text-xs">v{v.version}</span> · {v.reason}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

const MESSAGE_LABEL: Record<string, string> = {
  "intake->planning": "Intake → Planning: source facts handed off",
  "planning->review": "Planning → Review: plan submitted",
  "review->planning": "Review → Planning: corrections requested",
  "review->user": "Review → User: final verdict",
  "user->planning": "User → Planning: fact corrected",
};

function Collaboration({ view }: { view: RunView }) {
  type Item = { at: string; key: string; node: React.ReactNode };
  const items: Item[] = [
    ...view.steps.map((s) => ({
      at: s.started_at,
      key: `s${s.id}`,
      node: (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium capitalize">{s.agent}</span>
          {s.agent !== "intake" && (
            <span className="text-xs text-slate-500">
              v{s.context_version} · round {s.round}
            </span>
          )}
          <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
          {s.attempts > 1 && <Badge tone="amber">attempt {s.attempts}</Badge>}
          {s.error && <span className="text-xs text-rose-700">{s.error}</span>}
        </div>
      ),
    })),
    ...view.messages.map((m: RunView["messages"][number]) => ({
      at: m.created_at as string,
      key: `m${m.id}`,
      node: (
        <div>
          <div className="flex items-center gap-2 text-sm">
            <Badge tone={m.kind === "review->planning" ? "red" : m.kind === "user->planning" ? "amber" : "blue"}>handoff</Badge>
            <span className="font-medium">{MESSAGE_LABEL[m.kind as string] ?? m.kind}</span>
            <span className="text-xs text-slate-500">v{m.context_version} · schema-validated</span>
          </div>
          {m.kind === "review->planning" && <IssueList issues={(m.payload as { issues: ReviewIssue[] }).issues} />}
          {m.kind === "user->planning" && (
            <div className="mt-1 text-xs text-slate-600">
              {(m.payload as { fact_id: string }).fact_id}: “{(m.payload as { before: string }).before}” → “{(m.payload as { after: string }).after}”
            </div>
          )}
          <JsonBlock label="Payload" value={m.payload} />
        </div>
      ),
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  if (!items.length) return <Empty text="Agent steps and handoff messages will appear here." />;
  return (
    <Card className="divide-y divide-slate-100">
      {items.map((i) => (
        <div key={i.key} className="p-3">
          <div className="mb-1 text-[11px] text-slate-400">{new Date(i.at).toLocaleTimeString()}</div>
          {i.node}
        </div>
      ))}
    </Card>
  );
}

function EventLog({ view }: { view: RunView }) {
  return (
    <Card className="divide-y divide-slate-100 font-mono text-xs">
      {view.events.map((e: RunView["events"][number]) => (
        <div key={e.id} className={`flex gap-3 px-3 py-1.5 ${e.level === "error" ? "text-rose-700" : e.level === "warn" ? "text-amber-800" : "text-slate-700"}`}>
          <span className="shrink-0 text-slate-400">{new Date(e.created_at).toLocaleTimeString()}</span>
          <span>{e.text}</span>
        </div>
      ))}
    </Card>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{text}</div>;
}
