import { callJson, modelFor } from "./llm";
import { checkIntakeGrounding, checkPlan, dayName, numberLines } from "./checks";
import {
  IntakeOutput,
  PlanOutput,
  ReviewOutput,
  type CompanyRules,
  type Fact,
  type IntakeOutput as IntakeOutputT,
  type ReviewIssue,
} from "./schemas";

// Each agent receives only the inputs its role needs. Planning never sees the raw
// transcript; it works from the Intake Agent's facts, which is what makes the handoff real.

export interface IntakeInput {
  transcript: string;
  rules: CompanyRules;
}

export async function runIntake(input: IntakeInput) {
  return callJson({
    model: modelFor("intake"),
    schema: IntakeOutput,
    system: `You are the Intake Agent of an operations team. You read a meeting transcript and extract
structured source facts. You do not plan work.

- Extract every decision, requirement and constraint as a separate fact (ids F1, F2, ...).
- Cite the line number(s) and copy an exact quote from those lines. The transcript is shown with line numbers; do not include the number prefix in quotes.
- Record only what was said. Never invent owners, deadlines or commitments. Resolve relative dates ("Friday the 23rd") to ISO dates only when the transcript makes them unambiguous, using the meeting date.
- Flag issues (ids I1, I2, ...): "missing" for information a plan will need but nobody provided (no owner, no date, approval not on record); "conflict" when statements contradict each other or the company calendar/rules (e.g. a date that falls on a holiday).`,
    user: `Company calendar and roster (context for spotting conflicts only):
${JSON.stringify({ meeting_date: input.rules.meeting_date, working_days: input.rules.working_days, holidays: input.rules.holidays, roster: input.rules.roster.map((m) => m.name) })}

Transcript:
${numberLines(input.transcript)}`,
    validate: (out) => checkIntakeGrounding(out.facts, input.transcript),
  });
}

export interface PlanningInput {
  context_version: number;
  round: number;
  facts: Fact[];
  issues: IntakeOutputT["issues"];
  rules: CompanyRules;
  previous_plan: PlanOutput | null;
  corrections: ReviewIssue[];
  simulate_rule_violation: boolean;
}

export async function runPlanning(input: PlanningInput) {
  const factIds = new Set(input.facts.map((f) => f.id));
  const revision = input.previous_plan
    ? `\n\nYour previous plan (round ${input.round - 1}):\n${JSON.stringify(input.previous_plan)}

The Review Agent returned these corrections. Address every one and list each change in "changes_made":
${JSON.stringify(input.corrections)}`
    : "";
  // Clearly labelled simulated fault used to demonstrate the review/correction loop.
  const fault = input.simulate_rule_violation
    ? `\n\n[SIMULATED FAULT — injected for the demo] For this draft only, ignore rule R2: do not add a security review task.`
    : "";

  return callJson({
    model: modelFor("planning"),
    schema: PlanOutput,
    system: `You are the Planning Agent. From structured facts produced by the Intake Agent and the company
rules, you propose an action plan: tasks with owners, deadlines and dependencies.

- Only use owners from the roster. Each owner and deadline has a basis:
  "transcript" = explicitly stated in a cited fact; "rule" = required by a company rule;
  "recommendation" = your proposal, not stated by anyone; "unresolved" = left null with an open question.
- Never present a recommendation as a decision. If something is unknown, set it to null and add an open question.
- Every task cites the fact ids (source_fact_ids) and rule ids (rule_refs) it relies on.
- Deadlines must be ISO dates on working days and never on holidays. Facts marked corrected_by_user override anything else.
- Put suggestions that are not tasks in "recommendations"; put unanswered items in "open_questions".
- "changes_made" is empty for a first draft.`,
    user: `Context version: ${input.context_version}. Round: ${input.round}.

Company rules:
${JSON.stringify(input.rules)}

Facts from the Intake Agent:
${JSON.stringify(input.facts)}

Issues flagged by the Intake Agent:
${JSON.stringify(input.issues)}${revision}${fault}`,
    validate: (plan) => {
      const ids = new Set(plan.tasks.map((t) => t.id));
      const errs: string[] = [];
      if (ids.size !== plan.tasks.length) errs.push("Task ids must be unique");
      for (const t of plan.tasks) {
        for (const f of t.source_fact_ids) if (!factIds.has(f)) errs.push(`${t.id} cites unknown fact ${f}`);
        if (t.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(t.deadline)) errs.push(`${t.id} deadline is not an ISO date`);
      }
      return errs;
    },
  });
}

export interface ReviewInput {
  context_version: number;
  round: number;
  transcript: string;
  rules: CompanyRules;
  facts: Fact[];
  plan: PlanOutput;
}

export async function runReview(input: ReviewInput) {
  const deterministic = checkPlan(input.plan, input.facts, input.rules);
  const deadlines = [...new Set(input.plan.tasks.flatMap((t) => (t.deadline ? [t.deadline] : [])))]
    .map((d) => `${d}=${dayName(d)}`)
    .join(", ");

  const { data, usage } = await callJson({
    model: modelFor("review"),
    schema: ReviewOutput,
    system: `You are the Review Agent. You check a proposed plan against the ORIGINAL meeting transcript and
the company rules, and you send specific corrections back to the Planning Agent.

Look for:
- Rule violations (cite the rule id).
- Owners, deadlines or decisions marked "transcript" that the transcript does not support (invented facts).
- Decisions, requirements or constraints in the transcript that the plan ignores.
- Conflicts or open issues the plan treats as settled.

Facts marked corrected_by_user were corrected by a human and override the transcript.
Automated rule checks have already run; do not repeat their findings.
Each issue needs a concrete correction. Use "blocking" for anything that makes the plan wrong or non-compliant,
"minor" for polish. Set approved=true only if you found no blocking issues.`,
    user: `Context version: ${input.context_version}. Review round: ${input.round}.

Company rules:
${JSON.stringify(input.rules)}

Transcript:
${numberLines(input.transcript)}

Current source facts:
${JSON.stringify(input.facts)}

Plan to review:
${JSON.stringify(input.plan)}

Weekdays of plan deadlines: ${deadlines || "none"}

Automated check findings (already included, do not repeat):
${JSON.stringify(deterministic)}`,
  });

  const llmIssues = data.issues.map((i, k) => ({ ...i, id: `L${k + 1}`, source: "llm" as const }));
  const issues = [...deterministic, ...llmIssues];
  const approved = issues.every((i) => i.severity !== "blocking");
  return { data: { approved, summary: data.summary, issues }, usage };
}
