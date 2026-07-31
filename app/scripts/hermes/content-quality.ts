export type ExtractedContentKind = "web-article" | "youtube-transcript";

export function isGarbageText(text: string): boolean {
  if (!text || text.trim().length < 40) return true;
  const sentences = text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  const counts = new Map<string, number>();
  for (const sentence of sentences) {
    const key = sentence.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.values()].some((count) => count > 3);
}

export function isUnusableExtractedContent(
  text: string,
  kind: ExtractedContentKind,
): boolean {
  if (!text || text.trim().length < 40) return true;
  return kind === "web-article" && isGarbageText(text);
}
