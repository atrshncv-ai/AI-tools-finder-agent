const SCIENCE_FIELD_KEYWORDS: Record<string, string[]> = {
  chemistry: [
    "химия", "chemistry", "chemical", "синтез", "synthesis", "катализ", "catalysis",
    "молекула", "molecule", "органичес", "organic", "неорганич", "inorganic",
    "полимер", "polymer", "электрохим", "electrochemistry", "спектр", "spectro",
  ],
  materials: [
    "материал", "material", "материаловед", "nanomaterial", "наноматериал",
    "кристалл", "crystal", "сплав", "alloy", "композит", "composite",
    "полупроводник", "semiconductor", "проводимость", "conductivity",
  ],
  biology: [
    "биолог", "biology", "biological", "белок", "protein",
    // "ген"/"gene" as bare substrings matched «генеральный/generative/general»
    // in full texts — use morphology-specific forms instead.
    "геном", "гены", "гена", "генов", "генн", "генетич",
    "genes", "genetic",
    "ДНК", "DNA", "РНК", "RNA", "клетк", "cell", "организм", "organism",
    "эволюц", "evolution", "биоинформат", "bioinformatics",
  ],
  medicine: [
    "медицин", "medicine", "medical", "лекарств", "drug", "фармацевт", "pharma",
    "лечени", "treatment", "диагност", "diagnosis", "болезн", "disease",
    "клиник", "clinical", "пациент", "patient", "вакцин", "vaccine",
  ],
  physics: [
    "физик", "physics", "physical", "квантов", "quantum", "частиц", "particle",
    "энерги", "energy", "оптик", "optics", "суперпровод", "superconductor",
    "термояд", "fusion", "астрофиз", "astrophysics",
  ],
  engineering: [
    // Research-flavored engineering only. Pure IT/hardware words (GPU, server,
    // chip, NVIDIA…) deliberately removed: they matched ordinary AI-industry
    // news on full text and flooded the science section (backfill 2026-08-25).
    "инженер", "engineering", "робот", "robot", "робототехн", "манипулятор",
    "вычислительная", "суперкомпьютер",
  ],
};

const SCIENCE_AI_PATTERNS = [
  /(^|[^\p{L}\p{N}])ии([^\p{L}\p{N}]|$)/u, /искусственн/u, /нейросет/u, /нейронн/u,
  /\bai\b/u, /artificial intelligence/u, /machine learning/u, /машинн.*обуч/u, /deep learning/u,
  /глубок.*обуч/u, /neural network/u, /нейронная сеть/u, /\bllm\b/u,
  /large language model/u, /генеративн/u,
];

/**
 * Explicit AI/ML signal: generic terms (EN+RU) plus well-known model/tool
 * names that generic terms miss (AlphaFold, GPT, diffusion models, …).
 * Shared by the science classifier, the invention classifier and the
 * evaluate-news hard relevance gate — keep ONE dictionary here.
 */
const EXPLICIT_AI_PATTERNS: RegExp[] = [
  ...SCIENCE_AI_PATTERNS,
  /\bgpt\b/u, /chatgpt/u, /\bclaude\b/u, /\bgemini\b/u, /\bllama\b/u, /deepseek/u, /mistral/i,
  /\bbert\b/u, /transformer/i, /diffusion model/i, /\bdiffusion\b/i,
  /alphafold/i, /rosettafold/i, /diffdock/i, /proteinmpnn/i, /esmfold/i,
  /deepmind/i, /\bcopilot\b/i, /\bmidjourney\b/i, /\bsora\b/i, /\bdall-e\b/i,
];

export function hasExplicitAiSignal(text: string): boolean {
  // Case-insensitive by normalisation (patterns are written lowercase).
  const combined = text.toLowerCase();
  return EXPLICIT_AI_PATTERNS.some((pattern) => pattern.test(combined));
}

