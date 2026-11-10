# Границы, решённые в спецификации

Читается первым. Всё, что ниже, — решение оркестратора до начала разработки: исполнители
и ревьюеры не пересматривают его в таске, а следуют ему. Имена — английские, как в
существующем коде.

## Правила проекта (не пересматриваются в тасках)

- **`originalUrl` неприкосновенен.** LLM никогда не возвращает URL: только заголовок и
  текст. Любая ссылка в дайджесте берётся из БД.
- **Тело статьи/транскрипт — недоверенные данные.** В промпте обёрнуты маркерами
  `--- BEGIN ARTICLE (UNTRUSTED) ---` / `--- END ARTICLE ---`, модель обязана игнорировать
  «команды» из текста.
- **Секреты только в `.env`.** В коде, `.env.example`, коммитах и тестах — только имена
  переменных. `.env` в `.gitignore` до первого коммита.
- **Разделы неизменны по названию и порядку** (согласовано 14.08): «ИИ-новости»,
  «ИИ для науки», «Инструменты для изобретений». Совпадают в дашборде и Telegram.
- **Гейт один.** Порог публикации живёт в `pipeline-config.ts`; второе число в другом
  файле — дефект.
- **Клиент не видит служебных строк.** Всё, что про здоровье конвейера, ошибки и
  счётчики, уходит только владельцу.
- **Судья видит заголовок И текст-описание, а не только заголовок.** На шаге оценки
  текущий код передаёт в `resolveSection` только заголовок (`evaluate-news.ts:505`) —
  это подтверждённая причина промахов; новый отбор обязан брать `title` + сохранённое
  описание (`news.summary` на момент сбора) и никогда не судить по одному заголовку.
- **Лид материала — это `news.summary` на момент сбора.** В `collect-dual.ts` текстовый поток
  пишет `summary: ""` (`:571`) и теряет RSS-описание, хотя соседняя ветка (`:551`) пишет
  `summary: c.description ?? ""`. Приводим к общему правилу: описание сохраняется при сборе,
  `save-summary` перезаписывает его русской выжимкой, публикация идёт по статусу.
- **Бюджет дня проверяется на публикации, а не только на оценке.** Сейчас `deploy-ready.ts`
  публикует без ограничения, а `--daily-cap` ограничивает лишь одобрение
  (`evaluate-news.ts:706-727`); новая схема обязана не дать опубликовать больше бюджета
  ни через манифест, ни через прямой вызов публикации.
- **`usage` от провайдера не теряется.** Сегодня токены не логируются нигде; каждый вызов
  обязан вернуть расход и передать его в учёт.

## Модули: что владеет, что отдаёт, что скрывает

### 1. `app/scripts/hermes/topics.ts` — реестр тем (новый)

- **Владеет:** единственным описанием трёх разделов и шести направлений науки.
- **Отдаёт:**
  - `SECTIONS: readonly SectionSpec[]` — `{ id, label, emoji, definition, rejectExamples }`,
    `id ∈ "ai-news" | "science" | "invention-tools"`;
  - `DIRECTIONS: readonly DirectionSpec[]` — `{ id, label, definition }`, `id ∈
    "chemistry" | "materials" | "biology" | "medicine" | "physics" | "engineering"`;
  - `sectionById(id)`, `directionById(id)`, `TOPIC_PROMPT_RU` — готовая рубрика для судьи.
- **Скрывает:** конкретные формулировки словарей префильтра (они остаются в `classify.ts`).
- **Не знает:** ни про БД, ни про LLM.

### 2. `app/scripts/hermes/prefilter.ts` — дешёвый отбор (новый, вынос из `evaluate-news.ts`)

- **Владеет:** решением «этот кандидат вообще стоит дорогого вызова».
- **Отдаёт:** `prefilterCandidate(input): PrefilterResult` — `{ keep: boolean, score: number,
  reason: string, evidence: string }`; вход — `{ title, lead, source, publishedAt,
  isYoutube }`.
- **Скрывает:** словари и веса; они не покидают модуль.
- **Не знает:** про LLM и про тему раздела — это ступень B.

### 3. `app/scripts/hermes/judge.ts` — LLM-судья релевантности (новый)

