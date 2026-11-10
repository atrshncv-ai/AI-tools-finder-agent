# Научный агент — заметки по коду (main, HEAD 84876e3)

Пути — от корня репозитория; npm-команды выполняются из `app/`.

## 1. Как запускается

- Установка: `cd app && npm ci` (Node 20 — `.github/workflows/ci.yml`).
- Сборка: `npm run build` = `vite build` (статика → `dist/public`) + `esbuild api/boot.ts --platform=node --bundle --format=esm --outdir=dist --alias:@/*=./src/*` (→ `dist/boot.js`) — `app/package.json:8`.
- Типы: `npx tsc -b` (= `npm run check`); проект-ссылки `tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.server.json` (`app/tsconfig.json`).
- Линт/формат: `npm run lint`, `npm run format`.
- Тесты: `npx vitest run` (= `npm test`), конфиг `app/vitest.config.ts`.
- Dev-сервер: `npm run dev` → vite на порту 3000 (`app/vite.config.ts:13`), Hono через `@hono/vite-dev-server`, entry `api/boot.ts`.
- Прод-веб: `npm start` = `NODE_ENV=production node dist/boot.js`; `PORT` (default 3000), `DATABASE_URL` обязателен (`app/api/lib/env.ts`).
- PM2 из корня: `pm2 start ecosystem.config.cjs && pm2 save`. Процессы: `news-agent-web` (`cwd=APP_ROOT||<repo>/app`, `script=dist/boot.js`, NODE_ENV=production) и `hermes-ralph-loop` (`script=scripts/hermes/ralph-loop.sh`, `interpreter=/bin/bash`, `restart_delay=60000`); логи `/var/log/news-agent/{web,hermes}.{out,err}.log` (`ecosystem.config.cjs`).
- Конвейер: `cd app && bash scripts/hermes/ralph-loop.sh` — скрипт сам переходит в `app/` и грузит `app/.env` через `set -a; . ./.env` (`ralph-loop.sh:12-20`).
- Один шаг: `cd app && npx tsx scripts/hermes/<script>.ts [флаги]` (см. §2).
- Дайджест: `cd app && npx tsx scripts/hermes/daily-digest.ts`; cron `0 6 * * *` описан только в `ARCHITECTURE.md:269`, crontab в репозитории отсутствует.
- БД: `npm run db:generate|db:migrate|db:push` (`app/drizzle.config.ts`, миграции `app/db/migrations` 0000–0010), `npm run db:seed` (`tsx db/seed.ts`).
- Go-модель (read-only): `cd app && npx tsx scripts/hermes/cheapest-go-model.ts`.
- CI: `.github/workflows/ci.yml` — `npm ci`, `npm run check`, `npm run lint`, `npm test` (working-directory `./app`).

## 2. Конвейер по шагам (порядок `app/scripts/hermes/ralph-loop.sh`)

Вечный цикл: collect-dual → evaluate-news → manifest-gen → на каждую статью (fetch-article → save-summary → deploy-ready) → sleep. Переменные: `HERMES_MANIFEST` (default `/tmp/hermes-manifest.json`), `HERMES_MANIFEST_LIMIT` (50), `LINEAR_WORKER_INTERVAL_MS` (3600000 мс, минимум 30 с), `HERMES_DAILY_CAP` (0) — `ralph-loop.sh:22-26,43`.

