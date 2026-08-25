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
  /** Accepted for API stability; classifiers intentionally do not scan it. */
  content?: string | null;
}): SectionResolution {
  const title = (input.title || "").trim();
  const description = (input.description ?? "").trim();

  // Science detection runs on title + description ONLY (RSS snippet or the
  // generated Russian summary): both are dense and curated. Full article
  // text is full of incidental domain words («граничные клетки», «organic
  // traffic») that faked science domains during the 2026-08-25 backfill.
  //
  // Invention detection likewise runs on title + description ONLY: a
  // 10k-char transcript almost always contains «ДНК/protein/quantum» in
  // metaphors or passing mentions («ДНК компании», Google downfall retelling
  // AlphaFold history), which faked invention matches (backfill 25.08).
  // Genuine AI-for-science stories carry their topic in the summary.
  const classification = classifyArticle(title, description);
  const invention = classifyInvention(buildInventionContext(title, description));

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