const CLASSIFICATION_TYPE_KEYWORDS: Record<string, string[]> = {
  new_tool: [
    "новый", "new", "запуск", "launch", "релиз", "release", "анонс", "announce",
    "представил", "introduced", "выпустил", "released", "дебют", "debut",
    "первый", "first", "brand new", "completely new",
  ],
  update: [
    "обновлени", "update", "улучшени", "improvement", "апгрейд", "upgrade",
    "новая версия", "new version", "patch", "патч", "v2", "v3", "v4", "v5",
    "версия", "version", "обновил", "updated", "улучшил", "enhanced",
    "расширил", "expanded", "добавил", "added",
  ],
  closure: [
    "закры", "closing", "closed", "прекращ", "discontinued", "удален", "removed",
    "deprecated", "end of life", "eol", "закрытие", "shutdown", "сворачивает",
    "stopped", "terminated", "cancelled",
  ],
  achievement: [
    "достижени", "achievement", "результат", "result", "открыти", "discovery",
    "прорыв", "breakthrough", "рекорд", "record", "победил", "won", "победа",
    "лидер", "leader", "первая", "first place", "наград", "award",
    "успех", "success", "превзошёл", "outperformed",
  ],
};

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "new-llm": [
    "новая llm", "new llm", "выпуск модели", "model release", "запуск модели",
    "model launch", "анонс модели", "представила", "announced", "выпустила",
    "launched", "gpt", "claude", "llama", "gemini", "gemma", "mistral",
    "qwen", "deepseek", "command r",
  ],
  "ai-agent": [
    "агент", "agent", "автономн", "autonomous", "оркестр", "orchestrat",
    "многошагов", "multi-step", "tool use", "function call",
    "reasoning", "рассуждени",
  ],
  "comparison": [
    "сравнени", "compar", "versus", "vs ", "benchmark", "бенчмарк",
    "кто лучше", "who is better", "тестирование", "testing",
    "лидер", "leader", "рейтинг", "rating",
  ],
  "benchmarks": [
    "benchmark", "бенчмарк", "оценк", "evaluation", "метрик", "metric",
    "accuracy", "точност", "performance", "производительн",
    "swe-bench", "humaneval", "mmlu", "gpqa",
  ],
  "updates": [
    "обновлени", "update", "улучшени", "improvement", "апгрейд", "upgrade",
    "новая версия", "new version", "patch", "патч", "v2", "v3", "v4",
    "версия", "version",
  ],
};

export type ClassificationType = "new_tool" | "update" | "closure" | "achievement" | null;

export interface ClassificationResult {
  isScience: boolean;
  scienceField: string | null;
  categorySlug: string | null;
  classificationType: ClassificationType;
}

function matchesKeywords(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => {
    // Latin keywords match at a word boundary: bare substring matching made
    // «gene» hit «general/generative» and «cell» hit «excellent» inside
    // full article texts / YouTube transcripts. Cyrillic keywords stay
    // prefix-substring (morphology: клетк→клетки, биолог→биологии).
    if (/[a-z]/i.test(kw)) {
      return new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(lower);
    }
    return lower.includes(kw);
  });
}

export function classifyArticle(title: string, description: string): ClassificationResult {
  const combined = `${title} ${description}`.toLowerCase();

  const hasScienceDomain = Object.values(SCIENCE_FIELD_KEYWORDS).some((keywords) =>
    matchesKeywords(combined, keywords),
  );
  const hasAiSignal = hasExplicitAiSignal(combined);
  const isScience = hasScienceDomain && hasAiSignal;
  let scienceField: string | null = null;

  if (isScience) {
    for (const [field, keywords] of Object.entries(SCIENCE_FIELD_KEYWORDS)) {
      if (matchesKeywords(combined, keywords)) {
        scienceField = field;
        break;
      }
    }
  }

  let categorySlug: string | null = null;
  for (const [slug, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (matchesKeywords(combined, keywords)) {
      categorySlug = slug;
      break;
    }
  }

  let classificationType: ClassificationType = null;
  if (isScience) {
    for (const [type, keywords] of Object.entries(CLASSIFICATION_TYPE_KEYWORDS)) {
      if (matchesKeywords(combined, keywords)) {
        classificationType = type as ClassificationType;
        break;
      }
    }
  }

  return { isScience, scienceField, categorySlug, classificationType };
}
