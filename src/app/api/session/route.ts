import { handle, sessionId } from "@/lib/session";

export async function GET() {
  return handle(async () => ({ session_id: await sessionId() }));
}
