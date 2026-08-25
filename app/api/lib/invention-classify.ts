/**
 * invention-classify.ts — Classifies whether an article is about an
 * AI-for-science discovery tool (invention-tools section) and assigns
 * sphere tags that match the invention_tools catalog.
 *
 * Shared by the Hermes pipeline (collect-dual → evaluate-news) and the
 * parseAgent API.  An invention candidate must describe a discovery/design
 * topic AND carry an explicit AI signal — household medical/biological
 * vocabulary alone never routes here.
 */

import { hasExplicitAiSignal } from "./classify";

// ── Invention detection ────────────────────────────────────────────────────
// The regex must match titles + summaries of articles about AI tools that
// *discover*, *design*, or *invent* new molecules, materials, algorithms,
// or scientific solutions. Household science/medical vocabulary is NOT enough:
// since the client feedback of 2026-08-25 an invention candidate must ALSO
// carry an explicit AI signal (see AI requirement in classifyInvention).

const INVENTION_ALTS: string[] = [
  // Chemistry & molecules
  "нов(?:ый|ые|ых) (?:материал|молекул|катализатор)",
  "материаловед|ретросинтез|retrosynthesis",
  "молекул(?:а|ы|ьное|ьный|екулярн)",
  "кристалл(?:ограф|ическое|ический)",
  "докинг",
  "электронная структур",
  "DFT|density functional|квантовая химия",
  // Biology & proteins (both RU and EN)
  "протеин|protein",
  "геном(?:ик|ика)|genome",
  "стволовые клетк",
  "белков(?:ая|ую|ой) структур|protein structure",
  // Protein folding only — bare "folding"/"сворачив" also matches
  // foldable phones with AI features.
  "фолдинг|protein folding|сворачивание белк",
  "peptide|пептид",
  // Gene editing & CRISPR
  "CRISPR|crispr",
  "base editing|редактирование (?:ген|баз|ДНК|DNA)",
  "gene editing|генное редактирован",
  "DNA|ДНК",
  // Drug discovery & design (targeted, not generic clinical vocabulary)
  "drug discover|drug design|лекарственн(?:ый|ое) дизайн",
  // Materials & energy
  "батаре[яйю]|аккумулятор|электрод|энергонакопит",
  "перовскит|alloy|сплав",
  "суперпроводник",
  // Climate & weather
  "климат(?:ическ|олог)|прогноз(?:ирование)? погоды",
  "углерод(?:ный|ной)|paris climate",
  // Quantum
  "квантов(?:ый|ая|ом|ые) (?:вычислени|компют|алгоритм|процессор|бит)",
  "квантовая запутанност",
  "quantum computing|qubit|кубит",
  // Astronomy
  "экзопланет|телескоп|астрономическ|астрофизик|галактик",
  "radio telescope|gravitational wav",
  // Mathematics
  "математическ(?:ая|ое|их)|доказательств|гипотез|теорем",
  // AI tools for science
  "AlphaFold|RoseTTAFold|DiffDock|ProteinMPNN|ESMFold",
  "nanopore|нанопор",
  // Generic discovery keywords
  // "screening" alone also matches resume/content screening — keep the
  // lab-specific phrasing.
  "de novo|high-throughput screening",
  "materials? design|materials? discovery",
  "retrosynthesis|autonomous lab",
];

const INVENTION_TERMS = new RegExp(INVENTION_ALTS.join("|"), "i");

// ── Sphere classification ───────────────────────────────────────────────────
// Each entry: [sphereSlug, regex].  A title/summary can match multiple spheres.

