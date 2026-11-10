# ARCHITECTURE.md — технический паспорт системы

> **Продукт:** «Научный агент» — закрытый дашборд и ежедневный Telegram-выпуск
> ИИ-новостей для одного заказчика.
> **Состояние:** v2 на новом стеке, код и документы готовы, развёртывание ждёт G02
> (адрес сервера и доступы). Актуально на 2026-11-10.
> **Проверено:** 354 теста в 34 файлах, `tsc -b` без ошибок, `scripts/check-docs.ts`
> и `scripts/check-env-example.ts` зелёные.

Этот документ описывает **то, что запускается**, а не то, что когда-то
планировалось. Если цифра в тексте расходится с кодом — дефект; цифры из
таблицы «Паспорт фактов» сверяются автоматически.

---

## 1. Что делает система

Раз в сутки агент собирает материалы из RSS, GitHub, Hacker News, arXiv, журналов и
курируемых YouTube-каналов, дешёвым детерминированным префильтром отбрасывает
заведомый мусор, дорогим LLM-судьёй проверяет, что материал действительно про тему
раздела и направления, оставляет лучшие по баллу в пределах дневного бюджета,
делает русские выжимки и публикует **один выпуск**. Утром клиент получает чистый
дайджест, владелец — его копию и отдельный служебный отчёт.

Три раздела и шесть направлений науки — данные, а не код отбора: они живут в
`app/scripts/hermes/topics.ts` (см. `docs/adr/0001-sections-and-directions.md`).

---

## 2. Стек

| Слой | Технологии |
|---|---|
| Frontend | React 19, Vite, TypeScript 5.9, Tailwind CSS 3.4, Radix UI, TanStack Query, tRPC client, react-router 7 |
| Backend | Node.js 20, Hono, tRPC 11, jose (JWT HS256), bcryptjs |
| База | PostgreSQL 16, Drizzle ORM, миграции `app/db/migrations` (0000–0011) |
| LLM | цепочка провайдеров: GigaChat (основной) → OpenCode Go (фолбэк только на quota/transient) |
| Медиа | yt-dlp, ffmpeg, Whisper API (Groq `whisper-large-v3-turbo`) для видео без субтитров |
| Эксплуатация | Ubuntu 24.04, PM2 (`news-agent-web`, `hermes-ralph-loop`), nginx + certbot, cron, rclone |
| Качество | Vitest (354 теста, 34 файла), `tsc -b`, ESLint, Prettier |

Docker (`docker-compose.yml`, `Dockerfile`) — legacy-путь без конвейера и без
`yt-dlp`/`ffmpeg`; прод так не поднимается (`docs/DEPLOY.md` §13).

---

## 3. Паспорт фактов (сверяется `scripts/check-docs.ts`)

<!-- checked-facts:start -->
| Факт | Значение |
|---|---|
| `SCORE_GATE` | 50 |
| `DAILY_BUDGET` | 5..10, default 8 |
| `GIGACHAT_MODEL` | GigaChat |
| `ZEN_GO_MODEL` | mimo-v2.5 |
| `ZEN_MODEL_LEGACY` | zen-default |
| `DIRECTIONS` | 6 |
| `SECTIONS` | 3 |
| `JUDGE_CONFIDENCE_THRESHOLD` | 0.7 |
| `MAX_ITEMS_PER_SECTION` | 7 |
| `SUMMARY_MAX_CHARS` | 180 |
<!-- checked-facts:end -->

Источники этих чисел: `app/scripts/hermes/pipeline-config.ts` (`SCORE_GATE`),
`app/scripts/hermes/publish-budget.ts` (`DAILY_BUDGET_*`),
`app/api/ai/providers/gigachat.ts` (`DEFAULT_GIGACHAT_MODEL`),
`app/api/ai/zenClient.ts` (`ZEN_GO_MODEL_DEFAULT`),
`app/api/ai/providers/zen.ts` (legacy-модель),
`app/scripts/hermes/topics.ts` (`SECTIONS`, `DIRECTIONS`),
`app/scripts/hermes/judge.ts` (`JUDGE_CONFIDENCE_THRESHOLD`),
`app/scripts/hermes/digest-format.ts` (`MAX_ITEMS_PER_SECTION`, `SUMMARY_MAX_CHARS`).

