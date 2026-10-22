import { z } from "zod";

// ---------- Company rules (user-editable input) ----------

export const RosterMember = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  max_open_tasks: z.number().int().positive(),
});

export const CompanyRules = z.object({
  company: z.string(),
  meeting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  working_days: z.array(z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])),
  holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  roster: z.array(RosterMember).min(1),
  rules: z.array(z.object({ id: z.string(), text: z.string() })).min(1),
});
export type CompanyRules = z.infer<typeof CompanyRules>;

// ---------- Intake Agent output ----------

export const SourceRef = z.object({
  lines: z.array(z.number().int().positive()).min(1),
  quote: z.string().min(1),
});

export const Fact = z.object({
  id: z.string().regex(/^F\d+$/),
  kind: z.enum(["decision", "requirement", "constraint"]),
  text: z.string().min(1),
  source: SourceRef,
  // Set by the orchestrator (never the model) when a user corrects this fact.
  corrected_by_user: z.boolean().optional(),
});
export type Fact = z.infer<typeof Fact>;

export const IntakeIssue = z.object({
  id: z.string().regex(/^I\d+$/),
  kind: z.enum(["missing", "conflict"]),
  text: z.string().min(1),
  related_fact_ids: z.array(z.string()),
  source_lines: z.array(z.number().int().positive()),
});

export const IntakeOutput = z.object({
  facts: z.array(Fact).min(1),
  issues: z.array(IntakeIssue),
});
export type IntakeOutput = z.infer<typeof IntakeOutput>;

// ---------- Planning Agent output ----------

// Every owner/deadline states where it came from, so facts and recommendations never blur.
const Basis = z.enum(["transcript", "rule", "recommendation", "unresolved"]);

export const Task = z.object({
  id: z.string().regex(/^T\d+$/),
  title: z.string().min(1),
  owner: z.string().nullable(),
  owner_basis: Basis,
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  deadline_basis: Basis,
  depends_on: z.array(z.string()),
  source_fact_ids: z.array(z.string()),
  rule_refs: z.array(z.string()),
});
export type Task = z.infer<typeof Task>;

export const PlanOutput = z.object({
  tasks: z.array(Task).min(1),
  recommendations: z.array(
    z.object({ id: z.string(), text: z.string(), rationale: z.string() }),
  ),
  open_questions: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      blocking_task_ids: z.array(z.string()),
      related_fact_ids: z.array(z.string()),
    }),
  ),
  changes_made: z.array(z.string()),
});
export type PlanOutput = z.infer<typeof PlanOutput>;

// ---------- Review Agent output ----------

export const ReviewIssue = z.object({
  id: z.string(),
  severity: z.enum(["blocking", "minor"]),
  source: z.enum(["llm", "deterministic"]).default("llm"),
  task_id: z.string().nullable(),
  rule_ref: z.string().nullable(),
  problem: z.string().min(1),
  correction: z.string().min(1),
});
export type ReviewIssue = z.infer<typeof ReviewIssue>;

export const ReviewOutput = z.object({
  approved: z.boolean(),
  summary: z.string(),
  issues: z.array(ReviewIssue),
});
export type ReviewOutput = z.infer<typeof ReviewOutput>;

// ---------- Handoff envelopes (validated before they are persisted) ----------

export const Handoffs = {
  "intake->planning": z.object({ context_version: z.number().int(), facts: z.array(Fact), issues: z.array(IntakeIssue) }),
  "planning->review": z.object({ context_version: z.number().int(), round: z.number().int(), plan: PlanOutput }),
  "review->planning": z.object({ context_version: z.number().int(), round: z.number().int(), issues: z.array(ReviewIssue).min(1) }),
  "review->user": z.object({ context_version: z.number().int(), round: z.number().int(), approved: z.boolean(), unresolved: z.array(ReviewIssue) }),
  "user->planning": z.object({ context_version: z.number().int(), fact_id: z.string(), before: z.string(), after: z.string() }),
} as const;
export type HandoffKind = keyof typeof Handoffs;

export type AgentName = "intake" | "planning" | "review";