1. `collect-dual.ts` — флаги `--stream tech|science|both` (default both), `--max-age-hours` (72), `--min-age-hours` (0), `--dry-run` (`:80-91`). Time Guard fail-closed (`isFresh`, `:53`), дедуп `isDuplicate` (`:531`), маршрутизация `resolveSection` (`:545`), `classifyScience` → `categorySlug` (`:549`). INSERT `news`: `title`, `originalTitle`, `summary:""`, `originalUrl`, `source`, `publishedAt`, `language`, `isScience`, `scienceField`, `section`, `sphereTags`, `categoryId`, `categorySlug`, `status:"pending"`, `metrics` (`:566-585`); `score` = NULL. Пишет также `sources`(type=`hermes-feed`) и `source_health` (`feed-health.ts:recordFeedHealth`).
2. `evaluate-news.ts` — флаги `--id N`, `--batch` (по умолчанию без `--id`), `--daily-cap N` (0 = без лимита) (`:157-168`). Читает `news`: WHERE `status='pending' AND score IS NULL` LIMIT 200 (`:669-674`), далее `id`, `title`, `originalUrl`, `source`, `isScience`, `section`, `sphereTags`, `metrics`. Пишет `score`, `metrics`, `originalContent` (YouTube), `section`, `sphereTags`, `isScience`, `scienceField`, `updatedAt`; отклонённым ещё `status="rejected"`. Одобренным статус не меняет (`pending`).
3. `manifest-gen.ts` — флаги `--output/-o` (default `manifest.json`), `--limit/-l` (100), `--science-only`. Читает WHERE `status='pending' AND content IS NULL AND score >= SCORE_GATE` (`:87-91`): `id`, `title`, `originalUrl`, `source`, `language`, `status`, `publishedAt`, `categorySlug`, `isScience`, `scienceField`, `originalContent`, `content`, `summary`. В БД не пишет — только JSON-файл (`:142-143`).
4. `fetch-article.ts` — флаг `--url/-u`. БД не трогает: текст в stdout, <100 символов → exit 1 (`:96-99`). В цикле пропускается, если в манифесте `originalContent` ≥ 100 (`ralph-loop.sh:80-82`).
5. `save-summary.ts` — флаги `--id` (обязателен), `--auto`, `--summary`, `--content`, `--model` (`:93-124`). Читает строку по `id` (`title`, `originalUrl`, `source`, `originalContent`, `metrics`, `section`). Пишет `summary`, `title` (RU из LLM), `originalTitle` (если пуст), `status="summarized"`, `modelUsed`, `originalContent`, `metrics.fetchFallback`, `section`, `sphereTags`, `isScience`, `scienceField`, `updatedAt` (`:242-276`); нет YouTube-транскрипта → `status="rejected"` (`:180-184`); manual-режим пишет ещё `content`.
6. `deploy-ready.ts` — флаг `--batch-size/-b` (50). Читает `id`,`title` WHERE `status='summarized'` LIMIT n (`:36-40`); пишет `status="published"`, `platformPublishedAt=now()`, `updatedAt` (`:50-53`), затем `invention_tools.lastVerifiedAt=now()` для всех карточек (`:66-71`).
7. `record-processing-failure.ts` — флаги `--id`, `--stage fetch|extract|zen`, `--reason`, `--youtube`. Читает `metrics`, пишет `metrics.processingFailures[stage] = {attempts, reason, lastFailedAt}`, `updatedAt`; `status="rejected"` по `nextFailureState` (3 попытки fetch/extract либо definitive YouTube) — `failure-policy.ts`, `:58`. Вызовы из `ralph-loop.sh:91,106,110`.

Вне цикла: `purge-stale.ts` (`--dry-run`, `--include-rejected`), `backfill-sections.ts` (`--apply`), библиотеки `pipeline-health.ts`, `feed-health.ts`, `dedup.ts`, `youtube-transcript.ts`, `youtube-sources.ts`, `youtube-policy.ts`, `article-content.ts`, `content-quality.ts`, `failure-policy.ts`, `cheapest-go-model.ts`.

## 3. Классификация и маршрутизация

`app/api/lib/classify.ts`
- `hasExplicitAiSignal(text: string): boolean` (`:93`) — lowercase + `EXPLICIT_AI_PATTERNS` (`:66-91`), поверх `SCIENCE_AI_PATTERNS` (`:53-58`).
- `explainScienceDomain(text: string): Array<{field: string; keyword: string}>` (`:177`).
- `classifyArticle(title: string, description: string): ClassificationResult` (`:194`): `isScience = (домен найден) && hasExplicitAiSignal`.
- `scienceField` — первый по порядку ключ `SCIENCE_FIELD_KEYWORDS` (`:1-51`), чей словарь сработал. Группы и порядок: `chemistry`, `materials`, `biology`, `medicine`, `physics`, `engineering`.
- `categorySlug` — первый совпавший из `CATEGORY_KEYWORDS` (`:124`): `new-llm`, `ai-agent`, `comparison`, `benchmarks`, `updates`; `classificationType` — из `CLASSIFICATION_TYPE_KEYWORDS` (`:99`): `new_tool`, `update`, `closure`, `achievement`, только при `isScience`. Латинские ключи матчатся по границе слова, кириллические — подстрокой (`matchesKeywords`, `:162`).
- Экспорт: функции выше + типы `ClassificationType` (`:153`), `ClassificationResult` (`:155`). Словари-константы не экспортируются.
- Вызовы: `section-resolve.ts:44`; `api/agent/parseAgent.ts:424,520` (там же `classificationType` → `news.classificationType`, `:437`).

