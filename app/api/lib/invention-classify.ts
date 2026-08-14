const INVENTION_TERMS = /(нов(ый|ые) материал|материаловед|ретросинтез|синтез(ировать|а)|молекул|кристалл|лаборатор|препарат|протеин|геном|discover|materials? design|retrosynthesis|autonomous lab|molecular)/i;
const SPHERES: Array<[string, RegExp]> = [
  ["chemistry", /хими|молекул|синтез|chemistry|chemical/i],
  ["materials", /материал|кристалл|material|battery|alloy/i],
  ["biology", /биолог|геном|протеин|biology|protein|genome/i],
  ["medicine", /медицин|лекар|medicine|drug|clinical/i],
  ["engineering", /инженер|робот|engineering|robotics/i],
];

export function classifyInvention(text: string) {
  const normalized = text.trim();
  const spheres = SPHERES.filter(([, pattern]) => pattern.test(normalized)).map(([name]) => name);
  return {
    isInvention: INVENTION_TERMS.test(normalized),
    section: INVENTION_TERMS.test(normalized) ? "invention-tools" : "ai-news",
    sphereTags: spheres,
  } as const;
}
