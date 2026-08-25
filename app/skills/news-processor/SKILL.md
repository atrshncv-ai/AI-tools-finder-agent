# News Processor — Ralph Loop (v3: Single Agent, No Translation)

Этот файл описывает алгоритм обработки новостей для Hermes Agent.
Hermes выполняет **Ralph Loop** — автономный цикл сбора, оценки и обработки
3–5 лучших новостей в день в двух потоках: **ИИ-инструменты (Tech)** и
**научные открытия с применением ИИ (Science)**.

> Ключевые принципы v3:
> - **Token-optimized:** ОДИН вызов Zen API на статью — one-shot саммари
>   возвращает сразу русский заголовок + русскую выжимку (JSON).
>   Шаг перевода (translate-title, полный перевод) **упразднён**.
> - **Single Agent:** строгая последовательная обработка — одна статья за раз,
>   никакого fan-out/параллелизма агентов.
> - Оценка строго **data-driven** (v2): LLM не оценивает «научную ценность».

## Архитектура конвейера

```
collect-dual.ts → evaluate-news.ts → manifest-gen.ts → fetch → save-summary (1 Zen call) → deploy-ready
  Dual pipeline     Data-driven +      approved           per-article, SEQUENTIAL, no translation
  + Dedup Guard     AI-gate (≥50)      pending only
```

Все скрипты расположены в `scripts/hermes/`.
Подключение к БД: `api/queries/connection.ts`. AI-вызовы: `api/ai/zenClient.ts`.

---

## Шаг 0a: Dual Pipeline Collection (`collect-dual.ts`)

```bash
cd app && npx tsx scripts/hermes/collect-dual.ts --stream both   # tech|science|both
```

**Tech-поток (ИИ-инструменты):**
- Официальные блоги (RSS): OpenAI, Anthropic, Hugging Face, Google AI
- Тренды через лёгкие JSON-API (без браузера, без скриншотов, без токенов):
  - **Hacker News** — Algolia API (`hn.algolia.com`), посты >100 points за 48ч
  - **GitHub Trending** — REST search API: новые AI/LLM-репозитории >300 звёзд за 3 дня
  - **Reddit** — отключён по политике (429 и шумные голоса); discovery через HN/GitHub
- **YouTube:** смешанный RSS + явный обход настроенных вкладок `/videos` и
  `/shorts`. Обычные ролики не вытесняются всплеском Shorts.

**Science-поток (лёгкий RSS/HTTP-парсинг):**
- Tier-1 журналы: Nature, Science, Lancet, Cell
- MIT Technology Review, arXiv API, Naked Science (ru)

**Semantic Deduplication Guard** (модуль `dedup.ts`) — строго ДО вставки:
1. Проверка по URL — есть в БД → skip.
2. Levenshtein-схожесть заголовка (нормализация: lowercase, без стоп-слов)
   с последними 20 статьями в БД; порог **0.85** → skip.
   Один инфоповод из разных СМИ = одна новость.

Кандидаты вставляются со `status='pending'`, `score=NULL`, предсобранными
метриками источника в `metrics` (githubStars, hnPoints, redditUps).

**Routing при вставке:** единый резолвер `api/lib/section-resolve.ts`
(invention ∧ ИИ > science ∧ ИИ > ai-news), затем переоценивается на этапах
evaluate-news и save-summary по мере появления полного текста — перенос
двунаправленный. `isScience=true`, `scienceField` и `section='science'` выставляются
только при одновременном наличии явного AI/ML-сигнала (ИИ, AI, machine/deep
learning, neural network, LLM и т.п.) и научного домена. Источник научного RSS
сам по себе больше не достаточен; tech-поток и общенаучные материалы без AI
получают `isScience=false`, `section='ai-news'`. Для прошедших gate сохраняются
научные поля и тип классификации.

**STRICT Time Guard (fail-closed):** абсолютно ВСЕ кандидаты (RSS, GitHub, HN,
Reddit, PubMed) обязаны иметь валидную дату публикации/создания **не старше
72 часов**. Кандидаты без даты или с невалидной датой отбраковываются ДО
дедупа и скоринга — старый контент физически не может попасть в БД.