---

## 4. Поток новости: от источника до Telegram

```
 collect-dual.ts            evaluate-news.ts                        deploy-ready.ts
 ┌───────────────┐   ┌──────────────────────────────────────┐   ┌───────────────────┐
 │ RSS, GitHub,  │   │ A. префильтр (без сети)              │   │ последняя проверка│
 │ HN, arXiv,    │──▶│ B. судья: title + лид (LLM, JSON)    │──▶│ бюджета дня       │
 │ журналы,      │   │ C. дневной бюджет скачиваний         │   │ + «один выпуск»   │
 │ YouTube       │   │ D. скачивание страницы и скоринг     │   │ → published       │
 └───────┬───────┘   └──────────────────┬───────────────────┘   └─────────┬─────────┘
         │ 72h Time Guard, дедуп        │ счётчики в pipeline_state.metrics │
         ▼                              ▼                                    ▼
      news (pending)               news.metrics.judge                 daily-digest.ts
                                                                      06:00 UTC
                                                          ┌────────────┴────────────┐
                                                          ▼                         ▼
                                                   клиентский выпуск        служебный отчёт
                                                   (чистый текст)           (владельцу)
```

Отдельные шаги внутри цикла (порядок строгий, последовательный, без fan-out):
`collect-dual.ts` → `evaluate-news.ts` → `manifest-gen.ts` → на каждую статью
`fetch-article.ts` → `save-summary.ts` → одна публикация `deploy-ready.ts`.
Оркестратор — `app/scripts/hermes/ralph-loop.sh`.

**Точки отказа** (подробнее — `docs/DEPLOY.md` §15): недоступный фид (пропуск
источника, счётчик в `source_health`), пустой сбор (цикл завершается, повтор по
таймеру), LLM-сбой (судья fail-closed, выжимка → повтор), превышение бюджета
(публикация отклоняется с причиной), Telegram (ретраи, статус `sent|partial|failed`),
база (health 503, цикл ждёт).

---

## 5. Сбор (`collect-dual.ts`)

Два потока (`--stream both`), одна вставка в `news`:

- **Текст:** RSS-блоги (OpenAI, Hugging Face, Google AI, MIT Technology Review,
  Naked Science), GitHub (trending/search API), Hacker News (Algolia), arXiv,
  Nature/Science/Cell/Lancet. **Reddit отключён** по политике: 429 и шум.
- **YouTube:** 13 курируемых каналов (`YOUTUBE_SOURCES`,
  `DEDICATED_AI_YOUTUBE_SOURCES`), RSS + явный обход `/videos` и `/shorts`
  (`YOUTUBE_TAB_ITEMS`, по умолчанию 3 на вкладку).

Инварианты сбора:

- **Time Guard fail-closed:** кандидат без валидной даты или старше 72 часов не
  попадает в базу.
- **Дедуп:** unique index по `originalUrl` + семантическая схожесть заголовков
  (`dedup.ts`, порог 0.85, последние 20 записей).
- **Лид сохраняется:** RSS-описание пишется в `news.summary` при сборе — по нему
  работают префильтр и судья. Это исправление D01: раньше текстовый поток писал
  `summary: ""` и судья видел только заголовок.
- Маршрутизация раздела при вставке — `app/api/lib/section-resolve.ts`
  (invention-tools > science > ai-news), затем уточняется на оценке и выжимке.

---

## 6. Отбор: префильтр, судья, бюджет, скоринг

### 6.1. Ступень A — префильтр (`prefilter.ts`)

Детерминированный, без сети: AI-сигнал в заголовке и лиде, свежесть, пустой
заголовок, неизвестная дата. Возвращает `{ keep, score, reason, evidence }`,
`reason ∈ empty-title | unknown-date | stale | no-ai-signal | keep`. Словари и веса
не покидают модуль.

### 6.2. Ступень B — LLM-судья (`judge.ts`)

Один короткий вызов на кандидата по **заголовку и лиду** (не по странице).
Строгий JSON `{onTopic, section, direction, confidence, reason}`; рубрика — из
`topics.ts` (`TOPIC_PROMPT_RU`).

