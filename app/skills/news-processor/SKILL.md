# News Processor — Ralph Loop (v2: один выпуск в сутки)

Алгоритм конвейера для Hermes Agent. Один запуск в UTC-сутки: собрать,
отфильтровать дешёвым префильтром, проверить LLM-судьёй, уложиться в дневной
бюджет, сделать русские выжимки и опубликовать **один** выпуск. Утром — дайджест
клиенту и служебный отчёт владельцу.

> Принципы v2:
> - **Один выпуск в сутки.** `pipeline_state.cycleId = cycle-YYYY-MM-DD`; после
>   `stage=published` цикл спит до следующих UTC-суток. Повтор — только после сбоя.
> - **Две ступени отбора.** Префильтр (без сети и токенов) отсеивает мусор,
>   затем судья (LLM) решает тему и направление по заголовку и лиду. Судья
>   fail-closed: невалидный JSON или `confidence < 0.7` = отказ.
> - **Бюджет дня — жёсткий.** `DAILY_BUDGET` (5..10, по умолчанию 8) проверяется
>   и при отборе, и при публикации.
> - **Два провайдера.** GigaChat основной, OpenCode Go — фолбэк только на
>   quota/transient; при 401/403 фолбэка нет, это ошибка конфигурации.
> - **Клиент не видит служебку.** Клиентский выпуск и служебный отчёт — разные
>   функции и разные получатели.

Разделы и направления — данные, а не код отбора:
`app/scripts/hermes/topics.ts` (3 раздела, 6 направлений). Словарь —
`CONTEXT.md`, архитектура — `ARCHITECTURE.md`.

---

## Конвейер

```
collect-dual.ts → evaluate-news.ts → manifest-gen.ts → fetch-article.ts
                → save-summary.ts (1 вызов LLM) → deploy-ready.ts (1 публикация/сутки)
                → daily-digest.ts (cron 06:00 UTC)
```

Каждый шаг — отдельный процесс `npx tsx`, строго последовательно, без fan-out.
Оркестратор — `app/scripts/hermes/ralph-loop.sh`.

### Шаг 0: состояние дня (`publish-budget.ts --status`)

```bash
cd app && npx tsx scripts/hermes/publish-budget.ts --status
```

JSON: `cycleId`, `stage`, `released`, `published`, `budget`, `metrics`. Если
`released=true`, цикл спит до полуночи UTC. Битый `DAILY_BUDGET` или недоступная
БД — выход на старте (`exit 1`), а не работа на молчаливом дефолте.

### Шаг 1: сбор (`collect-dual.ts`)

```bash
cd app && npx tsx scripts/hermes/collect-dual.ts --stream both   # tech|science|both
```

- **Текст:** RSS-блоги (OpenAI, Hugging Face, Google AI, MIT TR, Naked Science),
  GitHub, Hacker News (Algolia), arXiv, журналы. **Reddit отключён** (429 и шум).
- **YouTube:** 13 курируемых каналов, RSS + обход `/videos` и `/shorts`
  (`YOUTUBE_TAB_ITEMS`, по умолчанию 3 на вкладку).
- **Time Guard fail-closed:** нет даты или старше 72 часов → не вставляется.
- **Дедуп:** URL + семантическая схожесть заголовков (`dedup.ts`, 0.85).
- **Лид сохраняется** в `news.summary` (RSS-описание) — по нему работают
  префильтр и судья.

### Шаг 2: отбор и оценка (`evaluate-news.ts`)

```bash
cd app && npx tsx scripts/hermes/evaluate-news.ts --batch
cd app && npx tsx scripts/hermes/evaluate-news.ts --id 123     # одна статья вручную
```

Порядок внутри (нарушать нельзя — он же контракт тестов):

1. **Префильтр** (`prefilter.ts`) по заголовку и лиду: `keep` или причина
   `empty-title | unknown-date | stale | no-ai-signal`.
2. **Судья** (`judge.ts`) по заголовку и лиду: JSON
   `{onTopic, section, direction, confidence, reason}`; вердикт пишется в
   `news.metrics.judge`. Второй контрольный вопрос — только для `onTopic=true` и
   `confidence >= 0.7`.
3. **Бюджет скачиваний:** остаток `DAILY_BUDGET` на сегодня; страница качается
   только для прошедших шаги 1–2. Лишние остаются `pending` с вердиктом
   (`deferred-budget`) — судья за них повторно не платит.
4. **Скоринг** без LLM (источник, GitHub/HN, arXiv, altmetric, YouTube) и решение
   по гейту `SCORE_GATE` (50): `approved` или `rejected-low-score`.

Итог шага — счётчики в `pipeline_state.metrics`: `collected`, `prefiltered`,
`judged`, `approved`, `published`, `rejectedByReason` (`prefilter:*`, `judge:*`,
`score:*`, `publish:*`, `provider:*`), `usage` (токены).

### Шаг 3: манифест (`manifest-gen.ts`)

```bash
cd app && npx tsx scripts/hermes/manifest-gen.ts --output /tmp/hermes-manifest.json --limit 50
```

Только `status='pending'`, `content IS NULL`, `score >= SCORE_GATE`; берутся
лучшие в пределах `DAILY_BUDGET` (балл → уверенность судьи → свежесть). Платить за
выжимки того, что не опубликуется, — та самая работа впустую.

### Шаги 4–6: по статье, строго по одной