## Шаг 0b: Data-Driven Scoring (`evaluate-news.ts`)

```bash
cd app && npx tsx scripts/hermes/evaluate-news.ts --batch --daily-cap 5
```

LLM **не участвует** в оценке. Скрипт собирает конкретные цифры через
HTTP/JSON-API (GitHub REST, HN Algolia, Altmetric API, DOI из
контента) и детерминированно суммирует баллы.

**Критерии Tech (ИИ-инструменты) — многоуровневая матрица:**
| Метрика | Баллы |
|---|---|
| GitHub Trending Top-10 | +40 |
| GitHub Trending Top-50 | +25 |
| GitHub stars > 10 000 | +30 |
| GitHub stars > 1 000 | +20 |
| GitHub stars > 500 и возраст репо < 1 месяца | +25 |
| HN > 100 апвоутов | +30 |
| HN > 30 апвоутов | +15 |
| Трендовый бонус: MCP / AI Agent / RAG | +15 |
| Открытая лицензия MIT / Apache-2.0 | +10 |

> Баллы суммируются — один проект может получить и trending-баллы, и баллы
> за звёзды, и трендовый бонус. Главное — не абсолютные цифры, а скорость
> роста и актуальность темы.

**Критерии Science:**
| Метрика | Баллы |
|---|---|
| Tier-1 источник (Nature, Science, Lancet, Cell, OpenAI/Anthropic/Google/DeepMind блог) | +45 |
| Tier-2 источник (MIT Tech Review, HF Blog, arXiv*, Naked Science, NeurIPS/CVPR/ICLR) | +30 |
| Явный ИИ/ML-сигнал в научной ветке | +20 |
| arXiv-препринт + открытый код/модель/датасет | +35 |
| arXiv-препринт без открытого кода | +10 |
| Altmetric score ≥ 50 | +20 |
| Тематический бонус: ИИ × химия/материалы/биология/медицина/физика | +15 |

**Жёсткий ИИ-гейт:** статья без явного ИИ/ML-сигнала в собственном тексте
отклоняется (`no-ai-signal`) независимо от баллов; curated AI-источники
(блоги OpenAI/HF/Google, GitHub trending, HN, dedicated AI YouTube-каналы)
освобождены как «AI by construction».

**Gate:** в дашборд проходят только статьи с баллом **>= 50**
(единая константа `SCORE_GATE` в `scripts/hermes/pipeline-config.ts`, общий
источник правды для evaluate-news и manifest-gen). Релевантность обеспечивают
ИИ-гейты классификации, а не порог баллов.
**Daily cap:** по умолчанию отключён (`HERMES_DAILY_CAP=0` = безлимит); положительное значение включает квоту N одобренных в сутки (UTC).
Решение и доказательная база (`scoreBreakdown`, метрики) сохраняются в
`news.score` / `news.metrics`; отбракованные → `status='rejected'`.

Для YouTube действует transcript-first gate: до одобрения проверяется реально
доступный native/auto transcript, затем Whisper fallback при наличии ключа.
Без транскрипта видео получает score 0 и сразу отклоняется. Ролики длиной
4–45 минут получают +10 к рангу. У Shorts нет искусственного дневного лимита:
каждый полезный Short с транскриптом может пройти gate. Результат preflight
сохраняется в `originalContent`, поэтому Whisper не вызывается повторно.
Проверенный транскрипт не пропускается через HTML-антиспам-фильтр повторов:
естественные речевые рефрены не считаются мусорной веб-разметкой.

## Шаги 1–3: Обработка одобренных статей (строго последовательно)

