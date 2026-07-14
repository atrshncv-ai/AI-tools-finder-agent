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
  Dual pipeline     Data-driven        approved           per-article, SEQUENTIAL, no translation
  + Dedup Guard     scoring (>65)      pending only
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
  - **Reddit** — публичный JSON r/MachineLearning, r/artificial, r/LocalLLaMA (>100 ups)

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

**Routing при вставке:** `isScience` и `scienceField` проставляются сразу:
lancet→medicine, cell→biology, nature/science/naked-science→multidisciplinary,
arxiv→computer-science, mit-tech-review→technology, tech-поток→`isScience=false`.

**STRICT Time Guard (fail-closed):** абсолютно ВСЕ кандидаты (RSS, GitHub, HN,
Reddit, PubMed) обязаны иметь валидную дату публикации/создания **не старше
72 часов**. Кандидаты без даты или с невалидной датой отбраковываются ДО
дедупа и скоринга — старый контент физически не может попасть в БД.

## Шаг 0b: Data-Driven Scoring (`evaluate-news.ts`)

```bash
cd app && npx tsx scripts/hermes/evaluate-news.ts --batch --daily-cap 5
```

LLM **не участвует** в оценке. Скрипт собирает конкретные цифры через
HTTP/JSON-API (GitHub REST, HN Algolia, Reddit JSON, Altmetric API, DOI из
контента) и детерминированно суммирует баллы.

**Критерии Tech (ИИ-инструменты) — многоуровневая матрица:**
| Метрика | Баллы |
|---|---|
| GitHub Trending Top-10 | +40 |
| GitHub Trending Top-50 | +25 |
| GitHub stars > 10 000 | +30 |
| GitHub stars > 1 000 | +20 |
| GitHub stars > 500 и возраст репо < 1 месяца | +25 |
| HN / Reddit > 100 апвоутов | +30 |
| HN / Reddit > 30 апвоутов | +15 |
| Трендовый бонус: MCP / AI Agent / RAG | +15 |
| Открытая лицензия MIT / Apache-2.0 | +10 |

> Баллы суммируются — один проект может получить и trending-баллы, и баллы
> за звёзды, и трендовый бонус. Главное — не абсолютные цифры, а скорость
> роста и актуальность темы.

**Критерии Science:**
| Метрика | Баллы |
|---|---|
| Tier-1 источник (Nature, Science, Lancet, Cell, OpenAI/Anthropic/Google/DeepMind блог) | +45 |
| Tier-2 источник (NeurIPS/CVPR/ICLR, HuggingFace Blog, MIT Technology Review) | +30 |
| arXiv-препринт + открытый код/модель/датасет | +35 |
| arXiv-препринт без открытого кода | +10 |
| Altmetric score ≥ 50 | +20 |
| Тематический бонус: ИИ × химия/материалы/биология/медицина/физика | +15 |

**Gate:** в дашборд проходят только статьи с баллом **> 65**.
**Daily cap:** не более 5 одобренных статей в сутки (UTC) — элитная курация.
Решение и доказательная база (`scoreBreakdown`, метрики) сохраняются в
`news.score` / `news.metrics`; отбракованные → `status='rejected'`.

## Шаги 1–3: Обработка одобренных статей (строго последовательно)

```bash
# Манифест одобренных (pending + score>75 + content IS NULL)
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
# Дневной лимит: HERMES_DAILY_CAP (default 5)
```

## Статусы статей в БД

```
(pending, score=NULL)  →  evaluate: score>65 & slot → pending (approved)
                      ↘  score≤65 или нет слота     → rejected
approved pending → summarized (RU title+summary, 1 Zen call) → published
```

| Статус | Описание |
|--------|----------|
| `pending` + score NULL | Собран коллектором, ждёт оценки |
| `pending` + score > 65 | Одобрен data-driven скорингом, ждёт обработки |
| `rejected` | Не прошёл gate 65 или дневной лимит (метрики сохранены) |
| `summarized` | RU заголовок + RU саммари получены за 1 вызов Zen |
| `published` | Видна пользователям в дашборде |

> Статус `translated` упразднён (v3): шаг перевода удалён из конвейера.

## Обработка ошибок

| Скрипт | Тип ошибки | Действие |
|--------|-----------|----------|
| collect-dual | RSS/API недоступен | Пропустить источник, продолжить |
| collect-dual | Дубликат (URL/semantic) | Skip, счётчик duplicates |
| evaluate-news | Метрика недоступна | Метрика = null, 0 баллов за критерий |
| evaluate-news | Score ≤ 65 / нет слота | status='rejected' |
| manifest-gen | Пустой манифест | Завершить цикл (success) |
| fetch-article | HTTP error / < 100 chars | Пропустить статью |
| save-summary | Zen unavailable / no JSON | Прервать обработку статьи |
| deploy-ready | DB error | Залогировать, продолжить |

## Конфигурация (env)

```env
DATABASE_URL=postgresql://postgres:***@localhost:5432/science_agent
ZEN_BASE_URL=https://opencode.ai/zen/v1
ZEN_API_KEY=sk-***
ZEN_MODEL=nemotron-3-ultra-free
LINEAR_WORKER_INTERVAL_MS=600000   # интервал цикла Ralph Loop
HERMES_DAILY_CAP=5                 # лимит одобренных статей в сутки
```

## Зависимости

- Node.js + tsx, PostgreSQL, Zen API (OpenAI-compatible)
- `rss-parser` (RSS/Atom), `cheerio` (извлечение ссылок/DOI), `drizzle-orm`
- Внешние read-only API: GitHub REST, HN Algolia, Reddit JSON, Altmetric
