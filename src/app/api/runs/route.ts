import { z } from "zod";
import { createRun, listRuns } from "@/lib/orchestrator";
import { CompanyRules } from "@/lib/schemas";
import { handle, sessionId } from "@/lib/session";

const CreateRun = z.object({
  transcript: z.string().min(20).max(30000),
  rules: CompanyRules,
  faults: z
    .object({ fail_intake: z.boolean(), fail_planning: z.boolean(), fail_review: z.boolean(), rule_violation: z.boolean() })
    .partial()
    .default({}),
});

export async function GET() {
  return handle(async () => listRuns(await sessionId()));
}

export async function POST(req: Request) {
  return handle(async () => {
    const body = CreateRun.parse(await req.json());
    return { id: await createRun(await sessionId(), body.transcript, body.rules, body.faults) };
  });
}
