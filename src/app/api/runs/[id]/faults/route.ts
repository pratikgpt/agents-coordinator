import { z } from "zod";
import { getRunView, setFaults } from "@/lib/orchestrator";
import { handle, sessionId } from "@/lib/session";

const Body = z.object({ fail_intake: z.boolean(), fail_planning: z.boolean(), fail_review: z.boolean(), rule_violation: z.boolean() }).partial();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const sid = await sessionId();
    await setFaults(sid, id, Body.parse(await req.json()));
    return getRunView(sid, id);
  });
}
