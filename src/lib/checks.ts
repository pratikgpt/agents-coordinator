import type { CompanyRules, Fact, PlanOutput, ReviewIssue } from "./schemas";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function dayName(isoDate: string): string {
  return DAY_NAMES[new Date(`${isoDate}T00:00:00Z`).getUTCDay()];
}

export function numberLines(transcript: string): string {
  return transcript
    .split("\n")
    .map((line, i) => `${String(i + 1).padStart(3)}| ${line}`)
    .join("\n");
}

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Grounding check for Intake: every quote must exist in the transcript at the cited lines. */
export function checkIntakeGrounding(facts: Fact[], transcript: string): string[] {
  const lines = transcript.split("\n");
  const errors: string[] = [];
  for (const f of facts) {
    const bad = f.source.lines.filter((n) => n > lines.length);
    if (bad.length) {
      errors.push(`${f.id}: cites line(s) ${bad.join(", ")} but the transcript has ${lines.length} lines`);
      continue;
    }
    const cited = normalise(f.source.lines.map((n) => lines[n - 1]).join(" "));
    if (!cited.includes(normalise(f.source.quote))) {
      errors.push(`${f.id}: quote "${f.source.quote}" is not found verbatim on line(s) ${f.source.lines.join(", ")}`);
    }
  }
  const ids = facts.map((f) => f.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) errors.push(`Duplicate fact ids: ${[...new Set(dupes)].join(", ")}`);
  return errors;
}

/**
 * Rule checks that do not need judgement. The Review Agent merges these with its own
 * LLM findings, so a model that "approves" a plan with an off-roster owner still fails.
 */
export function checkPlan(plan: PlanOutput, facts: Fact[], rules: CompanyRules): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  let n = 0;
  const add = (task_id: string | null, rule_ref: string | null, problem: string, correction: string) =>
    issues.push({ id: `D${++n}`, severity: "blocking", source: "deterministic", task_id, rule_ref, problem, correction });

  const roster = new Map(rules.roster.map((m) => [m.name, m]));
  const factById = new Map(facts.map((f) => [f.id, f]));
  const taskById = new Map(plan.tasks.map((t) => [t.id, t]));
  const holidays = new Set(rules.holidays);
  const ownerCounts = new Map<string, number>();

  for (const t of plan.tasks) {
    if (t.owner !== null) {
      if (!roster.has(t.owner)) {
        add(t.id, "R1", `Owner "${t.owner}" is not on the roster.`, `Assign a roster member or leave the owner null with an open question.`);
      } else {
        ownerCounts.set(t.owner, (ownerCounts.get(t.owner) ?? 0) + 1);
      }
      if (t.owner_basis === "transcript") {
        const firstName = normalise(t.owner.split(" ")[0]);
        const cited = t.source_fact_ids.map((id) => factById.get(id)).filter(Boolean) as Fact[];
        if (!cited.some((f) => normalise(`${f.text} ${f.source.quote}`).includes(firstName))) {
          add(t.id, null, `Owner "${t.owner}" is marked as stated in the transcript, but none of the cited facts mention them.`, `Cite the fact that assigns ${t.owner}, or change owner_basis to "recommendation".`);
        }
      }
    } else if (!plan.open_questions.some((q) => q.blocking_task_ids.includes(t.id))) {
      add(t.id, "R1", `Task has no owner and no open question explains why.`, `Add an open question that blocks ${t.id}, or assign a roster member.`);
    }

    if (t.deadline !== null) {
      if (t.deadline < rules.meeting_date) {
        add(t.id, null, `Deadline ${t.deadline} is before the meeting date ${rules.meeting_date}.`, `Choose a deadline on or after ${rules.meeting_date}.`);
      }
      const day = dayName(t.deadline);
      if (!rules.working_days.includes(day as CompanyRules["working_days"][number])) {
        add(t.id, "R3", `Deadline ${t.deadline} is a ${day}, not a working day.`, `Move the deadline to a working day.`);
      }
      if (holidays.has(t.deadline)) {
        add(t.id, "R3", `Deadline ${t.deadline} is a company holiday.`, `Move the deadline off the holiday, or raise an open question if the date was fixed by the client.`);
      }
    }

    for (const dep of t.depends_on) {
      const d = taskById.get(dep);
      if (!d) {
        add(t.id, null, `Depends on unknown task ${dep}.`, `Remove the dependency or add task ${dep}.`);
      } else if (d.deadline && t.deadline && d.deadline > t.deadline) {
        add(t.id, null, `Depends on ${dep} (due ${d.deadline}) but is due earlier, on ${t.deadline}.`, `Make ${t.id} due after ${dep}, or remove the dependency.`);
      }
    }

    const unknownFacts = t.source_fact_ids.filter((id) => !factById.has(id));
    if (unknownFacts.length) {
      add(t.id, null, `Cites unknown fact id(s) ${unknownFacts.join(", ")}.`, `Cite only fact ids from the Intake output.`);
    }
    if (t.source_fact_ids.length === 0 && (t.owner_basis === "transcript" || t.deadline_basis === "transcript")) {
      add(t.id, null, `Claims transcript support but cites no facts.`, `Cite the supporting fact ids or change the basis to "recommendation".`);
    }
  }

  for (const [owner, count] of ownerCounts) {
    const max = roster.get(owner)!.max_open_tasks;
    if (count > max) {
      add(null, "R5", `${owner} owns ${count} tasks; the limit is ${max}.`, `Reassign ${count - max} of ${owner}'s tasks or leave them unassigned with an open question.`);
    }
  }

  if (hasCycle(plan)) add(null, null, `Task dependencies contain a cycle.`, `Remove a dependency so the graph is acyclic.`);
  return issues;
}

function hasCycle(plan: PlanOutput): boolean {
  const deps = new Map(plan.tasks.map((t) => [t.id, t.depends_on]));
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const d of deps.get(id) ?? []) if (deps.has(d) && visit(d)) return true;
    state.set(id, 2);
    return false;
  };
  return plan.tasks.some((t) => visit(t.id));
}
