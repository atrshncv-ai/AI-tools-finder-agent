import { getDb } from "./connection";
import { news, categories } from "@db/schema";
import { eq, desc, and, count, sql } from "drizzle-orm";
import { classifyArticle } from "../lib/classify";

// ─── Seed categories ───
export async function seedCategories() {
  const db = getDb();
  const existing = await db.select().from(categories);
  if (existing.length > 0) return;

  const cats = [
    { name: "Новая LLM", slug: "new-llm", type: "general" },
    { name: "ИИ-агент", slug: "ai-agent", type: "general" },
    { name: "Сравнение", slug: "comparison", type: "general" },
    { name: "Бенчмарки", slug: "benchmarks", type: "general" },
    { name: "Обновления", slug: "updates", type: "general" },
    { name: "Химия", slug: "chemistry", type: "science" },
    { name: "Материаловедение", slug: "materials", type: "science" },
    { name: "Биология", slug: "biology", type: "science" },
    { name: "Медицина", slug: "medicine", type: "science" },
    { name: "Физика", slug: "physics", type: "science" },
    { name: "Инженерия", slug: "engineering", type: "science" },
  ];

  for (const c of cats) {
    await db.insert(categories).values(c);
  }
}

// ─── Seed news ───
export async function seedNews() {
  const db = getDb();
  const existing = await db.select().from(news);
  if (existing.length > 0) return;

  const articles = [
    {
      title: "OpenAI выпустила GPT-5 с поддержкой мультимодального рассуждения в реальном времени",
      summary: "Новая модель демонстрирует значительный прогресс в задачах, требующих логического вывода. GPT-5 поддерживает одновременную обработку текста, изображений и аудио с контекстным окном до 2 млн токенов.",
      content: "OpenAI анонсировала выпуск GPT-5 — следующего поколения большой языковой модели. Ключевые улучшения включают:\n\n• Мультимодальное рассуждение в реальном времени\n• Контекстное окно до 2 миллионов токенов\n• Улучшенные математические и научные способности\n• Поддержка видеоанализа\n• Снижение стоимости API на 40% по сравнению с GPT-4o\n\nБенчмарки показывают 15% improvement в MATH и 22% в Codeforces по сравнению с предыдущей версией.",
      originalUrl: "https://openai.com/blog/gpt-5",
      source: "OpenAI Blog",
      categorySlug: "new-llm",
      tags: "GPT-5,OpenAI,LLM,мультимодальность",
      publishedAt: new Date("2026-06-10T09:00:00Z"),
      isScience: false,
    },
    {
      title: "Google DeepMind представила AlphaFold 4: предсказание структуры белков за секунды",
      summary: "Четвёртое поколение системы предсказывает структуры белкововых комплексов с точностью 95%. Новая версия значительно ускоряет процесс исследований в фармацевтике.",
      content: "DeepMind выпустила AlphaFold 4 — новую версию системы предсказания структуры белков. Основные нововведения:\n\n• Предсказание структур белкововых комплексов за секунды\n• Точность 95% на тестовых наборах данных\n• Поддержка мембранных белков\n• Интеграция с базами данных лекарственных соединений\n• Открытый API для академических исследователей\n\nСистема уже используется в 12 фармацевтических компаниях для разработки новых препаратов.",
      originalUrl: "https://deepmind.google/discover/blog/alphafold-4",
      source: "Google DeepMind",
      categorySlug: "biology",
      tags: "AlphaFold,DeepMind,белки,структура",
      publishedAt: new Date("2026-06-09T14:30:00Z"),
      isScience: true,
      scienceField: "Биология",
    },
    {
      title: "Anthropic Claude 4: революция в длинном контексте и агентских возможностях",
      summary: "Claude 4 от Anthropic устанавливает новый стандарт для агентских ИИ-систем. Модель может автономно выполнять сложные многошаговые задачи, работая с контекстом до 1 млн токенов.",
      content: "Anthropic представила Claude 4 с революционными агентскими возможностями:\n\n• Автономное выполнение многошаговых задач\n• Контекст до 1 миллиона токенов\n• Интеграция с 50+ инструментами\n• Улучшенная безопасность и контроль\n• Новый режим 'Research Agent' для глубокого анализа\n\nClaude 4 демонстрирует state-of-the-art результаты в SWE-bench и HumanEval.",
      originalUrl: "https://anthropic.com/news/claude-4",
      source: "Anthropic",
      categorySlug: "ai-agent",
      tags: "Claude,Anthropic,агент,контекст",
      publishedAt: new Date("2026-06-08T11:00:00Z"),
      isScience: false,
    },
    {
      title: "Microsoft Research открыла MatterGen: генерация новых материалов с помощью ИИ",
      summary: "Новая диффузионная модель генерирует структуры кристаллических материалов с заданными свойствами. Система предсказывает стабильные соединения, которые ранее не встречались в природе.",
      content: "Microsoft Research представила MatterGen — систему на основе диффузионных моделей для генерации кристаллических материалов:\n\n• Генерация стабильных кристаллических структур\n• Предсказание свойств: проводимость, прочность, оптические характеристики\n• 62% сгенерированных структур оказались стабильными при экспериментальной проверке\n• Интеграция с роботизированными лабораториями\n• Открытый доступ для академических исследований\n\nПроект MatterGen уже привлёк внимание 200+ материаловедческих лабораторий по всему миру.",
      originalUrl: "https://www.microsoft.com/en-us/research/blog/mattergen",
      source: "Microsoft Research",
      categorySlug: "materials",
      tags: "MatterGen,материаловедение,диффузия,кристаллы",
      publishedAt: new Date("2026-06-07T08:00:00Z"),
      isScience: true,
      scienceField: "Материаловедение",
    },
    {
      title: "Сравнение Llama 4, GPT-5 и Claude 4: кто лидирует в 2026 году?",
      summary: "Комплексное тестирование трёх ведущих LLM показало, что каждая модель имеет свои сильные стороны. GPT-5 лидирует в креативности, Claude 4 — в агентских задачах, Llama 4 — в эффективности.",
      content: "Проведено масштабное сравнение трёх ведущих языковых моделей 2026 года:\n\n**GPT-5 (OpenAI):**\n• Лучший в креативном письме и генерации идей\n• Сильнейший мультимодальный анализ\n• Высокая стоимость API\n\n**Claude 4 (Anthropic):**\n• Лидер в агентских задачах и программировании\n• Лучшая безопасность и контроль\n• Отличная работа с длинным контекстом\n\n**Llama 4 (Meta):**\n• Наиболее эффективная с точки зрения ресурсов\n• Открытые веса\n• Хорошая производительность при локальном развёртывании\n\nВыбор модели зависит от конкретных задач и бюджета.",
      originalUrl: "https://arxiv.org/abs/2606.01234",
      source: "ArXiv / AI Benchmarks",
      categorySlug: "comparison",
      tags: "Llama,GPT-5,Claude,сравнение,бенчмарки",
      publishedAt: new Date("2026-06-06T16:00:00Z"),
      isScience: false,
    },
    {
      title: "NVIDIA представила AI-чип Grace Hopper Next для научных вычислений",
      summary: "Новый чип обеспечивает 10-кратное увеличение производительности в задачах молекулярного моделирования по сравнению с предыдущим поколением.",
      content: "NVIDIA анонсировала процессор Grace Hopper Next, специально разработанный для ИИ-научных вычислений:\n\n• 10x производительность в молекулярном моделировании\n• 2 петафлопс FP64 для научных расчётов\n• Интегрированная HBM4 память 576 ГБ\n• Поддержка симуляций методом молекулярной динамики\n• Оптимизация для AlphaFold, OpenMM, GROMACS\n\nЧип уже доступен в облачных инстансах AWS и Google Cloud.",
      originalUrl: "https://nvidia.com/en-us/data-center/grace-hopper-next",
      source: "NVIDIA Newsroom",
      categorySlug: "engineering",
      tags: "NVIDIA,Grace Hopper,чип,вычисления",
      publishedAt: new Date("2026-06-05T10:00:00Z"),
      isScience: true,
      scienceField: "Инженерия",
    },
    {
      title: "Perplexity AI запустила Deep Research: автономный научный анализ",
      summary: "Новая функция позволяет проводить глубокий многошаговый анализ научных тем, собирая информацию из 100+ источников и формируя структурированный отчёт.",
      content: "Perplexity AI представила режим Deep Research:\n\n• Автономный поиск и анализ 100+ источников\n• Генерация структурированных отчётов с цитированием\n• Поддержка научных баз данных: PubMed, arXiv, Semantic Scholar\n• Проверка фактов и выявление противоречий\n• Экспорт в PDF, LaTeX, Markdown\n\nФункция доступна для подписчиков Pro и Enterprise.",
      originalUrl: "https://perplexity.ai/hub/blog/deep-research",
      source: "Perplexity AI",
      categorySlug: "ai-agent",
      tags: "Perplexity,Deep Research,поиск,анализ",
      publishedAt: new Date("2026-06-04T13:00:00Z"),
      isScience: false,
    },
    {
      title: "MIT: ИИ-платформа открыла 14 новых катализаторов для синтеза органических соединений",
      summary: "Обученная на 2 млн реакций модель предсказала катализаторы, которые повышают выход целевых продуктов на 30-60%. Три из них уже подтверждены экспериментально.",
      content: "Исследователи MIT разработали ИИ-платформу для открытия катализаторов:\n\n• Обучение на базе из 2 миллионов химических реакций\n• Предсказание 14 новых катализаторов\n• Увеличение выхода продуктов на 30-60%\n• Экспериментальное подтверждение 3 катализаторов\n• Публикация в Nature Chemistry\n\nПлатформа доступна как open-source проект на GitHub.",
      originalUrl: "https://news.mit.edu/2026/ai-catalysts-organic-synthesis",
      source: "MIT News",
      categorySlug: "chemistry",
      tags: "MIT,катализаторы,химия,органический синтез",
      publishedAt: new Date("2026-06-03T07:00:00Z"),
      isScience: true,
      scienceField: "Химия",
    },
    {
      title: "xAI Grok 3: интеграция с Tesla Bot и реальным миром",
      summary: "Grok 3 получил возможность управлять роботами Tesla Bot через естественно-языковые инструкции. Модель демонстрирует понимание физических объектов и пространственных отношений.",
      content: "xAI представила Grok 3 с интеграцией робототехники:\n\n• Управление Tesla Bot через текстовые команды\n• Понимание физических объектов и пространства\n• Выполнение бытовых задач: уборка, организация предметов\n• Интеграция с датчиками робота (камеры, тактильные сенсоры)\n• Обучение через имитационное обучение\n\nДемонстрация проведена на конференции xAI Robotics Summit 2026.",
      originalUrl: "https://x.ai/blog/grok-3-robotics",
      source: "xAI Blog",
      categorySlug: "updates",
      tags: "Grok,xAI,Tesla Bot,робототехника",
      publishedAt: new Date("2026-06-02T15:00:00Z"),
      isScience: false,
    },
    {
      title: "Cohere представила Command R Ultra: лучшая модель для enterprise-задач",
      summary: "Command R Ultra превосходит конкурентов в задачах RAG, суммаризации документов и анализе данных. Модель поддерживает 256K контекст и интеграцию с 40+ enterprise-системами.",
      content: "Cohere выпустила Command R Ultra для корпоративных задач:\n\n• Контекст 256K токенов\n• Интеграция с 40+ enterprise-системами\n• Лидерство в RAG-бенчмарках\n• Мультиязычная поддержка (23 языка)\n• Приватное развёртывание on-premise\n\nКомпания уже подписала контракты с 15 Fortune 500 компаниями.",
      originalUrl: "https://cohere.com/blog/command-r-ultra",
      source: "Cohere",
      categorySlug: "new-llm",
      tags: "Cohere,Command R,enterprise,RAG",
      publishedAt: new Date("2026-06-01T09:00:00Z"),
      isScience: false,
    },
    {
      title: "IBM Quantum + ИИ: квантовые нейронные сети для симуляции молекул",
      summary: "Гибридная система квантового компьютера и ИИ достигла точности 99.2% в симуляции молекул водорода до 20 атомов. Продвинутый подход открывает путь к точному моделированию химических реакций.",
      content: "IBM Research представила гибридную квантово-ИИ систему:\n\n• Точность 99.2% в симуляции молекул H2O до 20 атомов\n• Квантовые нейронные сети на 127-кубитном процессоре\n• Классическая ИИ-оптимизация параметров\n• Симуляция химических реакций в реальном времени\n• Публикация в Nature\n\nПроект открывает путь к проектированию новых материалов и лекарств.",
      originalUrl: "https://research.ibm.com/blog/quantum-ai-molecules",
      source: "IBM Research",
      categorySlug: "physics",
      tags: "IBM,квантовый,молекулы,симуляция",
      publishedAt: new Date("2026-05-31T11:00:00Z"),
      isScience: true,
      scienceField: "Физика",
    },
    {
      title: "Stability AI запустила Stable Diffusion 4: фотореалистичная генерация видео",
      summary: "Stable Diffusion 4 генерирует видео длительностью до 60 секунд с разрешением 4K. Модель поддерживает точный контроль движения камеры и стилевые переходы.",
      content: "Stability AI представила Stable Diffusion 4:\n\n• Генерация видео до 60 секунд в 4K\n• Контроль движения камеры (pan, zoom, orbit)\n• Стилевые переходы между кадрами\n• Генерация персонажей с консистентной внешностью\n• Open-source веса для некоммерческого использования\n\nМодель обучена на 500 млн видео-клипах высокого качества.",
      originalUrl: "https://stability.ai/news/stable-diffusion-4",
      source: "Stability AI",
      categorySlug: "updates",
      tags: "Stable Diffusion,видео,генерация,Stability AI",
      publishedAt: new Date("2026-05-30T14:00:00Z"),
      isScience: false,
    },
  ];

  for (const article of articles) {
    const cat = await db.query.categories.findFirst({
      where: eq(categories.slug, article.categorySlug!),
    });

    const classification = classifyArticle(article.title, article.summary);

    await db.insert(news).values({
      ...article,
      publishedAt: article.publishedAt instanceof Date ? article.publishedAt : new Date(article.publishedAt),
      categoryId: cat?.id ?? null,
      classificationType: classification.classificationType,
      language: "ru",
      status: "published",
      updatedAt: new Date(),
    });
  }
}

