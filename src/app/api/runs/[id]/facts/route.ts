import { z } from "zod";
import { correctFact, getRunView } from "@/lib/orchestrator";
import { handle, sessionId } from "@/lib/session";

const Body = z.object({ fact_id: z.string().regex(/^F\d+$/), text: z.string().min(1).max(2000) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const sid = await sessionId();
    const body = Body.parse(await req.json());
    await correctFact(sid, id, body.fact_id, body.text);
    return getRunView(sid, id);
  });
}