const SPHERES: Array<[string, RegExp]> = [
  ["chemistry", /хими|молекул|катализ|синтез|chemistry|chemical|retrosynthes|docking|drug design|pharm|pharmac/i],
  ["materials", /материал|кристалл|сплав|supercconduct|perovskit|alloy|material(?:s)? (?:design|discover)|nanopore|membran|cucurbituril/i],
  ["biology", /биолог|геном|протеин|бел(?:ок|ков|ковое)|protein|genome|biolog|CRISPR|cell|клетк|peptide|пептид|epigenet|DNA|ДНК|gene/i],
  ["medicine", /медицинск|лекарств|вакцин|терапи|клинич|medicine|drug discover|antibod|antibod|immunotherapy|oncolog/i],
  ["physics", /физик|quantum (?:computing|bit|algorithm)|квантов(?:ый|ая)|supercconduct|astrophysic|physics|DFT|density functional/i],
  ["climate", /климат|погод|atmospher|weather|climate|atmospher|greenhouse|carbon seques/i],
  ["astronomy", /астроном|астрофизик|галактик|телескоп|экзопланет|astronomy|exoplanet|telescope|radio telescope|gravitational/i],
  ["mathematics", /математик|доказательств|теорем|гипотез|optimiz|combinator|алгоритм|theorem|proof|mathematic/i],
  ["engineering", /инженер|робот|автономн|манипулятор|robot|engineering|robotics|autonomous|actuator|sensor/i],
  ["quantum", /квантов(?:ый|ая|ом)|qubit|кубит|quantum computing|quantum algorithm|quantum processor|quantum error/i],
  ["genomics", /геномик|геном|genomic|genome sequenc|DNA sequenc|RNA|transcriptom/i],
  ["energy", /батаре|аккумулятор|электрод|энергонакопит|электрохими|supercapacitor|battery|energ(?:y|ies) storage|fuel cell/i],
];

/**
 * Build the richest possible context for invention classification.
 * RSS often exposes only a title, while YouTube and fetched articles
 * can include a description or summary. Joining all available text
 * reduces false negatives on invention-tool candidates.
 */
export function buildInventionContext(
  title: string,
  description?: string | null,
  summary?: string | null,
): string {
  const parts = [title.trim()];
  if (description?.trim()) parts.push(description.trim());
  if (summary?.trim()) parts.push(summary.trim());
  return parts.join(". ");
}

/**
 * Diagnostics: which invention alternatives fire on this text.
 * Iterates the original alternatives array — splitting the joined regex
 * source would shred (?:...) groups into meaningless fragments.
 */
export function explainInventionMatch(text: string): string[] {
  const normalized = text.trim();
  return INVENTION_ALTS.filter((alt) => new RegExp(alt, "i").test(normalized));
}

/**
 * Classify whether an article describes an AI-for-science tool / discovery
 * and which spheres it belongs to.
 *
 * An invention candidate needs BOTH a discovery/tool topic AND an explicit
 * AI signal (generic medical/biology news has neither the AI part and is
 * rejected — client feedback 2026-08-25).
 *
 * @param text Combined title + summary (+ description if available).
 */
export function classifyInvention(text: string) {
  const normalized = text.trim();
  const isInvention = INVENTION_TERMS.test(normalized) && hasExplicitAiSignal(normalized);
  const sphereNames: Record<string, string> = {
    chemistry: "химия",
    materials: "материалы",
    biology: "биология",
    medicine: "медицина",
    physics: "физика",
    climate: "климат",
    astronomy: "астрономия",
    mathematics: "математика",
    engineering: "инженерия",
    quantum: "квантовые вычисления",
    genomics: "геномика",
    energy: "энергетика",
  };
  const spheres = SPHERES.filter(([, pattern]) => pattern.test(normalized)).map(
    ([name]) => sphereNames[name] || name,
  );

  // Section assignment mirrors the logic from parseAgent:
  //   invention → "invention-tools"
  //   science   → "science"
  //   default   → "ai-news"
  //
  // The caller must also check isScience from the source config, so we
  // export only the invention decision here; the section is determined
  // by the caller:
  //   section = isInvention ? "invention-tools"
  //           : isScience  ? "science"
  //           :              "ai-news"

  return { isInvention, section: isInvention ? "invention-tools" : "ai-news", sphereTags: spheres, spheres } as const;
}
