import { advanceRun, getRunView } from "@/lib/orchestrator";
import { handle, sessionId } from "@/lib/session";

export const maxDuration = 300; // one LLM step (plus one repair attempt) per request

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const sid = await sessionId();
    const result = await advanceRun(sid, id);
    return { result, view: await getRunView(sid, id) };
  });
}
