export type AgentKey = "intake" | "planning" | "review";

export const AGENTS: { key: AgentKey; name: string }[] = [
  { key: "intake", name: "Intake" },
  { key: "planning", name: "Planning" },
  { key: "review", name: "Review" },
];

export const agentName = (a: string) => AGENTS.find((x) => x.key === a)?.name ?? a;

const MARK = "[SIMULATED FAULT]";

/** Pulls the "[SIMULATED FAULT]" marker out of a message so the UI can show it as a tag instead. */
export function splitSimulated(text: string): { simulated: boolean; text: string } {
  const simulated = text.includes(MARK);
  if (!simulated) return { simulated, text };
  const rest = text.replace(MARK, "").replace(/\s{2,}/g, " ").trim();
  return { simulated, text: rest.charAt(0).toUpperCase() + rest.slice(1) };
}
