/**
 * relevance-fixtures.ts — the frozen labelled relevance set (R20, R20e).
 *
 * Every case is { material, provenance, expected verdict, model answers }:
 *   - `expected` — what the judge must conclude: onTopic, section, direction.
 *     Hand-labelled from the topic definitions in topics.ts, not from the code.
 *   - `sourceRef` — the verifiable anchor (reference.md class, brief quote) or
 *     the synthetic class the case exercises.
 *   - `note` — why: section · direction, and for the 26.08 cards the class of
 *     miss they represent ("электрика в биологии", product in science, …).
 *   - `modelReply` — the primary model answer replayed for this case.
 *   - `reviewReply` — the answer of the independent second call (the judge
 *     verifies its own verdict before publishing), or null when the primary
 *     answer is already rejected and no review must happen. The two replies are
 *     what make the set able to fail: a plausible-but-wrong primary answer
 *     (energy grids "classified" as biology) is caught only by the review
 *     layer, so deleting that layer turns R20e red.
 *
 * Sourcing (recorded deviation, checked by the test):
 * R20 asks for >=40 cases taken from the real 26.08 release and the user's
 * misses. The release itself (100 cards) was lost with the server, and
 * reference.md names only eleven card classes — 40 verifiably sourced cases
 * cannot be produced. The set therefore holds 11 reference.md classes + 1
 * brief-named miss class (12 sourced) and 48 synthetic cases that exercise the
 * same classes; the deviation is stated in RELEVANCE_SOURCING_NOTE and the test
 * asserts these exact numbers instead of a loose lower bound.
 *
 * Adding a case is cheap; a change that makes the judge disagree with the
 * labels lowers the accuracy the test enforces and fails the build (R20i).
 */

import type { DirectionId, SectionId } from "./topics";

export type FixtureOrigin = "release-26.08" | "user-miss" | "synthetic";

export interface FixtureVerdict {
  onTopic: boolean;
  section: SectionId;
  direction: DirectionId | null;
}

export interface RelevanceFixture {
  id: string;
  title: string;
  lead: string;
  source: string;
  origin: FixtureOrigin;
  /** Verifiable anchor: a reference.md class, a brief quote, or "synthetic: …". */
  sourceRef: string;
  /** Section · direction by meaning, or the class of miss for off-topic cards. */
  note: string;
  expected: FixtureVerdict;
  /** Raw primary model answer replayed by the stub in the test. */
  modelReply: string;
  /** Independent verification call answer; null when no review must happen. */
  reviewReply: string | null;
}

/** Declared size of the frozen set (R20: 60 examples). */
export const RELEVANCE_FIXTURE_COUNT = 60;
/** Cases tied to a card class named in reference.md (26.08 release). */
export const RELEASE_26_08_CASES = 11;
/** Cases tied to the miss the owner named in the brief. */
export const USER_MISS_CASES = 1;

/**
 * Recorded deviation from R20 (">=40 cases taken from the real release and the
 * user's misses"). reference.md names eleven card classes; the release itself
 * (100 cards) was lost with the server; the brief names one miss class. So 12
 * cases have a verifiable anchor and the other 48 are synthetic cases of the
 * same classes. The numbers above are asserted by the test — no loose floor.
 */
export const RELEVANCE_SOURCING_NOTE =
  "R20 просит >=40 кейсов из выпуска 26.08 и промахов пользователя. reference.md " +
  "называет 11 классов карточек, сам выпуск (100 карточек) утерян вместе с сервером, " +
  "а бриф 10.11 даёт один класс промаха («электрика»). Поэтому проверяемую привязку " +
  "имеют 12 кейсов (11 из reference.md + 1 из брифа), остальные 48 — синтетические " +
  "кейсы тех же классов; числа зафиксированы ниже и проверяются тестом.";

/** The build fails below this share of cases judged exactly as labelled. */
export const RELEVANCE_ACCURACY_FLOOR = 0.95;

function reply(
  onTopic: boolean,
  section: SectionId,
  direction: DirectionId | null,
  confidence: number,
  reason: string,
): string {
  return JSON.stringify({ onTopic, section, direction, confidence, reason });
}

/** Independent second call: the reviewer confirms the primary verdict. */
function reviewAgree(reason: string, confidence = 0.9): string {
  return JSON.stringify({ agree: true, confidence, reason });
}

/** Independent second call: the reviewer rejects a plausible-but-wrong verdict. */
function reviewDisagree(reason: string, confidence = 0.9): string {
  return JSON.stringify({ agree: false, confidence, reason });
}

/** Independent second call: the reviewer agrees but is not confident enough. */
function reviewDoubt(reason: string): string {
  return JSON.stringify({ agree: true, confidence: 0.55, reason });
}

