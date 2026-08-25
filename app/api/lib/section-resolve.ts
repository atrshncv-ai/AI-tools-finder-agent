/**
 * section-resolve.ts — Single source of truth for three-way section routing.
 *
 * Priority: invention-tools (AI tool/discovery) > science (AI × science
 * domain) > ai-news. Every pipeline stage that (re)assigns a section MUST use
 * this helper so the decision is identical whether it sees only an RSS
 * snippet (collect), the fetched page text (evaluate) or the Russian
 * title/summary/full text (save-summary). The resolution is data-driven and
 * bidirectional: a later stage with richer text may move an article OUT of a
 * section an earlier stage picked on sparse input.
 */

import { classifyArticle } from "./classify";
import { classifyInvention, buildInventionContext } from "./invention-classify";

export type Section = "ai-news" | "science" | "invention-tools";

export interface SectionResolution {
  isScience: boolean;
  scienceField: string | null;
  section: Section;
  sphereTags: string[];
}

export function resolveSection(input: {
  title: string;
  description?: string | null;
  content?: string | null;
}): SectionResolution {
  const title = (input.title || "").trim();
  const description = (input.description ?? "").trim();
  const content = (input.content ?? "").trim();

  // Full text counts for both classifiers: RSS snippets are often too sparse
  // to show the AI/science connection that the article body makes obvious.
  const classification = classifyArticle(title, `${description} ${content}`.trim());
  const invention = classifyInvention(buildInventionContext(title, description, content));

  const section: Section = invention.isInvention
    ? "invention-tools"
    : classification.isScience
      ? "science"
      : "ai-news";

  return {
    isScience: classification.isScience,
    scienceField: classification.scienceField,
    section,
    // Sphere tags describe invention-tools cards; keep them scoped to that
    // section so unrelated news never carries catalog filters.
    sphereTags: invention.isInvention ? invention.sphereTags : [],
  };
}
