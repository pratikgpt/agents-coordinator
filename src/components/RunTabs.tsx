"use client";

import { Fragment, useState, type ReactNode } from "react";
import { ArrowRight, Check, ChevronRight, Pencil, ShieldCheck } from "lucide-react";
import type { RunView, StepRow } from "@/lib/orchestrator";
import type { Fact, PlanOutput, ReviewIssue, ReviewOutput, Task } from "@/lib/schemas";
import { Basis, BASIS_STYLE, Button, Card, Empty, JsonBlock, Kind, SimulatedTag, StatusIcon } from "./ui";
import { splitSimulated } from "./labels";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---------- Plan ----------

export function PlanTab({ view }: { view: RunView }) {
  const plan = view.plan as PlanOutput | null;
  const review = view.review as ReviewOutput | null;
  if (!plan) return <Empty text="No plan yet for the current facts. It appears here once Planning has run." />;
  const factText = new Map(view.versions.at(-1)?.facts.map((f) => [f.id, f.text]) ?? []);
  const blocking = review?.issues.filter((i) => i.severity === "blocking") ?? [];
  const minor = review?.issues.filter((i) => i.severity === "minor") ?? [];

  return (
    <div className="space-y-4">
      {view.status === "needs_attention" && blocking.length > 0 && (
        <Card className="border-amber-300 p-4">
          <h3 className="text-sm font-semibold text-amber-900">Unresolved after {view.run.max_rounds} review rounds</h3>
          <p className="mt-0.5 text-[13px] text-slate-600">Review kept finding these and Planning could not fix them. They need a person.</p>
          <IssueList issues={blocking} />
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Action plan</h3>
          <BasisLegend />
        </div>
        <ul className="divide-y divide-slate-100 md:hidden">
          {plan.tasks.map((t) => (
            <li key={t.id} className="p-4 text-sm">
              <TaskTitle task={t} />
              <div className="mt-2 grid grid-cols-2 gap-3">
                <Assigned value={t.owner} basis={t.owner_basis} missing="Needs owner" />
                <Assigned value={t.deadline} basis={t.deadline_basis} missing="Needs date" />
              </div>
              <TaskRefs task={t} factText={factText} />
            </li>
          ))}
        </ul>
        <table className="hidden w-full text-left text-sm md:table">
          <thead className="text-xs text-slate-600">
            <tr className="border-b border-slate-100">
              <th className="px-4 py-2 font-medium">Task</th>
              <th className="w-40 px-4 py-2 font-medium">Owner</th>
              <th className="w-36 px-4 py-2 font-medium">Due</th>
              <th className="w-44 px-4 py-2 font-medium">Based on</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {plan.tasks.map((t) => (
              <tr key={t.id} className="align-top">
                <td className="px-4 py-3">
                  <TaskTitle task={t} />
                  {t.depends_on.length > 0 && <div className="mt-1 text-xs text-slate-600">After {t.depends_on.join(", ")}</div>}
                </td>
                <td className="px-4 py-3">
                  <Assigned value={t.owner} basis={t.owner_basis} missing="Needs owner" />
                </td>
                <td className="px-4 py-3">
                  <Assigned value={t.deadline} basis={t.deadline_basis} missing="Needs date" />
                </td>
                <td className="px-4 py-3">
                  <SourceRefs task={t} factText={factText} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-900">Needs a decision</h3>
          <p className="mt-0.5 text-[13px] text-slate-600">Questions the meeting left open.</p>
          <ul className="mt-3 space-y-3 text-sm text-slate-800">
            {plan.open_questions.map((q) => (
              <li key={q.id} className="border-l-2 border-amber-400 pl-3">
                {q.text}
                {q.blocking_task_ids.length > 0 && <div className="mt-0.5 text-xs text-slate-600">Blocks {q.blocking_task_ids.join(", ")}</div>}
              </li>
            ))}
            {!plan.open_questions.length && <li className="text-slate-600">None</li>}
          </ul>
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-900">Recommendations</h3>
          <p className="mt-0.5 text-[13px] text-slate-600">Proposed by the Planning Agent, not agreed in the meeting.</p>
          <ul className="mt-3 space-y-3 text-sm text-slate-800">
            {plan.recommendations.map((r) => (
              <li key={r.id} className="border-l-2 border-violet-300 pl-3">
                {r.text}
                <div className="mt-0.5 text-xs text-slate-600">{r.rationale}</div>
              </li>
            ))}
            {!plan.recommendations.length && <li className="text-slate-600">None</li>}
          </ul>
        </Card>
      </div>

      {minor.length > 0 && (
        <Card className="p-4">
          <Disclosure title={`${minor.length} minor review note${minor.length === 1 ? "" : "s"}`} hint="Polish suggestions that did not block approval">
            <IssueList issues={minor} />
          </Disclosure>
        </Card>
      )}
    </div>
  );
}

function TaskTitle({ task }: { task: Task }) {
  return (
    <div className="text-slate-900">
      <span className="mr-1.5 font-mono text-xs text-slate-500">{task.id}</span>
      {task.title}
    </div>
  );
}

function Assigned({ value, basis, missing }: { value: string | null; basis: string; missing: string }) {
  if (!value)
    return (
      <span title="Not agreed in the meeting, so left open rather than guessed" className="text-[13px] font-medium text-amber-700">
        {missing}
      </span>
    );
  return (
    <div>
      <div className="tabular-nums text-slate-900">{value}</div>
      <Basis basis={basis} />
    </div>
  );
}

function SourceRefs({ task, factText }: { task: Task; factText: Map<string, string> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {task.source_fact_ids.map((id) => (
        <span key={id} title={factText.get(id)} className="cursor-help rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
          {id}
        </span>
      ))}
      {task.rule_refs.map((r) => (
        <span key={r} title="Company rule" className="rounded bg-sky-50 px-1.5 py-0.5 font-mono text-[11px] text-sky-800">
          {r}
        </span>
      ))}
    </div>
  );
}

function TaskRefs({ task, factText }: { task: Task; factText: Map<string, string> }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
      {task.depends_on.length > 0 && <span>After {task.depends_on.join(", ")}</span>}
      <SourceRefs task={task} factText={factText} />
    </div>
  );
}

function BasisLegend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
      {Object.entries(BASIS_STYLE).map(([k, s]) => (
        <span key={k} className="inline-flex items-center gap-1" title={s.label}>
          <span className={`size-1.5 rounded-full ${s.dot}`} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

export function IssueList({ issues }: { issues: ReviewIssue[] }) {
  return (
    <ul className="mt-3 space-y-2">
      {issues.map((i) => (
        <li key={i.id} className={`rounded-r-lg border-l-2 bg-slate-50 py-2 pr-3 pl-3 text-sm ${i.severity === "blocking" ? "border-rose-500" : "border-slate-300"}`}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Kind tone={i.severity === "blocking" ? "text-rose-700" : "text-slate-600"}>{i.severity}</Kind>
            <span className="text-xs text-slate-600">
              <span className="font-mono">{i.id}</span> · {i.source === "deterministic" ? "Code rule check" : "Review Agent"}
              {i.rule_ref && ` · ${i.rule_ref}`}
              {i.task_id && ` · ${i.task_id}`}
            </span>
          </div>
          <p className="mt-1 text-slate-900">{i.problem}</p>
          <p className="mt-1 text-[13px] text-slate-700">
            <span className="font-medium">Fix: </span>
            {i.correction}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Disclosure({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 text-left">
        <ChevronRight className={`size-4 text-slate-500 transition ${open ? "rotate-90" : ""}`} />
        <span className="text-sm font-semibold text-slate-900">{title}</span>
        {hint && <span className="hidden text-[13px] text-slate-600 sm:inline">· {hint}</span>}
      </button>
      {open && children}
    </div>
  );
}

// ---------- Source facts ----------

export function FactsTab({ view, onCorrect, disabled }: { view: RunView; onCorrect: (id: string, text: string) => Promise<void>; disabled: boolean }) {
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
      {view.versions.length > 1 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-900">Context history</h3>
          <ol className="mt-2 space-y-1.5 text-sm">
            {view.versions.map((v) => (
              <li key={v.version} className="flex gap-3">
                <span className={`font-mono text-xs leading-5 ${v.version === current.version ? "font-semibold text-teal-700" : "text-slate-500"}`}>v{v.version}</span>
                <span className="text-slate-800">{v.reason}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <Card>
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Source facts</h3>
          <p className="mt-0.5 text-[13px] text-slate-600">
            Extracted by the Intake Agent, each quoting the transcript. Correcting one reruns Planning and Review on a new context version. Intake is not repeated.
          </p>
        </div>
        <ul className="divide-y divide-slate-100">
          {current.facts.map((f) => (
            <li key={f.id} className="group flex gap-3 px-4 py-3">
              <span className="w-7 shrink-0 font-mono text-xs leading-6 text-slate-500">{f.id}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Kind>{f.kind}</Kind>
                  {f.corrected_by_user && <Kind tone="text-teal-700">Corrected by you</Kind>}
                </div>
                {editing === f.id ? (
                  <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                      className="h-9 flex-1 rounded-lg border border-slate-300 px-2.5 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
                    />
                    <div className="flex gap-2">
                      <Button variant="primary" disabled={saving || !draft.trim() || draft.trim() === f.text} onClick={() => save(f)}>
                        {saving ? "Saving…" : "Save and rerun"}
                      </Button>
                      <Button variant="ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-0.5 text-sm text-slate-900">{f.text}</p>
                )}
                <p className="mt-1 text-[13px] text-slate-600">
                  Line {f.source.lines.join(", ")}: “{f.source.quote}”
                </p>
              </div>
              {editing !== f.id && (
                <div className="shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => {
                      setEditing(f.id);
                      setDraft(f.text);
                    }}
                  >
                    <Pencil className="size-3.5" /> Correct
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-900">Flagged by Intake</h3>
        <p className="mt-0.5 text-[13px] text-slate-600">Missing or conflicting information Planning has to work around.</p>
        <ul className="mt-3 space-y-2.5 text-sm">
          {current.issues.map((i) => (
            <li key={i.id} className="flex gap-3">
              <span className="w-16 shrink-0 leading-5">
                <Kind tone={i.kind === "conflict" ? "text-rose-700" : "text-amber-700"}>{i.kind}</Kind>
              </span>
              <span className="text-slate-900">
                {i.text}
                {i.related_fact_ids.length > 0 && <span className="ml-1.5 font-mono text-xs text-slate-500">{i.related_fact_ids.join(", ")}</span>}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ---------- Agent exchange: handoffs and feedback, grouped by context version and round ----------

type Message = { id: string; kind: string; context_version: number; payload: Record<string, unknown>; created_at: string };

export function ExchangeTab({ view }: { view: RunView }) {
  const messages = view.messages as unknown as Message[];
  if (!view.steps.length) return <Empty text="Agent handoffs and Review feedback appear here as the run progresses." />;
  const find = (kind: string, v: number, round?: number) =>
    messages.find((m) => m.kind === kind && m.context_version === v && (round == null || m.payload.round === round));
  const intake = view.steps.filter((s) => s.agent === "intake");
  // Failed attempts are kept in the event log (a retry overwrites the step's error), so read them from there.
  const events = view.events as unknown as { text: string }[];
  const failuresOf = (s: StepRow) => {
    const label = s.agent === "intake" ? "Intake" : `${s.agent === "planning" ? "Planning" : "Review"} (v${s.context_version}, round ${s.round})`;
    const prefix = `${label} failed: `;
    return events.filter((e) => e.text.startsWith(prefix)).map((e) => e.text.slice(prefix.length));
  };
  const versions = [...new Set(view.steps.filter((s) => s.agent !== "intake").map((s) => s.context_version))].sort();

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <GroupTitle>Extraction</GroupTitle>
        <Timeline>
          {intake.map((s) => (
            <StepEvent key={s.id} step={s} failures={failuresOf(s)} title="Intake read the transcript" detail={s.output ? `${(s.output as { facts: unknown[] }).facts.length} facts and ${(s.output as { issues: unknown[] }).issues.length} flagged issues` : null} />
          ))}
          <Handoff message={find("intake->planning", 1)} from="Intake" to="Planning" label="Facts and flagged issues" />
        </Timeline>
      </Card>

      {versions.map((v) => {
        const correction = find("user->planning", v);
        const rounds = [...new Set(view.steps.filter((s) => s.agent !== "intake" && s.context_version === v).map((s) => s.round))].sort();
        return (
          <Card key={v} className="p-4">
            <GroupTitle>
              Context v{v}
              {v === view.run.current_version ? "" : " · replaced"}
            </GroupTitle>
            <Timeline>
              {correction && (
                <Event icon={<Pencil className="size-3.5 text-teal-700" />} title={`You corrected ${correction.payload.fact_id}`}>
                  <p className="text-[13px] text-slate-600">
                    “{String(correction.payload.before)}” → <span className="text-slate-900">“{String(correction.payload.after)}”</span>
                  </p>
                  <ValidatedPayload message={correction} />
                </Event>
              )}
              {rounds.map((r) => {
                const plan = view.steps.find((s) => s.agent === "planning" && s.context_version === v && s.round === r);
                const review = view.steps.find((s) => s.agent === "review" && s.context_version === v && s.round === r);
                const planOut = plan?.output as PlanOutput | null;
                const reviewOut = review?.output as ReviewOutput | null;
                const sentBack = find("review->planning", v, r);
                const toUser = find("review->user", v, r);
                const simulated = Boolean((plan?.input as { simulate_rule_violation?: boolean } | undefined)?.simulate_rule_violation);
                return (
                  <Fragment key={r}>
                    {plan && (
                      <StepEvent step={plan} failures={failuresOf(plan)} title={r === 1 ? "Planning drafted a plan" : `Planning revised the plan (draft ${r})`} detail={planOut ? `${planOut.tasks.length} tasks` : null} tag={simulated ? <SimulatedTag>Told to ignore R2</SimulatedTag> : null}>
                        {planOut && planOut.changes_made.length > 0 && (
                          <ul className="mt-1.5 space-y-1 text-[13px] text-slate-700">
                            {planOut.changes_made.map((c, k) => (
                              <li key={k} className="flex gap-1.5">
                                <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                                {c}
                              </li>
                            ))}
                          </ul>
                        )}
                      </StepEvent>
                    )}
                    {plan?.status === "succeeded" && <Handoff message={find("planning->review", v, r)} from="Planning" to="Review" label={`Draft ${r}`} />}
                    {review && (
                      <StepEvent
                        step={review}
                        failures={failuresOf(review)}
                        title={`Review checked draft ${r}`}
                        detail={reviewOut ? (reviewOut.approved ? "Approved" : plural(reviewOut.issues.filter((i) => i.severity === "blocking").length, "blocking issue")) : null}
                      />
                    )}
                    {sentBack && (
                      <Handoff message={sentBack} from="Review" to="Planning" label="Corrections" tone="rose">
                        <IssueList issues={sentBack.payload.issues as ReviewIssue[]} />
                      </Handoff>
                    )}
                    {toUser && <Handoff message={toUser} from="Review" to="you" label={toUser.payload.approved ? "Approved plan" : "Unresolved issues (round limit reached)"} tone={toUser.payload.approved ? "emerald" : "amber"} />}
                  </Fragment>
                );
              })}
            </Timeline>
          </Card>
        );
      })}
    </div>
  );
}

function GroupTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-600">{children}</h3>;
}

function Timeline({ children }: { children: ReactNode }) {
  return <ol className="relative space-y-3 before:absolute before:top-2 before:bottom-2 before:left-[11px] before:w-px before:bg-slate-200">{children}</ol>;
}

function Event({ icon, title, children }: { icon: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <li className="relative flex gap-3">
      <span className="z-10 grid size-6 shrink-0 place-items-center rounded-full bg-white ring-1 ring-slate-200">{icon}</span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="text-sm text-slate-900">{title}</div>
        {children}
      </div>
    </li>
  );
}

function StepEvent({
  step,
  failures,
  title,
  detail,
  tag,
  children,
}: {
  step: StepRow;
  failures: string[];
  title: string;
  detail: string | null;
  tag?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Event
      icon={<StatusIcon status={step.status} className="size-3.5" />}
      title={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{title}</span>
          {detail && <span className="text-slate-600">· {detail}</span>}
          {step.attempts > 1 && <span className="text-xs text-slate-600">attempt {step.attempts}</span>}
          {tag}
        </span>
      }
    >
      {step.status === "superseded" && <p className="text-[13px] text-slate-600">Finished after the facts changed, so its output was discarded as stale.</p>}
      {failures.map((f, k) => {
        const err = splitSimulated(f);
        return (
          <p key={k} className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[13px] text-rose-800">
            <span className="font-medium">Attempt {k + 1} failed:</span>
            {err.simulated && <SimulatedTag />} {err.text}
            {step.status === "succeeded" && k === failures.length - 1 && <span className="text-slate-600">Retried this step only; earlier steps were reused.</span>}
          </p>
        );
      })}
      {children}
    </Event>
  );
}

const TONE = {
  slate: "text-slate-600",
  rose: "text-rose-700",
  emerald: "text-emerald-700",
  amber: "text-amber-700",
};

function Handoff({ message, from, to, label, tone = "slate", children }: { message: Message | undefined; from: string; to: string; label: string; tone?: keyof typeof TONE; children?: ReactNode }) {
  if (!message) return null;
  return (
    <Event icon={<ArrowRight className={`size-3.5 ${TONE[tone]}`} />} title={<span className={`text-[13px] font-medium ${TONE[tone]}`}>{from} → {to}: {label}</span>}>
      {children}
      <ValidatedPayload message={message} />
    </Event>
  );
}

function ValidatedPayload({ message }: { message: Message }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="inline-flex items-center gap-1 text-xs text-slate-600" title="Parsed against this handoff's schema in the same transaction that stored it">
        <ShieldCheck className="size-3.5 text-emerald-600" /> Schema-validated handoff
      </span>
      <JsonBlock label="Payload" value={message.payload} />
    </div>
  );
}

// ---------- Action log ----------

export function LogTab({ view }: { view: RunView }) {
  const events = view.events as unknown as { id: string; level: string; text: string; created_at: string }[];
  return (
    <Card className="divide-y divide-slate-100">
      {events.map((e) => {
        const { simulated, text } = splitSimulated(e.text);
        return (
          <div key={e.id} className="flex gap-4 px-4 py-2 text-[13px]">
            <span className="w-20 shrink-0 font-mono text-xs leading-5 text-slate-500 tabular-nums">{new Date(e.created_at).toLocaleTimeString()}</span>
            <span className={`flex flex-wrap items-center gap-1.5 ${e.level === "error" ? "text-rose-700" : e.level === "warn" ? "text-amber-800" : "text-slate-800"}`}>
              {simulated && <SimulatedTag />}
              {text}
            </span>
          </div>
        );
      })}
    </Card>
  );
}