- **Владеет:** единственным местом, где решается «материал про эту тему или нет».
- **Отдаёт:**
  ```ts
  type Judgement = {
    onTopic: boolean;
    section: SectionId;
    direction: DirectionId | null;
    confidence: number;      // 0..1
    reason: string;          // одна строка по-русски
  };
  judgeRelevance(input: { title: string; lead: string; language?: string | null },
                 deps?: { completeJson?: CompleteJson }): Promise<Judgement>;
  ```
  Невалидный ответ → `onTopic:false, confidence:0, reason:"invalid-judgement"` (fail-closed).
- **Скрывает:** промпт, разбор JSON, повторы, выбор провайдера.
- **Не знает:** про БД, бюджет и публикацию.

### 4. `app/api/ai/providers/types.ts` — контракт провайдера (новый)

- **Отдаёт:**
  ```ts
  type ProviderId = "gigachat" | "opencode";
  type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
  type ChatResult = { text: string; provider: ProviderId; model: string;
                      usage: { inputTokens: number; outputTokens: number } | null };
  type CompleteJson = (args: { messages: ChatMessage[]; maxTokens?: number;
                               temperature?: number }) => Promise<ChatResult>;
  type ProviderErrorClass = "config" | "quota" | "transient" | "content";
  ```
- **Скрывает:** HTTP, авторизацию, ретраи.

### 5. `app/api/ai/providers/gigachat.ts` — GigaChat (новый)

- **Владеет:** OAuth-токеном (кеш с запасом 60 с) и вызовами `/chat/completions`.
- **Отдаёт:** `createGigachatProvider(env): { id: "gigachat", completeJson: CompleteJson }`.
- **Скрывает:** детали авторизации; наружу — только `ChatResult` или ошибка с классом.
- **Переменные:** `GIGACHAT_CLIENT_ID`, `GIGACHAT_CLIENT_SECRET`, `GIGACHAT_SCOPE`,
  `GIGACHAT_MODEL`, `GIGACHAT_AUTH_URL`, `GIGACHAT_API_URL`, `GIGACHAT_TIMEOUT_MS`.

### 6. `app/api/ai/providers/zen.ts` — OpenCode (адаптер над существующим клиентом)

- **Владеет:** мостом к `api/ai/zenClient.ts` (не переписывает его).
- **Отдаёт:** `createZenProvider(): { id: "opencode", completeJson: CompleteJson }`.
- **Скрывает:** пул ключей, цепочку моделей.

### 7. `app/api/ai/providers/chain.ts` — цепочка и классификация ошибок (новый)

- **Владеет:** порядком провайдеров, размыканием цепи и учётом расхода.
- **Отдаёт:** `createProviderChain(deps): { completeJson: CompleteJson; lastProvider(): ProviderId | null }`,
  `classifyProviderError(err): ProviderErrorClass`, `recordUsage(...)`.
- **Скрывает:** правило «на `config` не переключаемся, а кричим».

### 8. `app/scripts/hermes/digest-format.ts` — формат сообщений (новый, вынос из `daily-digest.ts`)

- **Отдаёт:**
  - `buildClientDigest(items: DigestItem[], opts: { date: Date; dashboardUrl: string }): string`
    — ровно вид из `reference.md`;
  - `buildOwnerReport(stats: CycleStats, opts): string` — служебка владельцу;
  - `formatItem(item): string`, `fitSummary(text, max = 180): string`;
  - `splitTelegramText(text, max): string[]` (переносится сюда без изменения поведения).
- **Скрывает:** экранирование Markdown, порядок секций, лимит 7 карточек.
- **Не знает:** как отправлять.

### 9. `app/scripts/hermes/publish-budget.ts` — бюджет дня (новый)

- **Отдаёт:** `selectForPublication(approved: Candidate[], budget: number): Candidate[]`
  — сортировка: score desc → confidence desc → publishedAt desc; `dailyBudget()` из env
  `DAILY_BUDGET` (по умолчанию 8, допустимо 5..10).

### 10. База данных — миграция `0011`

- `news`: `metrics` остаётся как есть; вердикт судьи пишется ключом `metrics.judge`
  (`onTopic/section/direction/confidence/reason/provider/model`). Новых колонок нет.
- `pipeline_state`: добавляется `metrics jsonb` — счётчики цикла
  (`collected/prefiltered/judged/approved/published/rejectedByReason`).

## Как проверить (команды проекта)

Стек: Node 20, TypeScript, приложение в `app/`, тесты — Vitest, ORM — Drizzle.