**Fail-closed:** невалидный JSON, `onTopic=false` или `confidence < 0.7` —
отклонение с машинной причиной (`invalid-judgement`, `low-confidence`,
`rejected-by-review`, `invalid-review`). Для вердиктов `onTopic=true` и
`confidence >= 0.7` задаётся независимый контрольный вопрос — второй короткий
вызов, принятая цена точности (`docs/adr/0002-judge-fail-closed.md`). Вердикт
пишется в `news.metrics.judge` (`onTopic/section/direction/confidence/reason/
provider/model`); повторно за того же кандидата судья не платит.

### 6.3. Бюджет скачиваний и балл

Страница скачивается только для кандидатов, прошедших префильтр, судью и дневной
бюджет скачиваний (число = остаток `DAILY_BUDGET` на сегодня). Скоринг —
детерминированный, без LLM: авторитет источника, arXiv + открытый артефакт,
altmetric, GitHub/HN-цифры, YouTube-бонусы. Прошедшие `SCORE_GATE` (50) остаются
`pending` с баллом, остальные — `rejected`. `metrics.decision` фиксирует
`approved | rejected-low-score | rejected-judge | deferred-budget`.

### 6.4. Бюджет дня и выпуск (`publish-budget.ts`, `manifest-gen.ts`, `deploy-ready.ts`)

`DAILY_BUDGET` (5..10, по умолчанию 8) — **жёсткий** предел публикаций за UTC-сутки.
Порядок отбора: балл desc → уверенность судьи desc → свежесть desc → id.
Бюджет проверяется дважды: `manifest-gen.ts` берёт лучшие в пределах бюджета,
`deploy-ready.ts` через `planPublication()` отказывает, если публикация превысила
бы бюджет или выпуск дня уже зафиксирован (`reason ∈ already-published-today |
daily-budget-exhausted | no-ready-articles`). Поэтому ручная правка манифеста или
прямой вызов публикации не может выпустить лишнее (`docs/adr/0004-one-release-per-day.md`).

### 6.5. Счётчики цикла

`pipeline_state.metrics` (jsonb, миграция `0011`) — дневной журнал:
`collected`, `prefiltered`, `judged`, `approved`, `published`,
`rejectedByReason` (`prefilter:…`, `judge:…`, `score:…`, `publish:…`,
`provider:…`), `usage` (`calls`, `inputTokens`, `outputTokens`). Одна строка на
UTC-день, `cycle-YYYY-MM-DD`; повтор после сбоя продолжает тот же цикл, второй
запуск после выпуска видит `stage=published` и спит до следующих суток.

---

## 7. Провайдеры LLM

Контракт — `app/api/ai/providers/types.ts` (`ProviderId`, `ChatMessage`,
`ChatResult`, `CompleteJson`, `ProviderErrorClass = config | quota | transient |
content`, `ProviderError`).

| Провайдер | Файл | Авторизация | Модель по умолчанию |
|---|---|---|---|
| GigaChat | `app/api/ai/providers/gigachat.ts` | OAuth `client_credentials`, токен кешируется с запасом 60 с | `GigaChat` |
| OpenCode Go | `app/api/ai/providers/zen.ts` | пул Go-ключей через `zenClient.ts` | `mimo-v2.5` |
| OpenCode legacy | тот же адаптер, без Go-ключа | пул `ZEN_API_KEYS` | `zen-default` |

`zen-default` — метка модели для legacy-пути, когда `ZEN_MODEL` не задан: сам
запрос идёт цепочкой `app/api/ai/zenClient.ts` (`ZEN_MODEL` → `ZEN_FALLBACK_MODELS`),
а `app/.env.example` задаёт `ZEN_MODEL=deepseek-v4-flash-free`. Метка попадает в
`news.metrics.judge.model` и в учёт расхода; она описывает, кто ответил, а не
выбирает модель за клиента.

Цепочка — `app/api/ai/providers/chain.ts`: GigaChat → OpenCode. **Правило
перехода:** `quota` (402/429) и `transient` (5xx, таймаут, сеть) переключают на
следующего; `config` (401/403, нет ключа, нет подписки Go) — не переключают, а
поднимают ошибку наверх: другой провайдер скрыл бы причину
(`docs/adr/0003-provider-chain.md`). Каждый успешный вызов возвращает `usage`,
расход пишется в счётчики цикла.