export const RELEVANCE_FIXTURES: readonly RelevanceFixture[] = [

  // ── Cards of the 26.08 release that should never have been published ──────
  {
    id: "release-composites-perm",
    title: "Учёные Пермского Политеха создали композитные панели для авиации",
    lead: "Команда подобрала связующее и схему армирования: панели выдерживают нагрузку на 30% выше аналогов и дешевле в производстве.",
    source: "nplus1",
    origin: "release-26.08",
    sourceRef: "reference.md → «композиты Пермского Политеха» (блок «Что показал образец»)",
    note: "Промах: композиты без ИИ — не «ИИ-новости» (карточка выпуска 26.08, восстановлена по reference.md)",
    expected: { onTopic: false, section: "ai-news", direction: null },
    reviewReply: null,
    modelReply: reply(false, "ai-news", null, 0.9, "композиты, ИИ в материале нет"),
  },
  {
    id: "release-pbde-flame-retardants",
    title: "Антипирены на основе ПБДЭ: испытания показали рост токсичности при горении",
    lead: "Химики сравнили продукты горения нескольких составов и предложили менее опасную замену для кабельных оболочек.",
    source: "naked-science",
    origin: "release-26.08",
    sourceRef: "reference.md → «антипирены ПБДЭ»",
    note: "Промах: химия без ИИ — не наша тема",
    expected: { onTopic: false, section: "ai-news", direction: null },
    reviewReply: null,
    modelReply: reply(false, "ai-news", null, 0.89, "химия без ИИ"),
  },
  {
    id: "release-ideal-observer",
    title: "Аппроксимация идеального наблюдателя в задачах управления",
    lead: "Авторы показали, как приблизить оптимальный регулятор без полной модели объекта, и привели пример расчёта.",
    source: "arxiv",
    origin: "release-26.08",
    sourceRef: "reference.md → «аппроксимация идеального наблюдателя»",
    note: "Промах: теория управления без ИИ",
    expected: { onTopic: false, section: "ai-news", direction: null },
    reviewReply: null,
    modelReply: reply(false, "ai-news", null, 0.87, "теория управления без ИИ"),
  },
  {
    id: "release-starharness",
    title: "StarHarness: открытая обвязка для агентных пайплайнов",
    lead: "Проект даёт готовые инструменты, трассировку шагов и хранилище контекста для сборки автономных агентов.",
    source: "github-trending",
    origin: "release-26.08",
    sourceRef: "reference.md → «StarHarness (агентные обвязки)»",
    note: "Промах: ИИ-продукт в «ИИ для науки» · правильный раздел ai-news, направления нет",
    expected: { onTopic: true, section: "ai-news", direction: null },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "ai-news", null, 0.9, "агентная обвязка — ИИ-новость"),
  },
  {
    id: "release-kgqa",
    title: "KGQA довели точность ответов по графам знаний до 91%",
    lead: "ИИ-модель учится ходить по графу и отвечать на вопросы без полного перебора; авторы выложили код и датасет.",
    source: "arxiv",
    origin: "release-26.08",
    sourceRef: "reference.md → «KGQA по графам знаний»",
    note: "Промах: ИИ-метод в «ИИ для науки» · ai-news, направления нет",
    expected: { onTopic: true, section: "ai-news", direction: null },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "ai-news", null, 0.88, "вопросно-ответная ИИ-система"),
  },
  {
    id: "release-ai-in-finance",
    title: "ИИ-модель ускорила финансовый анализ: кейс крупного банка",
    lead: "Система читает отчётность и собирает выжимку за минуту; банк заявляет о сокращении ручной работы на треть.",
    source: "vc.ru",
    origin: "release-26.08",
    sourceRef: "reference.md → «ИИ в финансовом анализе»",
    note: "Промах: ИИ в финансах — не наука · ai-news",
    expected: { onTopic: true, section: "ai-news", direction: null },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "ai-news", null, 0.91, "ИИ-применение в финансах"),
  },
  {
    id: "release-agelab-bracelet",
    title: "AgeLab представила браслет, который оценивает биологический возраст с помощью ИИ",
    lead: "Устройство измеряет пульс и температуру кожи, а модель пересчитывает показатели в «возраст организма».",
    source: "techcrunch",
    origin: "release-26.08",
    sourceRef: "reference.md → «браслет AgeLab»",
    note: "Промах: ИИ-продукт в «ИИ для науки» · ai-news, направления нет",
    expected: { onTopic: true, section: "ai-news", direction: null },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "ai-news", null, 0.86, "продукт с ИИ, не научный результат"),
  },
  {
    id: "release-mit-chatbots",
    title: "MIT открыл чат-ботов для студентов: ИИ отвечает на вопросы по курсам",
    lead: "Ассистент обучен на материалах лекций и помогает готовиться к экзаменам; доступ дали всем первокурсникам.",
    source: "mit-news",
    origin: "release-26.08",
    sourceRef: "reference.md → «чат-боты MIT»",
    note: "Промах: образовательный ИИ-продукт в «ИИ для науки» · ai-news",
    expected: { onTopic: true, section: "ai-news", direction: null },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "ai-news", null, 0.9, "чат-бот, а не научный результат"),
  },
  {
    id: "release-edna-spider-web",
    title: "Паутина ловит eDNA: новый метод оценки биоразнообразия",
    lead: "Экологи собирают следы ДНК с паутины и по ним определяют, какие виды живут рядом; ИИ-обработки в методе нет.",
    source: "nplus1",
    origin: "release-26.08",
    sourceRef: "reference.md → «паутина для eDNA»",
    note: "Промах: научный метод без ИИ и без инструмента · не наш материал",
    expected: { onTopic: false, section: "ai-news", direction: null },
    reviewReply: null,
    modelReply: reply(false, "ai-news", null, 0.83, "метод без ИИ, не инструмент"),
  },
  {
    id: "release-robot-carnival",
    title: "Робо-карнавал в Шанхае: 200 роботов прошли парадом",
    lead: "Шоу собрало производителей человекоподобных машин; роботы танцевали и раздавали листовки.",
    source: "the-verge",
    origin: "release-26.08",
    sourceRef: "reference.md → «робо-карнавал в Шанхае»",
    note: "Промах: событие в «Инструментах для изобретений» · не наш материал",
    expected: { onTopic: false, section: "ai-news", direction: null },
    reviewReply: null,
    modelReply: reply(false, "ai-news", null, 0.8, "событие, а не новость ИИ"),
  },
  {
    id: "release-reasoning-column",
    title: "Мнение: ИИ в науке требует рассуждений, а не пересказа",
    lead: "Автор рассуждает, почему модели пока плохо проверяют гипотезы, и что стоит поменять в обучении.",
    source: "nature",
    origin: "release-26.08",
    sourceRef: "reference.md → колонка «ИИ в науке требует рассуждений»",
    note: "Промах: колонка без конкретного события · не наш материал",
    expected: { onTopic: false, section: "ai-news", direction: null },
    reviewReply: null,
    modelReply: reply(false, "ai-news", null, 0.58, "колонка, конкретного события нет"),
  },
  {
    id: "synthetic-carbon-fiber-composites",
    title: "Композиты с углеродным волокном удешевили на 20%",
    lead: "Завод заменил часть операций и пересчитал себестоимость; механические свойства прежние.",
    source: "industry-week",
    origin: "synthetic",
    sourceRef: "synthetic: Промах: производство материалов без ИИ",
    note: "Промах: производство материалов без ИИ",
    expected: { onTopic: false, section: "ai-news", direction: null },
    reviewReply: null,
    modelReply: reply(false, "ai-news", null, 0.88, "материалы без ИИ"),
  },
  {
    id: "synthetic-gpt-context",
    title: "Вышла GPT-5.6: контекст 2 млн токенов и агентный режим",
    lead: "Модель лучше работает с длинными документами и дольше выполняется без вмешательства человека.",
    source: "openai-blog",
    origin: "synthetic",
    sourceRef: "synthetic: ИИ-новости · направления нет",
    note: "ИИ-новости · направления нет",
    expected: { onTopic: true, section: "ai-news", direction: null },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "ai-news", null, 0.95, "новый релиз модели"),
  },
  {
    id: "synthetic-claude-agentic",
    title: "Claude получил режим долгих агентных задач",
    lead: "Ассистент теперь сам разбивает работу на шаги и возвращается с результатом через несколько часов.",
    source: "anthropic-blog",
    origin: "synthetic",
    sourceRef: "synthetic: ИИ-новости · направления нет",
    note: "ИИ-новости · направления нет",
    expected: { onTopic: true, section: "ai-news", direction: null },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "ai-news", null, 0.94, "обновление ИИ-ассистента"),
  },
  {
    id: "synthetic-agent-eval-standard",
    title: "OpenAI и Anthropic договорились о едином стандарте оценки агентов",
    lead: "Компании опубликовали набор сценариев, по которым обещают измерять надёжность агентных систем.",
    source: "the-verge",
    origin: "synthetic",
    sourceRef: "synthetic: ИИ-новости · направления нет",
    note: "ИИ-новости · направления нет",
    expected: { onTopic: true, section: "ai-news", direction: null },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "ai-news", null, 0.9, "индустрия ИИ"),
  },
  {
    id: "synthetic-inference-funding",
    title: "Стартап поднял $300 млн на инфраструктуру инференса",
    lead: "Деньги пойдут на собственные ускорители и сервис дешёвого ИИ-инференса для открытых моделей.",
    source: "techcrunch",
    origin: "synthetic",
    sourceRef: "synthetic: ИИ-новости · направления нет",
    note: "ИИ-новости · направления нет",
    expected: { onTopic: true, section: "ai-news", direction: null },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "ai-news", null, 0.88, "ИИ-инфраструктура"),
  },
  {
    id: "synthetic-eu-ai-labeling",
    title: "ЕС расширил требования к маркировке ИИ-контента",
    lead: "Правила касаются изображений, аудио и видео, созданных генеративными системами, и вступают в силу в следующем году.",
    source: "reuters",
    origin: "synthetic",
    sourceRef: "synthetic: ИИ-новости (регуляция) · направления нет",
    note: "ИИ-новости (регуляция) · направления нет",
    expected: { onTopic: true, section: "ai-news", direction: null },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "ai-news", null, 0.9, "регуляция ИИ"),
  },
  {
    id: "synthetic-audit-call",
    title: "Академики призвали к независимому аудиту ИИ-моделей",
    lead: "В открытом письме исследователи просят допускать внешних экспертов к оценке рисков перед релизом.",
    source: "science",
    origin: "synthetic",
    sourceRef: "synthetic: ИИ-новости (политика) · направления нет",
    note: "ИИ-новости (политика) · направления нет",
    expected: { onTopic: true, section: "ai-news", direction: null },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "ai-news", null, 0.89, "политика ИИ"),
  },

  // ── The exact miss the owner named: electrics / energy grids (R07.1) ──────
  {
    id: "user-miss-energy-grid-dispatch",
    title: "Нейросеть управляет энергосетью города и снижает потери на 12%",
    lead: "Оператор электросетей внедрил модель прогнозирования нагрузки: она перераспределяет мощность между подстанциями и предсказывает аварии.",
    source: "habr",
    origin: "user-miss",
    sourceRef: "2026-11-10-brief.md → «тема \"ии в биологии\", а в подборку попадает новость про электрику»",
    note: "Класс промаха «электрика в биологии»: энергосети с ИИ — не Биология и не Физика; научного направления нет, в выпуск не берём",
    expected: { onTopic: false, section: "ai-news", direction: null },
    reviewReply: reviewDisagree("это энергосети, а не биология: научного направления нет"),
    modelReply: reply(true, "science", "biology", 0.9, "энергосеть — похоже на биологию"),
  },
  {
    id: "synthetic-smart-home-electrics",
    title: "ИИ-контроллер умного дома экономит 20% электричества",
    lead: "Устройство учит привычки жильцов и само выключает технику; продажи начнутся в следующем квартале.",
    source: "the-verge",
    origin: "synthetic",
    sourceRef: "synthetic: вариант класса «электрика/энергосети + ИИ» из брифа 10.11",
    note: "Класс промаха: электрика + ИИ — это бытовой продукт, не научное направление",
    expected: { onTopic: false, section: "ai-news", direction: null },
    reviewReply: reviewDisagree("бытовой продукт, не научное направление"),
    modelReply: reply(true, "science", "physics", 0.85, "электричество — раздел физики"),
  },
  {
    id: "synthetic-digital-twin-power-line",
    title: "Цифровой двойник ЛЭП: ИИ предсказывает обледенение проводов",
    lead: "Энергетики собрали модель линии электропередачи и теперь заранее видят риск гололёда на участках.",
    source: "habr",
    origin: "synthetic",
    sourceRef: "synthetic: вариант класса «электрика/энергосети + ИИ» из брифа 10.11",
    note: "Класс промаха: ЛЭП и электрика не относятся ни к одному из шести направлений",
    expected: { onTopic: false, section: "ai-news", direction: null },
    reviewReply: reviewDisagree("ЛЭП не относится ни к одному направлению"),
    modelReply: reply(true, "science", "engineering", 0.9, "инженерная система ЛЭП"),
  },
  {
    id: "synthetic-grid-failure-prediction",
    title: "Нейросеть для электросетей предсказывает аварии за сутки",
    lead: "Модель учитывает нагрузку, погоду и износ оборудования и выдаёт список участков первоочередного ремонта.",
    source: "reuters",
    origin: "synthetic",
    sourceRef: "synthetic: вариант класса «электрика/энергосети + ИИ» из брифа 10.11",
    note: "Класс промаха: энергооборудование с ИИ, научного направления нет",
    expected: { onTopic: false, section: "ai-news", direction: null },
    reviewReply: reviewDisagree("энергооборудование — не научное направление"),
    modelReply: reply(true, "science", "physics", 0.88, "энергетика — это физика"),
  },

  // ── Genuine AI-for-science, all six directions ─────────────────────────────
  {
    id: "science-chemistry-catalysts",
    title: "Нейросеть предсказала катализаторы для синтеза аммиака",
    lead: "Модель обучена на расчётных данных и нашла составы, которые работают при вдвое меньшем давлении; лучшие проверены в лаборатории.",
    source: "nature",
    origin: "synthetic",
    sourceRef: "synthetic: Наука · Химия: катализ и синтез",
    note: "Наука · Химия: катализ и синтез",
    expected: { onTopic: true, section: "science", direction: "chemistry" },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "science", "chemistry", 0.93, "ИИ предсказывает катализаторы, катализ"),
  },
  {
    id: "science-chemistry-generative-reactions",
    title: "Генеративная модель предложила 40 новых реакций для лекарственных молекул",
    lead: "Химики задали целевые структуры, а модель собрала схемы синтеза; часть путей удалось воспроизвести экспериментально.",
    source: "science",
    origin: "synthetic",
    sourceRef: "synthetic: Наука · Химия: органический синтез",
    note: "Наука · Химия: органический синтез",
    expected: { onTopic: true, section: "science", direction: "chemistry" },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "science", "chemistry", 0.9, "генеративный синтез молекул"),
  },
  {
    id: "science-chemistry-perovskite",
    title: "ИИ ускорил электрохимический синтез перовскитов",
    lead: "Алгоритм подбирал параметры осаждения по спектрам, и лаборатория получила образцы с нужным составом с десятой попытки.",
    source: "nplus1",
    origin: "synthetic",
    sourceRef: "synthetic: Наука · Химия: электрохимия",
    note: "Наука · Химия: электрохимия",
    expected: { onTopic: true, section: "science", direction: "chemistry" },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "science", "chemistry", 0.88, "электрохимический синтез"),
  },
  {
    id: "science-materials-crystals",
    title: "Графовая нейросеть нашла 2 млн новых кристаллов",
    lead: "Модель перебирает составы и предсказывает стабильность решёток; авторы открыли базу и обещают синтезировать часть кандидатов.",
    source: "nature",
    origin: "synthetic",
    sourceRef: "synthetic: Наука · Материаловедение: кристаллы и стабильность",
    note: "Наука · Материаловедение: кристаллы и стабильность",
    expected: { onTopic: true, section: "science", direction: "materials" },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "science", "materials", 0.94, "новые кристаллы, материаловедение"),
  },
  {
    id: "science-materials-composites",
    title: "Нейросеть отобрала композит с рекордной прочностью",
    lead: "Нейросеть предложила армирование и режим спекания, образец выдержал нагрузку выше всех аналогов группы.",
    source: "materials-today",
    origin: "synthetic",
    sourceRef: "synthetic: Наука · Материаловедение: композиты (с ИИ, в отличие от карточки Пермского Политеха)",
    note: "Наука · Материаловедение: композиты (с ИИ, в отличие от карточки Пермского Политеха)",
    expected: { onTopic: true, section: "science", direction: "materials" },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "science", "materials", 0.9, "композит, подобранный моделью"),
  },
  {
    id: "science-materials-polymer",
    title: "Нейросеть предсказала полимер с высокой проводимостью",
    lead: "Сеть обучена на расчётах электронной структуры и предложила состав, который можно печатать; измеренная проводимость совпала с прогнозом ИИ-модели.",
    source: "arxiv",
    origin: "synthetic",
    sourceRef: "synthetic: Наука · Материаловедение: полимеры и проводимость",
    note: "Наука · Материаловедение: полимеры и проводимость",
    expected: { onTopic: true, section: "science", direction: "materials" },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "science", "materials", 0.87, "полимер и проводимость"),
  },
  {
    id: "science-biology-ribosome",
    title: "AlphaFold-подобная модель восстановила структуру белка рибосомы",
    lead: "Модель предсказала укладку крупного комплекса и совпала с картой крио-ЭМ в пределах экспериментальной ошибки.",
    source: "nature",
    origin: "synthetic",
    sourceRef: "synthetic: Наука · Биология: белки и структура",
    note: "Наука · Биология: белки и структура",
    expected: { onTopic: true, section: "science", direction: "biology" },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "science", "biology", 0.95, "структура белка, биология"),
  },
  {
    id: "science-biology-gene-function",
    title: "Языковая модель предсказала функции генов в клетках",
    lead: "Обучение на последовательностях ДНК позволило модели предсказывать активность генов в разных тканях.",
    source: "science",
    origin: "synthetic",
    sourceRef: "synthetic: Наука · Биология: гены и клетки",
    note: "Наука · Биология: гены и клетки",
    expected: { onTopic: true, section: "science", direction: "biology" },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "science", "biology", 0.91, "гены и клетки"),
  },
  {
    id: "science-biology-enzyme",
    title: "ИИ нашёл фермент, который разлагает пластик",
    lead: "Модель отобрала варианты аминазы из базы белковых структур, и лучший из них ускорил реакцию распада PET.",
    source: "naked-science",
    origin: "synthetic",
    sourceRef: "synthetic: Наука · Биология: ферменты",
    note: "Наука · Биология: ферменты",
    expected: { onTopic: true, section: "science", direction: "biology" },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "science", "biology", 0.89, "фермент и белок"),
  },
  {
    id: "science-medicine-mammography",
    title: "ИИ-скрининг нашёл опухоли на маммографии лучше рентгенолога",
    lead: "В многоцентровом исследовании модель повысила чувствительность скрининга и снизила число ложных направлений на биопсию.",
    source: "lancet",
    origin: "synthetic",
    sourceRef: "synthetic: Наука · Медицина: диагностика и пациенты",
    note: "Наука · Медицина: диагностика и пациенты",
    expected: { onTopic: true, section: "science", direction: "medicine" },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "science", "medicine", 0.93, "диагностика рака"),
  },
  {
    id: "science-medicine-stroke-wearables",
    title: "ИИ-модель предсказывает инсульт по данным носимых датчиков",
    lead: "Алгоритм анализирует сердечный ритм, и в клиническом исследовании время до лечения сократилось.",
    source: "nature-medicine",
    origin: "synthetic",
    sourceRef: "synthetic: Наука · Медицина: инсульт и пациенты",
    note: "Наука · Медицина: инсульт и пациенты",
    expected: { onTopic: true, section: "science", direction: "medicine" },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "science", "medicine", 0.9, "инсульт, клиническое исследование"),
  },
  {
    id: "science-medicine-vaccine-candidates",
    title: "Генеративная модель предложила кандидатов в вакцину против гриппа",
    lead: "Модель перебрала антигены и предсказала иммунный ответ; лучшие кандидаты пошли в ходе доклинических испытаний.",
    source: "science",
    origin: "synthetic",
    sourceRef: "synthetic: Наука · Медицина: вакцины",
    note: "Наука · Медицина: вакцины",
    expected: { onTopic: true, section: "science", direction: "medicine" },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "science", "medicine", 0.86, "вакцина и иммунный ответ"),
  },
  {
    id: "science-physics-collider",
    title: "Нейросеть ускорила анализ данных коллайдера",
    lead: "Модель отсеивает фоновые события на лету, и физики получают больше редких событий при той же нагрузке на хранилище.",
    source: "cern-courier",
    origin: "synthetic",
    sourceRef: "synthetic: Наука · Физика: частицы",
    note: "Наука · Физика: частицы",
    expected: { onTopic: true, section: "science", direction: "physics" },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "science", "physics", 0.92, "коллайдер, частицы"),
  },
  {
    id: "science-physics-quantum-ec",
    title: "ML улучшил коррекцию ошибок квантовых вычислений",
    lead: "Декодер на нейросети снизил частоту логических ошибок на сверхпроводящем процессоре.",
    source: "arxiv",
    origin: "synthetic",
    sourceRef: "synthetic: Наука · Физика: квантовые вычисления",
    note: "Наука · Физика: квантовые вычисления",
    expected: { onTopic: true, section: "science", direction: "physics" },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "science", "physics", 0.93, "квантовые вычисления"),
  },
  {
    id: "science-physics-gravitational-waves",
    title: "ИИ отфильтровал сигналы гравитационно-волнового детектора",
    lead: "Модель убрала шум вспомогательных каналов и повысила чувствительность поиска слияний.",
    source: "physical-review-letters",
    origin: "synthetic",
    sourceRef: "synthetic: Наука · Физика: гравитационные волны",
    note: "Наука · Физика: гравитационные волны",
    expected: { onTopic: true, section: "science", direction: "physics" },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "science", "physics", 0.9, "гравитационные волны"),
  },
  {
    id: "science-engineering-manipulator",
    title: "ИИ-обученный манипулятор собирает электронику без оператора",
    lead: "Робот осваивает сборку по демонстрациям и переносит навык на новые платы; время наладки сократилось втрое.",
    source: "ieee-spectrum",
    origin: "synthetic",
    sourceRef: "synthetic: Наука · Инженерия: робототехника и манипуляторы",
    note: "Наука · Инженерия: робототехника и манипуляторы",
    expected: { onTopic: true, section: "science", direction: "engineering" },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "science", "engineering", 0.88, "робот-манипулятор"),
  },
  {
    id: "science-engineering-supercomputer",
    title: "ИИ-планировщик распределяет нагрузку суперкомпьютера",
    lead: "Агент учитывает очереди и тепловой бюджет стоек; простой кластера снизился на 18%.",
    source: "hpc-wire",
    origin: "synthetic",
    sourceRef: "synthetic: Наука · Инженерия: вычислительные системы",
    note: "Наука · Инженерия: вычислительные системы",
    expected: { onTopic: true, section: "science", direction: "engineering" },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "science", "engineering", 0.86, "суперкомпьютер, планировщик"),
  },
  {
    id: "science-engineering-robotic-welding",
    title: "Роботизированная сварка перешла на ИИ-контроль",
    lead: "Система машинного зрения проверяет шов в процессе и сама меняет режим; брак на линии упал на четверть.",
    source: "manufacturing-dive",
    origin: "synthetic",
    sourceRef: "synthetic: Наука · Инженерия: автоматизация инженерных задач",
    note: "Наука · Инженерия: автоматизация инженерных задач",
    expected: { onTopic: false, section: "ai-news", direction: null },
    reviewReply: "Проверка не удалась: ответа нет.",
    modelReply: reply(true, "science", "engineering", 0.84, "робототехника и контроль"),
  },

  // ── Genuine invention tools ────────────────────────────────────────────────
  {
    id: "invention-molgpt",
    title: "Вышла открытая ИИ-библиотека MolGPT для генерации молекул",
    lead: "Пакет ставится одной командой и позволяет обучать модель на своём наборе; авторы выложили веса и примеры.",
    source: "huggingface-blog",
    origin: "synthetic",
    sourceRef: "synthetic: Инструменты · Химия: библиотека для генерации молекул",
    note: "Инструменты · Химия: библиотека для генерации молекул",
    expected: { onTopic: true, section: "invention-tools", direction: "chemistry" },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "invention-tools", "chemistry", 0.9, "инструмент для химии"),
  },
  {
    id: "invention-protein-dataset",
    title: "Hugging Face открыл датасет из 10 млн белковых структур для обучения ИИ",
    lead: "Набор собран из открытых банков и размечен для обучения моделей предсказания укладки.",
    source: "huggingface-blog",
    origin: "synthetic",
    sourceRef: "synthetic: Инструменты · Биология: датасет для обучения",
    note: "Инструменты · Биология: датасет для обучения",
    expected: { onTopic: true, section: "invention-tools", direction: "biology" },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "invention-tools", "biology", 0.92, "датасет, инструмент для биологии"),
  },
  {
    id: "invention-medical-sdk",
    title: "Новый ИИ-SDK для обучения медицинских моделей с 100 бенчмарками",
    lead: "Комплект включает предобученные веса, проверки на утечку данных и сценарии клинической оценки.",
    source: "github-trending",
    origin: "synthetic",
    sourceRef: "synthetic: Инструменты · Медицина: SDK с бенчмарками",
    note: "Инструменты · Медицина: SDK с бенчмарками",
    expected: { onTopic: true, section: "invention-tools", direction: "medicine" },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "invention-tools", "medicine", 0.88, "SDK для медицинских моделей"),
  },
  {
    id: "invention-materials-platform",
    title: "ИИ-платформа подбирает материалы под заданные свойства",
    lead: "Сервис принимает ограничения по прочности и весу и выдаёт список составов с расчётными характеристиками.",
    source: "product-hunt",
    origin: "synthetic",
    sourceRef: "synthetic: Инструменты · Материаловедение: платформа подбора",
    note: "Инструменты · Материаловедение: платформа подбора",
    expected: { onTopic: true, section: "invention-tools", direction: "materials" },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "invention-tools", "materials", 0.87, "инструмент материаловеда"),
  },
  {
    id: "invention-physics-simulator",
    title: "Открытый фреймворк для моделирования физических сцен",
    lead: "Библиотека ускоряет симуляции на GPU и даёт дифференцируемую физику для обучения ИИ-агентов.",
    source: "github-trending",
    origin: "synthetic",
    sourceRef: "synthetic: Инструменты · Физика: фреймворк симуляций",
    note: "Инструменты · Физика: фреймворк симуляций",
    expected: { onTopic: false, section: "ai-news", direction: null },
    reviewReply: reviewDoubt("не уверен, что это физика"),
    modelReply: reply(true, "invention-tools", "physics", 0.85, "фреймворк для физики"),
  },
  {
    id: "invention-agentic-science-framework",
    title: "Агентный фреймворк для научных расчётов вышел из беты",
    lead: "Инструмент сам запускает эксперименты в очереди кластера и собирает отчёт; направление науки задаёт пользователь.",
    source: "github-trending",
    origin: "synthetic",
    sourceRef: "synthetic: Инструменты · направление не задано (общий научный инструмент)",
    note: "Инструменты · направление не задано (общий научный инструмент)",
    expected: { onTopic: true, section: "invention-tools", direction: null },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "invention-tools", null, 0.8, "общий инструмент без направления"),
  },

  // ── Plain AI news that must stay in its container ──────────────────────────
  {
    id: "ai-news-qwen-license",
    title: "Qwen открыли под лицензией MIT",
    lead: "Веса и код выложены на Hugging Face; коммерческое использование разрешено без ограничений.",
    source: "techcrunch",
    origin: "synthetic",
    sourceRef: "synthetic: ИИ-новости · направления нет",
    note: "ИИ-новости · направления нет",
    expected: { onTopic: true, section: "ai-news", direction: null },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "ai-news", null, 0.92, "релиз открытой модели"),
  },
  {
    id: "ai-news-browser-agent",
    title: "Мультимодальный агент научился управлять браузером",
    lead: "Система понимает скриншоты и выполняет многошаговые задачи в интерфейсах без API.",
    source: "the-verge",
    origin: "synthetic",
    sourceRef: "synthetic: ИИ-новости · направления нет",
    note: "ИИ-новости · направления нет",
    expected: { onTopic: true, section: "ai-news", direction: null },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "ai-news", null, 0.9, "агентная ИИ-система"),
  },
  {
    id: "ai-news-jailbreak-api",
    title: "OpenAI открыл API для оценки рисков jailbreak",
    lead: "Сервис прогоняет промпты по набору атак и возвращает отчёт для защиты продуктов.",
    source: "openai-blog",
    origin: "synthetic",
    sourceRef: "synthetic: ИИ-новости · направления нет",
    note: "ИИ-новости · направления нет",
    expected: { onTopic: true, section: "ai-news", direction: null },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "ai-news", null, 0.89, "ИИ-безопасность"),
  },
  {
    id: "ai-news-ai-glasses",
    title: "Стартап показал очки с ИИ-ассистентом",
    lead: "Устройство распознаёт речь и подсказывает ответы в реальном времени; предзаказы откроют весной.",
    source: "wired",
    origin: "synthetic",
    sourceRef: "synthetic: ИИ-новости · направления нет",
    note: "ИИ-новости · направления нет",
    expected: { onTopic: true, section: "ai-news", direction: null },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "ai-news", null, 0.88, "ИИ-продукт"),
  },
  {
    id: "ai-news-student-assistant",
    title: "ИИ-ассистент для студентов получил голосовой режим",
    lead: "Сервис отвечает на вопросы вслух и собирает конспект; в бесплатном тарифе появились лимиты.",
    source: "techcrunch",
    origin: "synthetic",
    sourceRef: "synthetic: ИИ-новости · направления нет",
    note: "ИИ-новости · направления нет",
    expected: { onTopic: true, section: "ai-news", direction: null },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "ai-news", null, 0.87, "ИИ-сервис, не наука"),
  },
  {
    id: "ai-news-meeting-notes",
    title: "Сервис заметок добавил ИИ-суммаризацию встреч",
    lead: "Обновление расшифровывает звонки и выделяет задачи; данные хранятся в ЕС.",
    source: "habr",
    origin: "synthetic",
    sourceRef: "synthetic: ИИ-новости · направления нет",
    note: "ИИ-новости · направления нет",
    expected: { onTopic: true, section: "ai-news", direction: null },
    reviewReply: reviewAgree("подтверждаю вердикт"),
    modelReply: reply(true, "ai-news", null, 0.86, "ИИ-функция продукта"),
  },

  // ── Fail-closed policy cases: the model answer itself is broken ────────────
  {
    id: "policy-broken-json",
    title: "Нейросеть восстановила структуру белкового комплекса по крио-ЭМ",
    lead: "Модель предсказала укладку сотен белков и совпала с экспериментальными картами.",
    source: "nature",
    origin: "synthetic",
    sourceRef: "synthetic: Биология, но ответ модели — не JSON: судья обязан отказать",
    note: "Биология, но ответ модели — не JSON: судья обязан отказать",
    expected: { onTopic: false, section: "ai-news", direction: null },
    reviewReply: null,
    modelReply: "Модель считает, что материал про биологию.",
  },
  {
    id: "policy-truncated-json",
    title: "ИИ предсказал катализатор для восстановления CO2",
    lead: "Лаборатория подтвердила активность состава, подобранного моделью.",
    source: "nature",
    origin: "synthetic",
    sourceRef: "synthetic: Химия, но ответ модели обрезан: fail-closed",
    note: "Химия, но ответ модели обрезан: fail-closed",
    expected: { onTopic: false, section: "ai-news", direction: null },
    reviewReply: null,
    modelReply: '{"onTopic": true, "section": "science", "direction": "chemistry", "confidence": 0.9',
  },
  {
    id: "policy-unknown-section",
    title: "ML-планировщик ускорил эксперименты на синхротроне",
    lead: "Алгоритм выбирает следующую точку съёмки и сокращает время сеанса.",
    source: "arxiv",
    origin: "synthetic",
    sourceRef: "synthetic: Ответ с несуществующим разделом: fail-closed",
    note: "Ответ с несуществующим разделом: fail-closed",
    expected: { onTopic: false, section: "ai-news", direction: null },
    reviewReply: null,
    modelReply: JSON.stringify({
      onTopic: true,
      section: "robot-future",
      direction: null,
      confidence: 0.9,
      reason: "выдуманный раздел",
    }),
  },
  {
    id: "policy-science-without-direction",
    title: "ИИ-модель предсказала свойства новых сплавов",
    lead: "Модель обучена на расчётных данных и отобрала составы для экспериментальной проверки.",
    source: "materials-today",
    origin: "synthetic",
    sourceRef: "synthetic: Материаловедение, но направление не указано: fail-closed",
    note: "Материаловедение, но направление не указано: fail-closed",
    expected: { onTopic: false, section: "ai-news", direction: null },
    reviewReply: null,
    modelReply: reply(true, "science", null, 0.9, "направление не указано"),
  },
  {
    id: "policy-direction-in-ai-news",
    title: "Новая версия ассистента лучше держит контекст диалога",
    lead: "Обновление уменьшает потерю инструкций на длинных сессиях.",
    source: "openai-blog",
    origin: "synthetic",
    sourceRef: "synthetic: ИИ-новость с направлением науки: противоречие, fail-closed",
    note: "ИИ-новость с направлением науки: противоречие, fail-closed",
    expected: { onTopic: false, section: "ai-news", direction: null },
    reviewReply: null,
    modelReply: reply(true, "ai-news", "physics", 0.9, "направление в ai-news"),
  },
  {
    id: "policy-low-confidence-physics",
    title: "Квантовый декодер на нейросети снизил число ошибок",
    lead: "Эксперимент на сверхпроводящем процессоре показал выигрыш по логическим кубитам.",
    source: "arxiv",
    origin: "synthetic",
    sourceRef: "synthetic: Физика, но уверенность модели ниже порога: отказ при сомнении",
    note: "Физика, но уверенность модели ниже порога: отказ при сомнении",
    expected: { onTopic: false, section: "ai-news", direction: null },
    reviewReply: null,
    modelReply: reply(true, "science", "physics", 0.55, "кажется, физика"),
  },
  {
    id: "policy-confidence-string",
    title: "Модель предложила антибиотик нового класса",
    lead: "Соединение прошло первую проверку на бактериях; клинические испытания ещё впереди.",
    source: "science",
    origin: "synthetic",
    sourceRef: "synthetic: Медицина, но confidence строкой: fail-closed",
    note: "Медицина, но confidence строкой: fail-closed",
    expected: { onTopic: false, section: "ai-news", direction: null },
    reviewReply: null,
    modelReply: JSON.stringify({
      onTopic: true,
      section: "science",
      direction: "medicine",
      confidence: "0.95",
      reason: "антибиотик",
    }),
  },
  {
    id: "policy-json-array",
    title: "Робот-химик синтезировал серию новых соединений",
    lead: "Платформа сама планирует синтез и выполняет реакции в изолированном боксе.",
    source: "nature",
    origin: "synthetic",
    sourceRef: "synthetic: Химия, но ответ модели — массив: fail-closed",
    note: "Химия, но ответ модели — массив: fail-closed",
    expected: { onTopic: false, section: "ai-news", direction: null },
    reviewReply: null,
    modelReply: JSON.stringify([
      { onTopic: true, section: "science", direction: "chemistry", confidence: 0.9, reason: "робот-химик" },
    ]),
  },
];