```bash
cd app && npx tsx scripts/hermes/fetch-article.ts --url "$URL"
cd app && npx tsx scripts/hermes/save-summary.ts --id "$ID" --auto
# публикация одна на весь цикл:
cd app && npx tsx scripts/hermes/deploy-ready.ts
```

- `fetch-article.ts` — текст статьи (cheerio) или транскрипт YouTube; меньше 100
  символов → код 1 и запись сбоя.
- `save-summary.ts` — **один** вызов LLM: русский заголовок + выжимка (JSON),
  `status='summarized'`, `modelUsed`; без шага перевода.
- `deploy-ready.ts` — единственная публикация: `planPublication()` проверяет
  зафиксированный выпуск дня и остаток бюджета, пишет `status='published'`,
  `platformPublishedAt` и счётчики. Отказ — с причиной
  (`already-published-today`, `daily-budget-exhausted`, `no-ready-articles`).

### Шаг 7: дайджест (`daily-digest.ts`, cron 06:00 UTC)

```bash
cd app && npx tsx scripts/hermes/daily-digest.ts
```

Выборка — опубликованное за 24 часа. Клиент (`TELEGRAM_CLIENT_CHAT_IDS`) получает
только чистый выпуск; владелец (`TELEGRAM_OWNER_CHAT_IDS`) — копию и служебный
отчёт; служебный уходит первым. Без токена/получателей — stub-режим с печатью в
лог, а не «отправлено».

---

## Запуск всего цикла

```bash
cd app && bash scripts/hermes/ralph-loop.sh
# PM2: процесс hermes-ralph-loop (ecosystem.config.cjs)
# Пауза повтора после сбоя: LINEAR_WORKER_INTERVAL_MS (в примере окружения 600000 = 10 мин;
#   без переменной loop берёт 900000 = 15 мин). Это НЕ интервал выпусков.
```

`HERMES_DAILY_CAP` удалён: бюджет дня задаётся только `DAILY_BUDGET`.

## Статусы статей

```
pending (score NULL) → префильтр → судья → бюджет → балл
                     ↘ отказ (rejected) с причиной в metrics
approved pending → summarized (RU заголовок + выжимка) → published
                 ↘ сбой fetch/транскрипта → повтор (до 3) → rejected
```

| Статус | Описание |
|---|---|
| `pending` + `score=NULL` | Собран, ждёт оценки |
| `pending` + `score >= 50` | Одобрен, ждёт выжимки |
| `pending` + вердикт, `deferred-budget` | Одобрен судьёй, но не влез в бюджет скачиваний |
| `rejected` | Отказ префильтра/судьи/гейта/лимита; причина в `metrics` |
| `summarized` | Русский заголовок и выжимка готовы |
| `published` | Виден клиенту, попадает в дайджест |

## Обработка ошибок

| Шаг | Ошибка | Действие |
|---|---|---|
| collect-dual | фид/API недоступен | пропустить источник, писать `source_health`, продолжить |
| collect-dual | дубликат | skip, счётчик |
| prefilter | пустой заголовок, нет даты, старше 72 ч | отказ с причиной |
| judge | невалидный JSON / `confidence < 0.7` | отказ (fail-closed), `metrics.judge.reason` |
| провайдер | 429/5xx/timeout | переход на OpenCode Go (тот же формат ответа) |
| провайдер | 401/403 | ошибка конфигурации, фолбэка нет, алерт владельцу |
| evaluate-news | метрика недоступна | критерий = 0, остальное считается |
| manifest-gen | пустой манифест | цикл завершается без выпуска |
| fetch-article | нет текста/транскрипта | `metrics.processingFailures`, после 3 попыток `rejected` |
| save-summary | провайдер отказал | повтор позже, счётчик `provider:unavailable` |
| deploy-ready | бюджет или выпуск дня | отказ с причиной, без публикации |

## Конфигурация (имена; значения — только в `app/.env`)

```ini
DATABASE_URL=postgresql://…
JWT_SECRET=                      # или legacy APP_SECRET
DAILY_BUDGET=                    # 5..10, пусто = 8
GIGACHAT_CLIENT_ID=
GIGACHAT_CLIENT_SECRET=
GIGACHAT_SCOPE=                  # GIGACHAT_API_PERS
GIGACHAT_MODEL=                  # GigaChat
NODE_EXTRA_CA_CERTS=             # российские корневые сертификаты для Node
ZEN_GO_API_KEYS=                 # фолбэк: OpenCode Go
ZEN_GO_MODEL=                    # mimo-v2.5
LINEAR_WORKER_INTERVAL_MS=       # пауза повтора после сбоя
TELEGRAM_BOT_TOKEN=
TELEGRAM_CLIENT_CHAT_IDS=
TELEGRAM_OWNER_CHAT_IDS=
DIGEST_DASHBOARD_URL=
```

Полный контракт — `app/.env.example`, его сверяет с кодом
`scripts/check-env-example.ts`. Замена ключа без рестарта:
`scripts/update-key.sh GIGACHAT_CLIENT_SECRET` (значение только из stdin).

## Проверки

```bash
cd app && npx tsc -b && npx vitest run
cd app && npx tsx ../scripts/check-env-example.ts
cd app && npx tsx ../scripts/check-docs.ts
```

Сквозной сценарий на живом сервере и порядок развёртывания — `docs/DEPLOY.md`.
Тесты конвейера — `app/scripts/hermes/*.test.ts` (`pipeline-budget`, `judge`,
`prefilter`, `relevance-set`, `digest-format`, `chain`).