// ─── Queries ───
export async function findAllNews(opts: {
  isScience?: boolean;
  categorySlug?: string;
  classificationType?: string;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  const db = getDb();
  const { isScience, categorySlug, classificationType, search, limit = 50, offset = 0 } = opts;

  const conditions = [];

  conditions.push(eq(news.status, "published"));

  if (isScience !== undefined) {
    conditions.push(eq(news.isScience, isScience));
  }

  if (categorySlug) {
    conditions.push(eq(news.categorySlug, categorySlug));
  }

  if (classificationType) {
    conditions.push(eq(news.classificationType, classificationType));
  }

  if (search) {
    const q = search.trim();
    if (q.length > 0) {
      conditions.push(
        sql`to_tsvector('russian', ${news.title} || ' ' || coalesce(${news.summary}, '') || ' ' || coalesce(${news.content}, '') || ' ' || coalesce(${news.translation}, '')) @@ plainto_tsquery('russian', ${q})`,
      );
    }
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const items = await db
    .select()
    .from(news)
    .where(where)
    .orderBy(desc(news.publishedAt))
    .limit(limit)
    .offset(offset);

  const [totalResult] = await db
    .select({ count: count() })
    .from(news)
    .where(where);

  return { items, total: totalResult.count };
}

export async function findNewsById(id: number) {
  const db = getDb();
  return db.query.news.findFirst({
    where: eq(news.id, id),
    with: { category: true },
  });
}

export async function findCategories(type?: "general" | "science") {
  const db = getDb();
  if (type) {
    return db.select().from(categories).where(eq(categories.type, type));
  }
  return db.select().from(categories);
}
