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
    "биолог", "biology", "biological", "белок", "protein", "ген", "gene",
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
    "инженер", "engineering", "робот", "robot", "чип", "chip", "процессор", "processor",
    "hardware", "железо", "вычислен", "computing", "сервер", "server",
    "GPU", "TPU", "NVIDIA", "AMD", "Intel",
  ],
};

const SCIENCE_TOOL_KEYWORDS = [
  "инструмент", "instrument", "tool", "платформа", "platform",
  "сервис", "service", "модель", "model", "framework", "фреймворк",
  "библиотека", "library", "api", "sdk",
];

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
  return keywords.some((kw) => lower.includes(kw));
}

export function classifyArticle(title: string, description: string): ClassificationResult {
  const combined = `${title} ${description}`.toLowerCase();

  let isScience = false;
  let scienceField: string | null = null;

  for (const [field, keywords] of Object.entries(SCIENCE_FIELD_KEYWORDS)) {
    if (matchesKeywords(combined, keywords)) {
      if (matchesKeywords(combined, SCIENCE_TOOL_KEYWORDS)) {
        isScience = true;
        scienceField = field;
        break;
      }
    }
  }

  if (!isScience) {
    for (const [field, keywords] of Object.entries(SCIENCE_FIELD_KEYWORDS)) {
      if (matchesKeywords(combined, keywords)) {
        isScience = true;
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
