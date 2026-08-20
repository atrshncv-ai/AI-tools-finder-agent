export type InventionToolListItem = {
  id: number;
  name: string;
  spheres: string[];
  lastVerifiedAt: Date | string | null;
  updatedAt: Date | string;
  createdAt: Date | string;
};

export type FreshnessKey = "all" | "day" | "3days" | "week" | "month";

// The catalog must be ordered by when the tool was added/updated, NOT by
// lastVerifiedAt: a nightly batch verification stamps every row with today's
// date, which previously pushed all old tools to the top of the list and made
// the "24 hours" filter show the whole catalog. The counter and freshness
// filter now reflect the real number of tools added/updated in the period.
export function inventionToolFreshnessDate(tool: InventionToolListItem): Date {
  return new Date(tool.updatedAt ?? tool.createdAt);
}

/** Sorts without mutating the query result; id makes equal timestamps deterministic. */
export function sortInventionTools<T extends InventionToolListItem>(tools: T[]): T[] {
  return [...tools].sort((a, b) => {
    const dateDifference = inventionToolFreshnessDate(b).getTime() - inventionToolFreshnessDate(a).getTime();
    return dateDifference || b.id - a.id;
  });
}

export function filterInventionToolsBySpheres<T extends InventionToolListItem>(tools: T[], spheres: string[]): T[] {
  if (spheres.length === 0) return tools;
  return tools.filter((tool) => tool.spheres.some((sphere) => spheres.includes(sphere)));
}

export function filterInventionToolsByFreshness<T extends InventionToolListItem>(
  tools: T[],
  freshness: FreshnessKey,
  now = Date.now(),
): T[] {
  if (freshness === "all") return tools;
  const hours = freshness === "day" ? 24 : freshness === "3days" ? 72 : freshness === "week" ? 168 : 720;
  const cutoff = now - hours * 3_600_000;
  return tools.filter((tool) => inventionToolFreshnessDate(tool).getTime() >= cutoff);
}