`app/api/lib/section-resolve.ts`
- `Section = "ai-news" | "science" | "invention-tools"` (`:16`); `SectionResolution {isScience, scienceField, section, sphereTags}` (`:18`).
- `resolveSection(input: {title: string; description?: string|null; content?: string|null}): SectionResolution` (`:25`); `content` принимается, но классификаторы его не читают (`:28-29`). Приоритет: invention-tools > science > ai-news (`:47-51`), `sphereTags` только для invention (`:59`).
- Вызовы: `collect-dual.ts:545` (title+description), `evaluate-news.ts:505` (только `title` + `content=pageText`; `description` не передаётся, т.е. на этом шаге работает один заголовок), `save-summary.ts:262`, `backfill-sections.ts:63`, `parseAgent.ts:425`.

`app/api/lib/invention-classify.ts`
- `buildInventionContext(title: string, description?: string|null, summary?: string|null): string` (`:99`); `explainInventionMatch(text: string): string[]` (`:115`).
- `classifyInvention(text: string)` (`:130`) → `{isInvention, section, sphereTags, spheres}`; `isInvention = INVENTION_TERMS.test(text) && hasExplicitAiSignal(text)` (`:132`).
- `SPHERES` (`:78-91`): `chemistry`, `materials`, `biology`, `medicine`, `physics`, `climate`, `astronomy`, `mathematics`, `engineering`, `quantum`, `genomics`, `energy`; RU-подписи в `sphereNames` (`:133-146`).
- Вызовы: `section-resolve.ts:45`; `collect-dual.ts:470` (фильтр arXiv-лент с `inventionOnly`).

## 4. Гейт оценки (`app/scripts/hermes/evaluate-news.ts`)

- Порог: `export const SCORE_GATE = 50` — `app/scripts/hermes/pipeline-config.ts:13`; импорт в `evaluate-news.ts:45`, `manifest-gen.ts:19`.
- Решение «прошёл/не прошёл» — `main()`, `:734-772`: `passesGate = r.score >= SCORE_GATE` (`:735`), `approvedDecision = passesGate && slots > 0` (`:736`), `metrics.decision` = `approved` | `rejected-daily-cap` | `rejected-low-score` (`:741-745`).
- `score` в `evaluate()` (`:290-657`), без LLM: жёсткий AI-гейт `hasExplicitAiSignal(relevanceEvidence(...))` (`:491`; провал → `score=0`, `:493-500`); evidence = title + первые `RELEVANCE_LEAD_CHARS = 1500` символов (`:107`, `relevanceEvidence` `:123`).
  - YouTube (`:315-403`): preflight транскрипта; нет транскрипта или AI-сигнала → `score=0` (status не меняется); иначе +45 любому YouTube-источнику (`:356-360`), +15 за AI-сигнал (`:361-367`), +10 за транскрипт, +10 за 4–45 мин (`:373-379`). `scoreYoutubeCandidate` даёт `eligible = score > 65` (`youtube-policy.ts`), но в решении это поле не участвует.
  - science-ветка (вход при `article.isScience || isScienceSource(source)`, `:524-586`): tier1 +45 / tier2 +30, `science-ai-relevance` +20 (только если section science/invention-tools либо `isScience`), arXiv +35 с open artifact / +10 без, altmetric ≥ 50 +20, AI∩домен +15.
  - tech-ветка (`:587-644`): trending rank top-10 +40 / top-50 +25; stars >10k +30 / >1k +20 / >500 и моложе 30 дней +25; HN >100 +30 / >30 +15; MCP/Agent/RAG +15; MIT/Apache-2.0 +10.
  - re-routing секции: invention-tools +25 (`:505-522`).
- `metrics` (jsonb) перезаписывается целиком (`:737-746`): `scoreBreakdown: [{criterion, points, evidence}]`, `evaluatedAt`, `decision`; плюс `githubStars`, `githubLicense`, `githubRepo`, `githubCreatedAt`, `githubDescription`, `githubTopics`, `hnPoints`, `redditUps` (всегда `null`), `altmetricScore`, `hasOpenArtifact`, `dois`, `aiSignal`, `githubTrendingRank`, `youtube*` (channel, description, durationSeconds, transcriptKind, transcriptLanguage, transcriptChars, preflight), при исключении — `evalError`.
- Daily cap (`:706-727`): `dailyCap <= 0` → `slots = Infinity`; иначе считаются одобренные сегодня (`score >= SCORE_GATE`, `status in (pending, summarized, translated, published)`, `createdAt >= начало UTC-суток`), `slots = max(0, dailyCap - count)`; каждый approved уменьшает `slots` (`:749`). Ограничивает одобрение, а не публикацию.
- Запись в БД: approved → `score`, `metrics`, `originalContent?`, `section`, `sphereTags`, `isScience`, `scienceField`, `updatedAt` (`:751-764`); rejected → `score`, `metrics`, `status="rejected"`, `updatedAt` (`:767-770`). Итог — JSON в stdout (`:774-782`).

