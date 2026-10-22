import { getRunView } from "@/lib/orchestrator";
import { handle, sessionId } from "@/lib/session";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => getRunView(await sessionId(), id));
}
