// Integration tests against a real Postgres (DATABASE_URL), with the LLM agents stubbed so the
// orchestration guarantees (resume, idempotency, isolation, versioning) are tested deterministically.
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { IntakeOutput, PlanOutput, ReviewOutput } from "@/lib/schemas";

const usage = { model: "stub", calls: 1, prompt_tokens: 10, completion_tokens: 10, cost_usd: 0.001 };
const intakeOut: IntakeOutput = {
  facts: [{ id: "F1", kind: "decision", text: "Release on 2026-10-30", source: { lines: [5], quote: "releasing v1" } }],
  issues: [],
};
const planOut: PlanOutput = {
  tasks: [{ id: "T1", title: "Release", owner: "Asha Rao", owner_basis: "recommendation", deadline: "2026-10-29", deadline_basis: "recommendation", depends_on: [], source_fact_ids: ["F1"], rule_refs: [] }],
  recommendations: [],
  open_questions: [],
  changes_made: [],
};
const reviewQueue: ReviewOutput[] = [];

const agents = vi.hoisted(() => ({ runIntake: vi.fn(), runPlanning: vi.fn(), runReview: vi.fn() }));
vi.mock("@/lib/agents", () => agents);

const { advanceRun, correctFact, createRun, getRunView, setFaults, NotFoundError } = await import("@/lib/orchestrator");
const { sql } = await import("@/lib/db");
const { SAMPLE_RULES, SAMPLE_TRANSCRIPT } = await import("@/lib/sample");

async function drive(session: string, run: string, max = 20) {
  for (let i = 0; i < max; i++) {
    const r = await advanceRun(session, run);
    if (r.outcome !== "ran") return r;
  }
  throw new Error("did not finish");
}

beforeEach(() => {
  reviewQueue.length = 0;
  agents.runIntake.mockReset().mockResolvedValue({ data: intakeOut, usage });
  agents.runPlanning.mockReset().mockResolvedValue({ data: planOut, usage });
  agents.runReview.mockReset().mockImplementation(async () => ({
    data: reviewQueue.shift() ?? { approved: true, summary: "ok", issues: [] },
    usage,
  }));
});

afterAll(() => sql.end());

describe("orchestrator", () => {
  it("completes a three-agent run and records validated handoffs", async () => {
    const s = randomUUID();
    const id = await createRun(s, SAMPLE_TRANSCRIPT, SAMPLE_RULES, {});
    expect(await drive(s, id)).toEqual({ outcome: "done" });
    const view = await getRunView(s, id);
    expect(view.status).toBe("approved");
    expect(view.messages.map((m) => m.kind)).toEqual(["intake->planning", "planning->review", "review->user"]);
  });

  it("sends review corrections back to planning and stops after the round limit", async () => {
    const blocking = { id: "L1", severity: "blocking" as const, source: "llm" as const, task_id: "T1", rule_ref: "R2", problem: "No security review", correction: "Add one" };
    reviewQueue.push(...Array(5).fill({ approved: false, summary: "no", issues: [blocking] }));
    const s = randomUUID();
    const id = await createRun(s, SAMPLE_TRANSCRIPT, SAMPLE_RULES, {});
    await drive(s, id);
    const view = await getRunView(s, id);
    expect(view.status).toBe("needs_attention");
    expect(agents.runPlanning).toHaveBeenCalledTimes(view.run.max_rounds);
    expect(agents.runPlanning.mock.calls[1][0].corrections).toEqual([blocking]);
    expect(view.messages.filter((m) => m.kind === "review->planning")).toHaveLength(view.run.max_rounds - 1);
  });

  it("resumes after a simulated model failure without redoing completed steps", async () => {
    const s = randomUUID();
    const id = await createRun(s, SAMPLE_TRANSCRIPT, SAMPLE_RULES, { fail_planning: true });
    const failed = await drive(s, id);
    expect(failed.outcome).toBe("failed");
    expect(failed.error).toMatch(/SIMULATED/);
    expect((await getRunView(s, id)).status).toBe("failed");

    expect(await drive(s, id)).toEqual({ outcome: "done" });
    const view = await getRunView(s, id);
    expect(agents.runIntake).toHaveBeenCalledTimes(1);
    expect(view.steps.find((x) => x.step_key === "planning:v1:r1")?.attempts).toBe(2);
    expect(view.status).toBe("approved");
  });

  it("does not run the same step twice when advanced concurrently", async () => {
    const s = randomUUID();
    const id = await createRun(s, SAMPLE_TRANSCRIPT, SAMPLE_RULES, {});
    let release!: () => void;
    agents.runIntake.mockImplementationOnce(() => new Promise((r) => (release = () => r({ data: intakeOut, usage }))));
    const first = advanceRun(s, id);
    await vi.waitFor(() => expect(agents.runIntake).toHaveBeenCalledTimes(1));
    expect(await advanceRun(s, id)).toEqual({ outcome: "busy" });
    release();
    expect(await first).toEqual({ outcome: "ran" });
    expect(agents.runIntake).toHaveBeenCalledTimes(1);
  });

  it("propagates a corrected fact: new version, planning reruns, intake reused", async () => {
    const s = randomUUID();
    const id = await createRun(s, SAMPLE_TRANSCRIPT, SAMPLE_RULES, {});
    await drive(s, id);
    await correctFact(s, id, "F1", "Release on 2026-11-06");
    expect((await getRunView(s, id)).status).toBe("ready");
    await drive(s, id);

    const view = await getRunView(s, id);
    expect(view.run.current_version).toBe(2);
    expect(agents.runIntake).toHaveBeenCalledTimes(1);
    const v2Input = agents.runPlanning.mock.calls.at(-1)![0];
    expect(v2Input.context_version).toBe(2);
    expect(v2Input.facts[0]).toMatchObject({ text: "Release on 2026-11-06", corrected_by_user: true });
  });

  it("discards a step result if the context changed while it ran", async () => {
    const s = randomUUID();
    const id = await createRun(s, SAMPLE_TRANSCRIPT, SAMPLE_RULES, {});
    await advanceRun(s, id); // intake
    agents.runPlanning.mockImplementationOnce(async () => {
      await correctFact(s, id, "F1", "Release on 2026-11-06"); // user edits mid-step
      return { data: planOut, usage };
    });
    await advanceRun(s, id);
    const view = await getRunView(s, id);
    expect(view.steps.find((x) => x.step_key === "planning:v1:r1")?.status).toBe("superseded");
    expect(view.messages.some((m) => m.kind === "planning->review")).toBe(false);
    expect(view.next).toEqual({ kind: "step", agent: "planning", version: 2, round: 1 });
  });

  it("isolates sessions: another session cannot read or drive a run", async () => {
    const owner = randomUUID();
    const other = randomUUID();
    const id = await createRun(owner, SAMPLE_TRANSCRIPT, SAMPLE_RULES, {});
    await expect(getRunView(other, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(advanceRun(other, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(correctFact(other, id, "F1", "x")).rejects.toBeInstanceOf(NotFoundError);
    await expect(setFaults(other, id, { fail_intake: true })).rejects.toBeInstanceOf(NotFoundError);
  });
});
