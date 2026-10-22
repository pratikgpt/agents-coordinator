import { describe, expect, it } from "vitest";
import { nextAction, stepKey } from "@/lib/orchestrator";

const ok = (key: string, output: unknown = {}) => ({ step_key: key, status: "succeeded" as const, output });

describe("nextAction", () => {
  it("starts with intake", () => {
    expect(nextAction([], 0, 3)).toMatchObject({ kind: "step", agent: "intake" });
  });

  it("retries a failed step instead of skipping it", () => {
    const steps = [ok("intake"), { step_key: stepKey("planning", 1, 1), status: "failed" as const, output: null }];
    expect(nextAction(steps, 1, 3)).toEqual({ kind: "step", agent: "planning", version: 1, round: 1 });
  });

  it("loops planning and review until approval", () => {
    const steps = [ok("intake"), ok("planning:v1:r1"), ok("review:v1:r1", { approved: false }), ok("planning:v1:r2")];
    expect(nextAction(steps, 1, 3)).toEqual({ kind: "step", agent: "review", version: 1, round: 2 });
    steps.push(ok("review:v1:r2", { approved: true }));
    expect(nextAction(steps, 1, 3)).toMatchObject({ kind: "done", approved: true, round: 2 });
  });

  it("stops after the bounded number of rounds", () => {
    const steps = [ok("intake"), ...[1, 2].flatMap((r) => [ok(`planning:v1:r${r}`), ok(`review:v1:r${r}`, { approved: false })])];
    expect(nextAction(steps, 1, 2)).toMatchObject({ kind: "done", approved: false });
  });

  it("reruns planning for a new context version but reuses intake", () => {
    const steps = [ok("intake"), ok("planning:v1:r1"), ok("review:v1:r1", { approved: true })];
    expect(nextAction(steps, 2, 3)).toEqual({ kind: "step", agent: "planning", version: 2, round: 1 });
  });
});
