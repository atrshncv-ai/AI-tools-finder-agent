export type DashboardSection = "ai-news" | "science" | "invention-tools";

export function getSectionQuery(section: DashboardSection): { section: DashboardSection } {
  return { section };
}
