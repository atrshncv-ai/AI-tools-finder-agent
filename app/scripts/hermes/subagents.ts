/** Niche routing shared by the Hermes orchestrator. Each subagent uses the
 * same transcript/dedup/evaluation pipeline; only source queries differ. */
export const HERMES_SUBAGENTS = [
  { id: "ai-news", label: "ИИ-новости", queryHints: ["AI releases", "AI tools", "research announcements"] },
  { id: "science", label: "ИИ для науки", queryHints: ["AI for science", "computational biology", "scientific research"] },
  { id: "invention-tools", label: "Инструменты для изобретений", queryHints: ["materials discovery AI", "retrosynthesis", "autonomous laboratory"] },
] as const;

export type HermesSubagentId = (typeof HERMES_SUBAGENTS)[number]["id"];

export function getSubagent(id: HermesSubagentId) {
  return HERMES_SUBAGENTS.find((agent) => agent.id === id)!;
}
