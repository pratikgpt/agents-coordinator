import { describe, expect, it } from "vitest";
import { checkIntakeGrounding, checkPlan } from "@/lib/checks";
import { SAMPLE_RULES, SAMPLE_TRANSCRIPT } from "@/lib/sample";
import type { Fact, PlanOutput, Task } from "@/lib/schemas";

const facts: Fact[] = [
  { id: "F1", kind: "decision", text: "Dev Patel builds the ingestion pipeline by 2026-10-23", source: { lines: [6], quote: "I'll build the ingestion pipeline" } },
];

const task = (t: Partial<Task>): Task => ({
  id: "T1", title: "Build pipeline", owner: "Dev Patel", owner_basis: "transcript", deadline: "2026-10-23",
  deadline_basis: "transcript", depends_on: [], source_fact_ids: ["F1"], rule_refs: [], ...t,
});
const plan = (tasks: Task[], open_questions: PlanOutput["open_questions"] = []): PlanOutput =>
  ({ tasks, recommendations: [], open_questions, changes_made: [] });

describe("checkPlan", () => {
  it("accepts a grounded, compliant plan", () => {
    expect(checkPlan(plan([task({})]), facts, SAMPLE_RULES)).toEqual([]);
  });

  it("rejects an owner who is not on the roster", () => {
    const issues = checkPlan(plan([task({ owner: "Priya Shah", owner_basis: "recommendation" })]), facts, SAMPLE_RULES);
    expect(issues.map((i) => i.rule_ref)).toContain("R1");
  });

  it("rejects deadlines on holidays and weekends", () => {
    const holiday = checkPlan(plan([task({ deadline: "2026-10-30" })]), facts, SAMPLE_RULES);
    const weekend = checkPlan(plan([task({ deadline: "2026-10-24" })]), facts, SAMPLE_RULES);
    expect(holiday.some((i) => i.rule_ref === "R3" && i.problem.includes("holiday"))).toBe(true);
    expect(weekend.some((i) => i.rule_ref === "R3" && i.problem.includes("Sat"))).toBe(true);
  });

  it("flags an owner claimed from the transcript that no cited fact mentions", () => {
    const issues = checkPlan(plan([task({ owner: "Mei Lin" })]), facts, SAMPLE_RULES);
    expect(issues.some((i) => i.problem.includes("none of the cited facts"))).toBe(true);
  });

  it("requires an open question for unassigned tasks", () => {
    const t = task({ owner: null, owner_basis: "unresolved" });
    expect(checkPlan(plan([t]), facts, SAMPLE_RULES)).toHaveLength(1);
    expect(checkPlan(plan([t], [{ id: "Q1", text: "Who?", blocking_task_ids: ["T1"], related_fact_ids: [] }]), facts, SAMPLE_RULES)).toEqual([]);
  });

  it("detects dependency cycles, unknown facts and capacity limits", () => {
    const tasks = [
      task({ id: "T1", depends_on: ["T2"], deadline: null, deadline_basis: "unresolved" }),
      task({ id: "T2", depends_on: ["T1"], deadline: null, deadline_basis: "unresolved", source_fact_ids: ["F9"] }),
      task({ id: "T3" }),
      task({ id: "T4" }),
    ];
    const problems = checkPlan(plan(tasks), facts, SAMPLE_RULES).map((i) => i.problem).join("\n");
    expect(problems).toMatch(/cycle/);
    expect(problems).toMatch(/unknown fact/);
    expect(problems).toMatch(/owns 4 tasks; the limit is 3/);
  });
});

describe("checkIntakeGrounding", () => {
  it("accepts verbatim quotes and rejects invented ones", () => {
    expect(checkIntakeGrounding(facts, SAMPLE_TRANSCRIPT)).toEqual([]);
    const invented = [{ ...facts[0], source: { lines: [6], quote: "Tom will run the security review" } }];
    expect(checkIntakeGrounding(invented, SAMPLE_TRANSCRIPT)[0]).toMatch(/not found verbatim/);
  });
});