Снимок `.env` читается на каждый вызов (`app/api/ai/providers/env.ts`), файл важнее
`process.env`: замена ключа через `scripts/update-key.sh` подхватывается следующим
шагом цикла без рестарта.

**Известное ограничение:** цепочка сейчас подключена к судье
(`app/scripts/hermes/evaluate-news.ts`); выжимки (`save-summary.ts`) по-прежнему
идут через `summarizeOneShot()` из `app/api/ai/zenClient.ts`, то есть через
OpenCode, без GigaChat. Перенос выжимок в цепочку — следующий шаг, в этом прогоне
не делался.

---

## 8. Выжимка и формат выпуска

- `save-summary.ts` — **один** вызов LLM на статью: русский заголовок + выжимка
  (JSON), без отдельного шага перевода; `status='summarized'`, `modelUsed`.
- `digest-format.ts` — формат сообщений: `buildClientDigest()` (ровно согласованный
  вид, без служебных строк), `buildEmptyClientDigest()`, `buildOwnerReport()`
  (служебный отчёт), `formatItem()`, `fitSummary(text, 180)` (обрезка по границе
  слова), `splitTelegramText(text, 4000)`.
- Лимиты: 7 карточек на раздел, остаток — строкой «Ещё N материалов», выжимка
  ≤ 180 знаков, сообщение ≤ 4000 знаков.
- **Три раздела, фиксированный порядок:** 🛠 «ИИ-новости» → 🔬 «ИИ для науки» →
  🧪 «Инструменты для изобретений». Совпадают в дашборде и Telegram.

---

## 9. Дайджест: клиент и владелец

`daily-digest.ts` (`cron 06:00 UTC`):

| Получатели | Переменная | Что получают |
|---|---|---|
| Клиент | `TELEGRAM_CLIENT_CHAT_IDS` | только `buildClientDigest()` — ни ошибок, ни счётчиков, ни строки здоровья |
| Владелец | `TELEGRAM_OWNER_CHAT_IDS` | копию того же чистого выпуска + отдельный служебный отчёт |

Служебный отчёт уходит **первым**, чтобы сбой выпуска дошёл до владельца раньше
клиента. Legacy `TELEGRAM_CHAT_IDS` / `TELEGRAM_CHAT_ID` остаются клиентским
фолбэком. Пустой день не молчит: отправляется явное «новых публикаций нет».
Без токена или получателей дайджест печатается в лог (stub-режим) и не притворяется
отправленным. Статус доставки — `sent | partial | failed`, код выхода 1, если не
доставлено никому.

---

## 10. База данных

PostgreSQL 16, база `science_agent`, Drizzle ORM, миграции `app/db/migrations`
(актуально `0011`).

- `news` — ядро: `originalUrl` UNIQUE + CHECK `http(s)`, `originalTitle` для
  дедупа, `summary` (лид, затем русская выжимка), `score`, `status`, `section`,
  `sphereTags`, `scienceField`, `metrics` (jsonb), `modelUsed`, даты.
- `pipeline_state` — журнал цикла: `cycleId` UNIQUE (`cycle-YYYY-MM-DD`), `stage`
  (`idle | evaluated | published`), `metrics` jsonb (миграция 0011), `totalArticles`,
  `processedArticles`, `startedAt`, `completedAt`.
- `categories` — 6 научных направлений (`type='science'`), сид `db/seed.ts`.
- `invention_tools` — каталог инструментов, сиды `scripts/seed-ai-science-tools.ts`
  и `scripts/seed-invention-tools.ts`.
- `sources`, `source_health`, `agent_state` (состояние пула ключей
  `zen-key-pool`), `users`, `favorites`, `read_status`.

Статусы `news`: `pending` (собран; после одобрения остаётся `pending` с баллом) →
`summarized` → `published`; отказ — `rejected` с причиной в `metrics`. Статус
`translated` остался от legacy-агентов и конвейером не ставится.

---

## 11. Оркестрация и расписание

`app/scripts/hermes/ralph-loop.sh` (PM2 `hermes-ralph-loop`):

1. читает состояние дня (`publish-budget.ts --status`); битый `DAILY_BUDGET` или
   недоступная БД — выход на старте, а не тихий дефолт;
2. если выпуск дня уже опубликован — спит до следующих UTC-суток;
3. иначе: сбор → префильтр/судья/бюджет/скоринг → манифест → по статьям
   (fetch → save-summary) → **одна** публикация;