## 5. Дайджест (`app/scripts/hermes/daily-digest.ts`)

- Экспорт: `splitTelegramText(text: string, maxLen = TELEGRAM_MAX_LEN): string[]` (`:76`), `isPaymentReminderDay(now: Date, dueAt = PAYMENT_DUE_AT): boolean` (`:90`), `paymentReminderText(dueAt = PAYMENT_DUE_AT): string` (`:97`), `buildDigest(items: DigestItem[], healthLine?: string): string` (`:101`), `buildEmptyDigest(): string` (`:135`), `sendTelegram(text: string, chatId: string): Promise<boolean>` (`:170`). Не экспортируются: `esc` (`:47`), `formatSection` (`:62`), `main` (`:220`).
- Константы: `WINDOW_HOURS=24`, `MAX_ITEMS_PER_SECTION=7`, `TELEGRAM_MAX_LEN=4000`, `SEND_MAX_ATTEMPTS=3`, `SEND_BACKOFF_MS=[2000,4000]`, `SEND_PACE_MS=500` (`:28-30,152-159`).
- Выборка: `news` WHERE `status='published'` AND `coalesce(platformPublishedAt, updatedAt) >= since` AND summary непустой, ORDER BY тот же coalesce DESC (`:225-238`); поля `id`, `title`, `originalUrl`, `source`, `isScience`, `section`, `sphereTags`, `summary`.
- Разделы (`:102-104`): `science` (или пустой `section` при `isScience`) → 🔬 «ИИ для науки»; `invention-tools` → 🧪 «Инструменты для изобретений»; `ai-news` → 🛠 «ИИ-новости». Порядок в тексте: 🛠, 🔬, 🧪 (`:122-124`).
- Лимиты: 7 карточек на раздел, остаток — строкой «Ещё N материалов — в дашборде» (`:65-71`); описание — summary со сжатыми пробелами и обрезкой до 180 символов (`:66`); сплит по 4000 символов по границе строки (`splitTelegramText`).
- Получатели: `CHAT_IDS` = `TELEGRAM_CHAT_IDS` (через запятую) либо legacy `TELEGRAM_CHAT_ID`, кавычки снимаются (`:39-42`). Fan-out по чатам × частям, пауза 500 мс, статус в stdout `sent|partial|failed`, exit 1 если не доставлено никому (`:258-275`). Без токена/чатов — stub-режим с печатью (`:254-256`).
- Env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_IDS`, `TELEGRAM_CHAT_ID`, `PAYMENT_MANAGER_CHAT_ID`, `PAYMENT_DUE_AT`, `DIGEST_DASHBOARD_URL`.
- Строка здоровья: `formatHealthLine(await collectPipelineStats(since))` в try/catch (`:243-248`), вставляется сразу после «За последние 24 часа опубликовано: N» (`:119`).
- Оплата: `sendTelegram(paymentReminderText(), PAYMENT_MANAGER_CHAT_ID)` при `isPaymentReminderDay` (`:278-281`).

## 6. LLM-клиент (`app/api/ai/zenClient.ts`)

- Публичные функции: `countTokens(text: string): number` (`:231`), `truncateToTokens(text: string, maxTokens: number): string` (`:239`), `resolveGoSessionId(sessionId?: string): string` (`:56`), `isGoConfigured(): boolean` (`:120`), `getEffectiveBaseUrl(): string` (`:125`), `getGoBaseUrl(): string` (`:130`), `getGoModel(): string` (`:135`), `getKeyPoolState(): {poolSize: number; activeIndex: number; coolingKeys: number}` (`:203`), `getCircuitState(): {state: "closed"|"open"|"half-open"; failureCount: number; successCount: number}` (`:301`), `chatCompletion(messages: {role: string; content: string}[], options?: {temperature?, max_tokens?, model?, retries?, timeoutMs?, retryDelayMs?, extractParagraph?, sessionId?}): Promise<string>` (`:564`), `summarizeOneShot(title: string, content: string, source: string, sessionId?: string): Promise<{titleRu: string; summary: string}>` (`:635`), `summarizeArticle(...)` (deprecated, `:713`), `translateTitle(title: string): Promise<string>` (`:762`), `translateArticle(title: string, content: string, source?: string): Promise<string>` (`:781`), `getZenConnectionStatus(): Promise<ZenConnectionStatus>` (`:817`), `checkZenConnection(): Promise<boolean>` (`:856`), `resetCircuitBreaker(): void` (`:863`).
- Экспорт-константы/классы: `ZEN_GO_BASE_URL_DEFAULT`, `ZEN_GO_MODEL_DEFAULT = "mimo-v2.5"`, `AGENT_UA`, `ZenQuotaError(status: number, body: string)` (`:343`), `ZenPoolExhaustedError(message: string)` (`:545`), интерфейс `ZenConnectionStatus {ok: boolean; error?: string}` (`:808`).
- Env: `ZEN_BASE_URL`, `ZEN_MODEL`, `ZEN_FALLBACK_MODELS`, `ZEN_API_KEYS`, `ZEN_API_KEY`, `ZEN_GO_API_KEYS`, `ZEN_GO_API_KEY`, `ZEN_GO_BASE_URL`, `ZEN_GO_MODEL`, `ZEN_GO_SESSION_ID`, `ZEN_KEY_COOLDOWN_MS`, `ZEN_TIMEOUT_MS`, `ZEN_MAX_INPUT_TOKENS`, `ZEN_SUMMARY_MAX_TOKENS`, `ZEN_DETAILED_MAX_TOKENS`, `ZEN_TRANSLATION_MAX_TOKENS`, `ZEN_RETRIES`, `ZEN_RETRY_DELAY_MS`, `ZEN_CONCURRENCY`, `ZEN_CIRCUIT_BREAKER_THRESHOLD`, `ZEN_CIRCUIT_BREAKER_RESET_MS`, `AGENT_UA`.
- Ротация ключей: два пула `legacyPool`/`goPool` (`:99-109`), `activePool()` = `goPool`, если есть Go-ключ, иначе legacy (`:115-117`). `exhaustKeyAndRotate` ставит cooldown `KEY_COOLDOWN_MS` (1 ч) и уводит на следующий не-cooldown ключ (`:159-197`); состояние пула best-effort пишется в `agent_state` (`agentId='zen-key-pool'`) через `persistPoolState` (`:176-182`) → `pipeline-health.ts:persistZenPoolState`.
- Цепочка моделей: `MODEL_CHAIN = [ZEN_MODEL || "zen-default", ...ZEN_FALLBACK_MODELS]` (`:13-19`); при Go — `[ZEN_GO_MODEL]` (`:140-142`). Переход к следующей модели только по `ZenPoolExhaustedError`, cooldown-ы предварительно сбрасываются (`:595-625`).
- Классификация ошибок: `isQuotaError` (`:366`) — 402/403/429 = quota, 401 только при теле `/credit|balance|quota|limit|payment|billing|insufficient/i`; `isGoSubscriptionRequiredError` (`:356`) — 403 + «active OpenCode Go subscription is required», не quota. Ретраи: `MAX_RETRIES=3`, экспоненциальный backoff `INITIAL_RETRY_DELAY_MS * 2^attempt` (`:497-534`); circuit breaker: threshold 5 / reset 60 с (`:277-292`), открытый breaker кидает исключение до запроса (`:585-590`).
- Токены: `usage {prompt_tokens, completion_tokens, total_tokens}` объявлен в типе `CompletionResponse` (`:382-386`), но нигде не читается, не логируется и не пишется в БД. Логи — только `console.log/error` (ротация, смена модели, ошибки). Единственный след модели — `news.modelUsed` из `save-summary.ts:222-224,253`.

## 7. Схема БД (`app/db/schema.ts`)

- Таблицы: `users`, `categories`, `news`, `invention_tools`, `favorites`, `read_status`, `sources`, `parsing_logs`, `agent_state`, `source_health`, `pipeline_state`.
- `news` — поля (`:50-81`): `id`, `title`, `summary`, `content`, `originalContent`, `translation`, `originalUrl`, `originalTitle`, `source`, `categoryId`, `categorySlug`, `tags`, `imageUrl`, `publishedAt`, `isScience`, `scienceField`, `classificationType`, `section` (default `ai-news`), `sphereTags` (default `[]`), `digestArchiveSentAt`, `platformPublishedAt`, `language`, `score`, `metrics`, `status` (default `pending`), `modelUsed`, `createdAt`, `updatedAt`. Индексы + `uniqueIndex("idx_news_original_url")` + `check originalUrl ~ '^https?://'` (`:83-101`).
- Статусы `news`: `pending` — `collect-dual.ts:582` (и остаётся у одобренных); `summarized` — `save-summary.ts:244`; `published` — `deploy-ready.ts:52`; `rejected` — `evaluate-news.ts:769`, `save-summary.ts:182`, `record-processing-failure.ts:58`, `check-urls.ts:154`; `pending` также `api/agent/parseAgent.ts:441` (API-парсер); `translated` — только legacy-агенты `api/agent/translateAgent.ts:65,88` и `deployAgent.ts:34`, в Hermes-конвейере не ставится.
- Нигде не пишется: `digestArchiveSentAt` (только в схеме). `classificationType` пишет только `parseAgent.ts:437`. `translation` — `translateAgent.ts:65`.
- `pipeline_state` (`:268-285`): `id`, `cycleId` (unique), `stage` (default `idle`), `totalArticles`, `processedArticles`, `startedAt`, `completedAt`, `errorMessage`, `createdAt`. Пишет только `api/agent/pipeline.ts`; Hermes-скрипты — нет.
- `agent_state` (`:222-233`): `id`, `agentId` (unique), `status`, `lastRun`, `lastError`, `runCount`, `successCount`, `failCount`, `createdAt`, `updatedAt`. Hermes пишет одну строку `agentId='zen-key-pool'`, `status` = JSON `{poolSize, activeIndex, coolingKeys, updatedAt}` (`pipeline-health.ts:140-155`).
- `source_health` (`:239-262`): `id`, `sourceId` (unique, FK `sources`), `sourceName`, `status` (default `unknown`; ставится `ok|degraded|failing`), `lastCheck`, `lastSuccess`, `lastError`, `consecutiveFails`, `successRate`, `avgResponseTime`, `selectorWorks`, `runCount`, `successCount`, `createdAt`, `updatedAt`; пишет `feed-health.ts:recordFeedHealth` (порог failing = 3).

## 8. Тесты

Запуск: `cd app && npx vitest run`; конфиг `app/vitest.config.ts` (root = `app`, `setupFiles ./test/setup.ts`, include `api/**`, `scripts/**`, `src/**`, jsdom для `src/**`). 26 файлов, 191 тест-кейс (`it(`).

- `api/agent/parseAgent.test.ts` — keyword-гейт парсера и состояние агента.
- `api/ai/goModels.test.ts` — выбор дешёвой Go-модели, роутинг на Go endpoint, заголовок `x-opencode-session`.
- `api/ai/model-config.test.ts` — проверка, что в `app/.env.example` стоит `ZEN_MODEL=deepseek-v4-flash-free`.
- `api/ai/zenClient.test.ts` — `countTokens`/`truncateToTokens`, circuit breaker, ротация ключей, классы ошибок.
- `api/boot.test.ts` — `/health`: ok / degraded при недоступном Zen / 503 при падении БД.
- `api/hermes/article-content.test.ts` — извлечение текста статьи (cheerio).
- `api/hermes/content-quality.test.ts` — детект мусорного извлечённого текста.
- `api/hermes/failure-policy.test.ts` — `nextFailureState`: 3 попытки → reject, definitive YouTube-фейл.
- `api/hermes/youtube-policy.test.ts` — `scoreYoutubeCandidate`: бонус 4–45 мин, отсутствие квоты на Shorts.
- `api/hermes/youtube-sources.test.ts` — состав/уникальность курируемых каналов.
- `api/lib/classify.test.ts` — `classifyArticle` (science-поля) и `hasExplicitAiSignal`.
- `api/lib/invention-classify.test.ts` — `classifyInvention` требует AI-сигнал, выдаёт sphereTags.
- `api/lib/password.test.ts` — bcrypt hash/verify.
- `api/lib/rateLimit.test.ts` — лимит запросов и 429.
- `api/lib/section-resolve.test.ts` — приоритет invention-tools > science > ai-news.
- `api/lib/url-safety.test.ts` — SSRF-гард (private/loopback/metadata/десятичные IPv4).
- `api/queries/newsDateRules.test.ts` — окна свежести `FRESHNESS_HOURS`/`getFreshnessWindow`.
- `api/security-sensitive-data.test.ts` — в git не трекаются `.env`/ключи/логи/БД и нет боевых креденшелов.
- `scripts/hermes/daily-digest.test.ts` — сплит, пустой выпуск, строка здоровья, 3 фиксированные секции, напоминание об оплате, ретраи `sendTelegram`.
- `scripts/hermes/dedup.test.ts` — `similarity`, `matchTitle`, versioned-сущности.
- `scripts/hermes/evaluate-news.test.ts` — lead-only evidence (1500 симв.), `hasAiAndDomain`, порог 50.
- `scripts/inventionToolQuality.test.ts` — валидация seed-каталога инструментов.
- `src/lib/detailNavigation.test.ts` — возврат на список с query-параметрами.
- `src/lib/inventionTools.test.ts` — представление каталога (слияние/сортировка карточек).
- `src/lib/readStatus.test.ts` — `shouldMarkRead`.
- `src/lib/sectionFilters.test.ts` — `getSectionQuery` по section.

## 9. Расхождения документации с кодом

`docs/DEPLOY.md`
- Docker/Compose как единственный путь. В коде два пути: `docker-compose.yml` (postgres/app/nginx/certbot) и `Dockerfile` (`CMD npx drizzle-kit migrate && npm start`) — образ поднимает только веб; `hermes-ralph-loop` есть только в `ecosystem.config.cjs:19-31`, в Docker его нет. Ни PM2, ни конвейер в DEPLOY.md не упомянуты.
- `LM_STUDIO_*` и «RAM минимум 8 ГБ (для LM Studio / Gemma 4)» — обращений к `LM_STUDIO_*` в `app/api` и `app/scripts/hermes` нет; остались только legacy-скрипты `app/test-*.ts` и `app/scripts/test-cycle.ts`.
- `LOCAL_TRANSLATE_*` / Transformers.js ONNX — в коде отсутствуют полностью.
- Kimi OAuth (`APP_ID`, `KIMI_AUTH_URL`, `KIMI_OPEN_URL`) — OAuth в коде нет: вход email+пароль, JWT HS256, секрет `JWT_SECRET || APP_SECRET` (`app/api/lib/session.ts:22`); `APP_ID`/`KIMI_*` не читаются нигде.
- Верно: `/health` (`app/api/boot.ts`), `/admin` (`app/src/App.tsx:41`), `scripts/backup.sh`, `scripts/setup-ssl.sh`.

`ARCHITECTURE.md`
- «curated AI-источники освобождены» от жёсткого ИИ-гейта (`:137`) — в коде исключений нет (`evaluate-news.ts:78-83,333-334,488-490`).
- «манифест: pending + score≥66» (`:197`) — фактически `SCORE_GATE = 50`.
- «интервал по умолчанию 10 мин» (`:65`) — `ralph-loop.sh:24` даёт 3600000 мс (1 ч); 600000 есть только в `app/.env.example`.
- «модель `deepseek-v4-flash-free`» (`:30`) — дефолт в коде `zen-default` (`zenClient.ts:7`), Go-модель `mimo-v2.5` (`:32`); deepseek только в `app/.env.example`.
- «пул из 3 ключей» — число ключей задаётся env, в коде числа нет.
- «82 теста» (`:34`) — фактически 191 `it(` в 26 файлах.
- «миграции актуально 0007» (`:29` и `:253`) — в `app/db/migrations` 0000–0010.
- «Reddit: AI-сабреддиты (с обработкой 429)» (`:78`) — `collectReddit` отключён по политике (`collect-dual.ts:349-350`), Reddit-скоринг тоже (`evaluate-news.ts:452-454`).
- «9 курируемых каналов (`YOUTUBE_CHANNELS`)» (`:83`) — 13 каналов, константы `YOUTUBE_SOURCES` и `DEDICATED_AI_YOUTUBE_SOURCES` (`youtube-sources.ts`).
- «+45 | канал ∈ `DEDICATED_AI_CHANNELS`» (`:132`) — такого имени нет; +45 начисляется любому YouTube-источнику (`evaluate-news.ts:356-360`), флаг `dedicatedAi` в решении не используется.
- Стек: «Tailwind CSS 4» (`:27`) — `tailwindcss ^3.4.19`; «wouter» — фактически `react-router ^7.6.1` (`app/package.json`).
- Cron дайджеста `0 6 * * *` и лог `/var/log/news-agent/digest.log` (`:209`, `:269`) — crontab в репозитории отсутствует.
- В коде есть, но в доках не отражено: флаги `--max-age-hours`/`--min-age-hours`, `--science-only`, `--include-rejected`, `backfill-sections.ts --apply`, `purge-stale.ts`, `record-processing-failure.ts`, `metrics.processingFailures`, `agent_state` (zen-key-pool), ретраи/паузы Telegram, поле `digestArchiveSentAt` (без записи), статус `translated` (legacy-агенты).

## 10. Точки, которые придётся трогать

(а) LLM-судья релевантности с вердиктом по теме
- `app/scripts/hermes/evaluate-news.ts:123` — рядом с `relevanceEvidence()` добавить сбор evidence и вызов судьи; вызов вместо/после `hasExplicitAiSignal(relevanceText)` в `:491` (не-YouTube) и `:335` (YouTube); вердикт класть в `metrics` в блоке `:737-746`; статус ставится в `:748-771`.
- `app/api/lib/classify.ts:93` — `hasExplicitAiSignal` (текущий regex-«судья»), словарь `EXPLICIT_AI_PATTERNS:66`.
- `app/api/ai/zenClient.ts:564` — `chatCompletion` (единственная точка вызова LLM); новый хелпер-судья — рядом с `summarizeOneShot` (`:635`).
- `app/scripts/hermes/pipeline-config.ts:13` — сюда порог вердикта рядом с `SCORE_GATE`.
- `app/scripts/hermes/manifest-gen.ts:87-91` — если судья должен отсекать до очереди LLM.

(б) Дневной бюджет публикаций
- `app/scripts/hermes/evaluate-news.ts:157-168` (`--daily-cap`), `:706-727` (расчёт `slots`), `:736` (`approvedDecision`), `:748-749` (`slots--`) — сейчас бюджет ограничивает только одобрение.
- `app/scripts/hermes/deploy-ready.ts:36-54` — публикация не ограничена: выбираются все `summarized`; здесь нужен счётчик по `platformPublishedAt` за сутки.
- `app/scripts/hermes/pipeline-config.ts` — константа бюджета рядом с `SCORE_GATE`.
- `app/scripts/hermes/ralph-loop.sh:43` — `HERMES_DAILY_CAP`.
- `app/scripts/hermes/pipeline-health.ts:42-50` — счётчик опубликованного за 24 ч для отчётности/дайджеста.

(в) Второй LLM-провайдер (GigaChat) рядом с текущим
- GigaChat-кода нет вообще: grep по `app/**/*.ts` пуст, `GIGACHAT_*` живут только в корневом `.env.example`. Провайдер придётся добавлять с нуля.
- `app/api/ai/zenClient.ts:6-42` — конфиг читается на загрузке модуля; `activePool():115`, `isGoConfigured():120`, `getEffectiveBaseUrl():125`, `getEffectiveModelChain():140` — сюда выбор провайдера; `rawChatCompletion():391` (заголовки `:420-432`, `fetch` `:434-446`) — здесь отдельный request builder, т.к. у GigaChat иная авторизация, не `Bearer`.
- `app/api/ai/zenClient.ts:564` — `chatCompletion`: circuit breaker и цепочка моделей; `ZenQuotaError:343` / `ZenPoolExhaustedError:545` — классификация ошибок провайдера.
- `app/scripts/hermes/save-summary.ts:212` (вызов `summarizeOneShot`) и `:222-224` (`modelUsed`).
- `app/api/boot.ts` — `probeZenCached`/`checkZenConnection` в `/health`; health должен знать про второго провайдера.

(г) Разделение дайджеста на клиентский и служебный
- `app/scripts/hermes/daily-digest.ts:39-42` — `CHAT_IDS` сейчас один список на всех; `buildDigest:101` — общий текст; `formatSection:62`; вставка healthLine `:119`; fan-out `main` `:258-276`; `PAYMENT_MANAGER_CHAT_ID:43,278`.
- `app/scripts/hermes/pipeline-health.ts:119` — `formatHealthLine`, служебная часть (сейчас уходит всем получателям).
- Env-контракт: `TELEGRAM_CHAT_IDS` / `TELEGRAM_CHAT_ID` / `PAYMENT_MANAGER_CHAT_ID` (`app/.env.example`) — клиентского списка пока не существует.