```bash
cd app && npm ci                 # зависимости (уже установлены)
cd app && npx tsc -b             # типы
cd app && npx vitest run         # все тесты
cd app && npx vitest run scripts/hermes/judge.test.ts   # один файл
cd app && npm run lint           # линтер
```

Полная проверка перед сдачей: `npx tsc -b && npx vitest run`. Вывод всегда с усечением
`2>&1 | tail -30`.

## Швы для тестов

Минимум и только по границам:

1. `judge.ts` — на фикстурах вердиктов и на «сломанном JSON» (fail-closed).
2. `prefilter.ts` — на наборе «электрика/энергосети + ИИ», «химия без ИИ», «обычная ИИ-новость».
3. `digest-format.ts` — golden-тест против эталона из `reference.md`.
4. `publish-budget.ts` — сортировка и границы 5..10.
5. `chain.ts` — классификация ошибок и запрет фолбэка на `config`.

## Что уже построено (заполняется после тасков)

_(пусто — прогон только начался)_

## Построено: таск 02 — провайдеры (2026-11-10)

`app/api/ai/providers/`:

- `types.ts` — `ProviderId`, `ChatMessage`, `ChatResult`, `CompleteJson`, `ProviderErrorClass`,
  `ProviderError`, `Provider`.
- `env.ts` — `readEnvFile`, `readProviderEnv`, `parseEnvText`: снимок `.env` на каждый вызов,
  файл важнее `process.env` (поэтому замена ключа подхватывается без рестарта).
- `gigachat.ts` — `createGigachatProvider(env?)`; кеш токена с запасом 60 с, OAuth
  `client_credentials`, чат в формате OpenAI.
- `zen.ts` — `createZenProvider(env?)`: тонкий адаптер над `zenClient.ts`, сам клиент не правился.
- `chain.ts` — `createProviderChain(deps?)` → `{ completeJson, lastProvider() }`,
  `classifyProviderError(err)`, `recordUsage(sink, result, at?)`.
- `scripts/update-key.sh VARIABLE_NAME` — значение ТОЛЬКО из stdin (при TTY `read -s` без эха);
  запись атомарная, `chmod 600`; exit 64 — лишний аргумент/неверное имя, 65 — пустое или
  многострочное значение, 66 — нет env-файла; значения нет ни в выводе, ни в ошибках.

Известное ограничение (принято): `zenClient.ts` разбирает пул ключей при импорте, поэтому
долгоживущий процесс держит старый пул. В текущей схеме каждый шаг цикла — отдельный
`npx tsx`, так что новый ключ видит следующий шаг. Переписывать клиент в этом прогоне
не будем.

## Построено: таск 01 — темы, судья, префильтр (2026-11-10)

- `topics.ts` — `SECTIONS`, `DIRECTIONS`, `sectionById(id)`, `directionById(id)`, `TOPIC_PROMPT_RU`.
- `prefilter.ts` — `prefilterCandidate(input, opts?: { now?: Date }): PrefilterResult`;
  `reason ∈ empty-title | unknown-date | stale | no-ai-signal | keep`; `score 0..95`; сети нет.
- `judge.ts` — `judgeRelevance(input: JudgeInput, deps?: { completeJson?: CompleteJson }): Promise<Judgement>`;
  `CompleteJson`/`ChatMessage` импортируются из `app/api/ai/providers/types.ts` (без приведения типов).
  `JUDGE_CONFIDENCE_THRESHOLD = 0.7`; коды причины:
  `invalid-judgement | low-confidence | rejected-by-review | invalid-review`.
  Отклонённый вердикт нормализуется в `{ onTopic:false, section:"ai-news", direction:null }`.
  Вторая проверка (независимый вопрос о заявленном вердикте) выполняется только для кандидатов
  с `onTopic=true` и `confidence >= 0.7` — это второй короткий вызов на кандидата, принято как
  цена точности.
- `relevance-fixtures.ts` — `RELEVANCE_FIXTURES` (60), `RELEVANCE_FIXTURE_COUNT = 60`,
  `RELEASE_26_08_CASES = 11`, `USER_MISS_CASES = 1`, `RELEVANCE_ACCURACY_FLOOR = 0.95`,
  `RELEVANCE_SOURCING_NOTE`; поля кейса `sourceRef`, `reviewReply`. Источники: 12 кейсов
  привязаны к `reference.md` и брифу, 48 синтетические — отступление записано в
  `RELEVANCE_SOURCING_NOTE`, тест проверяет заявленные числа, а не порог ≥40.