4. после выпуска спит до полуночи, после сбоя повторяет через
   `LINEAR_WORKER_INTERVAL_MS` (в примере окружения 600000 = 10 мин, без
   переменной loop берёт 900000 = 15 мин). Это пауза **повтора**, а не интервал
   выпусков: `HERMES_DAILY_CAP` удалён, второго выпуска за сутки не бывает.

Утренний дайджест и ночной бэкап — cron (`docs/DEPLOY.md` §8); PM2 владеет
процессами, cron — часами.

---

## 12. Безопасность

- **Целостность URL:** `originalUrl` не меняется после сбора, LLM не генерирует
  ссылки, БД запрещает не-http(s) URL; в дайджесте ссылка берётся из БД.
- **Prompt injection:** тело статьи и транскрипт обёрнуты маркерами
  `--- BEGIN ARTICLE (UNTRUSTED) ---` / `--- END ARTICLE ---`; модели сказано, что
  это данные, а не инструкции.
- **SSRF-гард:** `app/api/lib/url-safety.ts` отсекает приватные, loopback,
  link-local и metadata-адреса до `fetch()`.
- **Закрытый доступ:** email + пароль, bcrypt (cost 12), JWT HS256 в httpOnly-куке,
  отзыв сессий через `tokenVersion`, публичной регистрации нет; rate limit на API
  и на `/health`.
- **Секреты только в `.env`:** в коде, тестах, `.env.example` и документации —
  только имена переменных.
- **Сервер:** вход по SSH только ключом, `ufw`, `fail2ban`, заблокированный
  root-пароль — `scripts/deploy/harden.sh` и чек-лист в `docs/DEPLOY.md` §10.

---

## 13. Развёртывание и проверки

Native-стек: Ubuntu 24.04, Node 20, PostgreSQL 16, PM2, nginx + certbot, cron,
rclone для бэкапа вне сервера. Пошаговый runbook — `docs/DEPLOY.md`; скрипты —
`scripts/deploy/install.sh`, `scripts/deploy/cron.sh`, `scripts/deploy/harden.sh`,
`scripts/deploy/gigachat-certs.sh`, `scripts/deploy/check-gigachat.sh`,
`scripts/backup-offsite.sh`.

Обязательные проверки перед каждым коммитом:

```bash
cd app && npx tsc -b && npx vitest run
cd app && npx tsx ../scripts/check-env-example.ts
cd app && npx tsx ../scripts/check-docs.ts
```

---

## 14. Известные ограничения

1. **Развёртывание не выполнено** — ждёт G02 (адрес, домен, доступы).
2. **GigaChat не проверен живым ключом** — адаптер и цепочка проверены на моках;
   вызов с российского сервера проверяется `scripts/deploy/check-gigachat.sh`
   после получения ключа и сертификатов.
3. **Выжимки идут не через цепочку**, а через `zenClient` (см. §7).
4. **Хранилище бэкапов** не настроено (нет аккаунта) — путь отказа проверен,
   загрузка и восстановление проверяются после G02.
5. **Дата последнего бэкапа** пишется в `~/.news-agent/last-backup.json` и в лог;
   в служебный отчёт владельца она пока не встроена.
6. **Каталог инструментов** наполняется сидами; ручная верификация URL карточек —
   на владельце.
7. **`zenClient.ts` читает конфигурацию при импорте**: долгоживущий процесс держит
   старый пул ключей. В текущей схеме каждый шаг — отдельный `npx tsx`, поэтому
   новый ключ видит следующий шаг; переписывание клиента отложено.
8. **science.org / nature.com** блокируют IP дата-центров — ссылки проверяются
   через doi.org-резолвер (`app/scripts/check-urls.ts`).
9. **Reddit** отключён; возврат потребует отдельного решения по 429 и шуму.
10. **Первый выпуск** после развёртывания может быть короче бюджета: за первые
    сутки база пустая, а Time Guard отсекает старые материалы.

---

*Сопутствующие документы: `CONTEXT.md` (словарь), `PROGRESS.md` (сделано и
открыто), `docs/DEPLOY.md` (runbook), `docs/adr/` (почему так решено),
`AGENTS.md` (workflow для AI-агентов).*
