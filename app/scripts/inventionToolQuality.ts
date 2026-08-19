export type InventionToolSeed = {
  slug: string;
  name: string;
  kind: string;
  spheres: readonly string[];
  description: string;
  officialUrl: string;
};

const HTTP_URL = /^https?:\/\/\S+$/i;

/** Validate the catalog boundary before a seed can insert or update a row. */
export function validateInventionTool(tool: InventionToolSeed): void {
  const errors: string[] = [];
  if (!tool.slug.trim()) errors.push("slug is required");
  if (!tool.name.trim()) errors.push("name is required");
  if (!tool.kind.trim()) errors.push("kind is required");
  if (tool.spheres.length === 0) errors.push("at least one scientific sphere is required");
  if (!tool.description.trim()) errors.push("description is required");
  if (!HTTP_URL.test(tool.officialUrl.trim())) errors.push("officialUrl must be an http(s) URL");
  if (errors.length > 0) throw new Error(`Invalid invention tool ${tool.slug || "<unknown>"}: ${errors.join(", ")}`);
}