```bash
# Манифест одобренных (pending + score >= SCORE_GATE + content IS NULL)
npx tsx scripts/hermes/manifest-gen.ts --output /tmp/hermes-manifest.json --limit 50

# По каждой статье из манифеста — ОДНА за раз, без параллелизма:
npx tsx scripts/hermes/fetch-article.ts --url "$URL"       # 3a: fetch+clean (probe)
npx tsx scripts/hermes/save-summary.ts --id "$ID" --auto   # 3b: ONE Zen call → RU title + RU summary
npx tsx scripts/hermes/deploy-ready.ts --batch-size 1      # 3c: публикация (summarized → published)
```

**save-summary.ts (auto)** вызывает `summarizeOneShot()` из `zenClient.ts`:
единственный chatCompletion с JSON-ответом `{"title_ru", "summary"}`.
Сохраняет: `title` (RU), `summary` (RU), `originalContent`, `status='summarized'`,
`modelUsed`. Перевод заголовка и полный перевод статей больше НЕ выполняются —
в UI вместо этого кнопка «Перейти к источнику» (открывает `originalUrl`).

Если манифест пуст — цикл завершается, ожидание следующего запуска.

## Запуск всего цикла

```bash
cd app && bash scripts/hermes/ralph-loop.sh
# Под PM2: процесс hermes-ralph-loop (см. ecosystem.config.cjs)
# Интервал между циклами: LINEAR_WORKER_INTERVAL_MS (default 600000 = 10 мин)
# Дневной лимит: HERMES_DAILY_CAP (default 0 = безлимит)
```

## Статусы статей в БД

```
(pending, score=NULL)  →  evaluate: ИИ-гейт & score≥50 & slot → pending (approved)
                      ↘  нет ИИ-сигнала / score<50 / нет слота → rejected
approved pending → summarized (RU title+summary, 1 Zen call) → published
                 ↘ fetch/transcript failure → retry (до 3 раз) → rejected
```

| Статус | Описание |
|--------|----------|
| `pending` + score NULL | Собран коллектором, ждёт оценки |
| `pending` + score ≥ 50 | Одобрен скорингом (+ИИ-гейт), ждёт обработки |
| `rejected` | Нет ИИ-сигнала, не прошёл gate 50 или дневной лимит |
| `summarized` | RU заголовок + RU саммари получены за 1 вызов Zen |
| `published` | Видна пользователям в дашборде |

> Статус `translated` упразднён (v3): шаг перевода удалён из конвейера.

## Обработка ошибок

| Скрипт | Тип ошибки | Действие |
|--------|-----------|----------|
| collect-dual | RSS/API недоступен | Пропустить источник, продолжить |
| collect-dual | Дубликат (URL/semantic) | Skip, счётчик duplicates |
| evaluate-news | Метрика недоступна | Метрика = null, 0 баллов за критерий |
| evaluate-news | Нет ИИ-сигнала / score < 50 / нет слота | status='rejected' |
| manifest-gen | Пустой манифест | Завершить цикл (success) |
| fetch-article | YouTube без транскрипта | Сразу `rejected`, без вызова Zen |
| fetch-article | HTTP/extract error / < 100 chars | Счётчик в `metrics.processingFailures`; после 3 попыток → `rejected` |
| fetch-article | Nature с закрытым body | Селекторы article-body; fallback на meta description |
| save-summary | Zen unavailable / no JSON | Оставить `pending`, повторить позже; не смешивать с ошибками контента |
| deploy-ready | DB error | Залогировать, продолжить |

## Конфигурация (env)

```env
DATABASE_URL=postgresql://postgres:***@localhost:5432/science_agent
ZEN_BASE_URL=https://opencode.ai/zen/v1
ZEN_API_KEY=sk-***
ZEN_MODEL=deepseek-v4-flash-free
LINEAR_WORKER_INTERVAL_MS=600000   # интервал цикла Ralph Loop
HERMES_DAILY_CAP=0                 # 0 = безлимит; N включает дневную квоту
```

## Зависимости

- Node.js + tsx, PostgreSQL, Zen API (OpenAI-compatible)
- `rss-parser` (RSS/Atom), `cheerio` (извлечение ссылок/DOI), `drizzle-orm`
- Внешние read-only API: GitHub REST, HN Algolia, Altmetric