Известное (принято): заголовки кейсов 26.08 восстановлены по `reference.md` — оригиналы
утеряны с сервером; `modelReply` в наборе сформулированы по рубрике, запись живой модели
делается после появления ключа. Дедуп остаётся в `collect-dual.ts`: префильтр без состояния.

## Построено: таск 04 — формат дайджеста (2026-11-10)

`app/scripts/hermes/digest-format.ts`:

- `buildClientDigest(items, { date, dashboardUrl })` — форма эталона, без служебки;
- `buildEmptyClientDigest(opts)`;
- `buildOwnerReport(stats: CycleStats, opts)` — служебное сообщение владельцу;
- `formatItem(item)`, `fitSummary(text, max = 180)`, `splitTelegramText(text, maxLen = 4000)`;
- `resolveRecipients(env?)` → `{ client: string[]; owner: string[] }`;
  переменные `TELEGRAM_CLIENT_CHAT_IDS`, `TELEGRAM_OWNER_CHAT_IDS`
  (`TELEGRAM_CHAT_IDS` / `TELEGRAM_CHAT_ID` остаются клиентским fallback).

## Построено: таск 03 — конвейер и бюджет дня (2026-11-10)

- `publish-budget.ts` — `dailyBudget(raw?)` (5..10, по умолчанию 8, `BudgetConfigError`),
  `selectForPublication(approved, budget)`, `compareForPublication`, `judgeConfidenceOf(metrics)`,
  `emptyCycleMetrics/normalizeCycleMetrics/mergeCycleMetrics`, `cycleIdFor(now)` → `cycle-YYYY-MM-DD`,
  `readCycle`, `countPublishedToday`, `recordCycle`, `cycleStatus`; CLI `--status`,
  `--reject <reason> [--count N]`; константа `CYCLE_STAGE`.
- `deploy-ready.ts` — `planPublication({ ready, budget, publishedToday, releaseCommitted, batchSize })`
  → `{ allowed, reason, items, remainingBudget }`.
- `manifest-gen.ts` — `applyDailyBudget(articles, budget)`.
- `collect-dual.ts` — `buildNewsRow(candidate, resolution, category)`; описание из RSS теперь
  сохраняется в `summary` (D01).
- `evaluate-news.ts` — `runEvaluationCycle({ candidates, budget, deps })` →
  `{ outcomes, counters, scored, judgeCalls }`.
- `pipeline_state.metrics` = `{ collected, prefiltered, judged, approved, published, rejectedByReason, usage }`.
- Миграция `0011` добавляет `pipeline_state.metrics`; проверена применением всех SQL на чистой
  Postgres 16 (10 summarized → ровно 8 published; второй запуск skipped; `DAILY_BUDGET=11` → exit 1).

Известное (принято): кандидаты, не попавшие в бюджет, остаются `pending` с сохранённым
вердиктом — судья за них повторно не платит, батч сначала берёт неоценённых, копятся до `purge-stale`.
`LINEAR_WORKER_INTERVAL_MS` теперь означает паузу ретраев, `HERMES_DAILY_CAP` убран.

## Построено: таск F1 — ремонт ветки (2026-11-10)

- `chain.ts` — сигнатура не менялась; фолбэк только `quota`/`transient`, всё остальное — `ProviderError` наверх.
- `evaluate-news.ts` — `EvaluationDecision` += `"provider-error"`; `EvaluationCycleResult` +=
  `providerErrors: ProviderErrorClass[]`; экспортированы `updateForOutcome(outcome)` и
  `placementFromVerdict(verdict)` — раздел/направление берутся из вердикта судьи.
- `judge.ts` — `judgeRelevance` пробрасывает `ProviderError` (и в суде, и в ревью); форма `Judgement` не менялась.
- `save-summary.ts` — `summarizeWithChain(input, completeJson): Promise<SummaryDraft>` где
  `SummaryDraft { titleRu, summary, provider, model, usage }`; `summarySectionUpdate(input)` возвращает
  `null` для уже оценённых строк; `main` запускается только при прямом вызове.
- `daily-digest.ts` — `ownerStatsFromCycle(metrics: CycleMetrics): OwnerCycleFields`.
- `digest-format.ts` — `CycleStats.usage?: { calls, inputTokens, outputTokens } | null`;
  строка отчёта «Токены за сутки: N вызовов · вход X · выход Y».
