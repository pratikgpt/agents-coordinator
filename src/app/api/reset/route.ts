import { resetSession } from "@/lib/orchestrator";
import { handle, sessionId } from "@/lib/session";

export async function POST() {
  return handle(async () => {
    await resetSession(await sessionId());
    return { ok: true };
  });
}
