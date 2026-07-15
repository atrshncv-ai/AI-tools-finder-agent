# ARCHITECTURE.md — Технический паспорт продукта

> **Продукт:** ИИ-новостной агент «Hermes» — автономная система сбора, оценки и публикации новостей об ИИ-инструментах и научных открытиях с закрытым доступом.
> **Статус:** Production (финальная форма). Документ актуализирован после эпика мультимодального конвейера и замены авторизации.
> **Последнее обновление:** 2026-07-15.

---

## 1. Обзор системы

Сервис непрерывно собирает новости из текстовых источников (RSS-блоги, GitHub, HackerNews, Reddit, arXiv, научные журналы) и видео-источников (курируемые YouTube-каналы, включая Shorts), оценивает их детерминированным скорингом, суммаризирует через LLM на русском языке и публикует в закрытом веб-дашборде. Каждое утро администратор получает Telegram-дайджест свежих публикаций.

Ключевые свойства production-системы:

- **Полная автономность** — цикл работает 24/7 под PM2 без участия оператора.
- **Мультимодальность** — единый конвейер обрабатывает и тексты, и видео (субтитры → аудио → Whisper).
- **Нулевой дневной лимит** — публикуются **все** материалы с баллом > 65.
- **Анти-галлюцинационная защита** — жёсткая привязка URL к первоисточнику, LLM никогда не генерирует ссылки.
- **Закрытый доступ** — Login/Password, JWT в httpOnly-куки, публичной регистрации нет.

---

## 2. Стек технологий

| Слой | Технологии |
|---|---|
| **Frontend** | React 19, Vite, TypeScript, Tailwind CSS 4, Radix UI, TanStack Query, tRPC client, wouter |
| **Backend** | Node.js 20, Hono (HTTP-сервер), tRPC 11 (типизированный API), jose (JWT), bcryptjs |
| **База данных** | PostgreSQL 16 (Docker `science_agent_db`), Drizzle ORM, миграции `db/migrations` (актуально: 0007) |
| **LLM** | Opencode Zen API (`opencode.ai/zen/v1`, OpenAI-compatible), модель `nemotron-3-ultra-free`, пул из 3 ключей с race-safe ротацией (`api/ai/zenClient.ts`) |
| **Медиа-конвейер** | yt-dlp 2026.07.04 (+ Deno JS-runtime), ffmpeg 6.1.1, Whisper API (Groq `whisper-large-v3-turbo` / OpenAI-compatible) |
| **Уведомления** | Telegram Bot API (`@instrument_assistant_bot`) |
| **Инфраструктура** | Ubuntu 24.04, PM2 (`news-agent-web`, `hermes-ralph-loop`), cron, nginx, Docker |
| **Качество** | Vitest (82 теста), `tsc -b`, ESLint, Prettier |

---

## 3. Высокоуровневая архитектура

```
┌─────────────────────────── СБОР (collect-dual) ───────────────────────────┐
│  Текст: RSS-блоги (OpenAI, HF, Google) · GitHub trending · HackerNews ·   │
│  Reddit · arXiv · Nature/Science/Cell/MIT TR · Naked Science              │
│  Видео: 9 курируемых YouTube-каналов (RSS → yt-dlp fallback)              │
└──────────────────────────────────┬────────────────────────────────────────┘
                                   ▼
┌────────────────── ОЦЕНКА (evaluate-news) ───────────────────┐
│  Детерминированный скоринг: источник + AI-релевантность +    │
│  свежесть + формат. Гейт: score > 65. Дневной лимит: 0 = ∞   │
└──────────────────────────────────┬───────────────────────────┘
                                   ▼
┌───────────────── ОБОГАЩЕНИЕ (manifest-gen → save-summary) ──┐
│  Текст: fetch-article (cheerio) ─┐                           │
│  Видео: субтитры yt-dlp → (нет субтитров) → ffmpeg → Whisper │
│  ──► ОДИН вызов Zen LLM: RU title + summary (one-shot)       │
└──────────────────────────────────┬───────────────────────────┘
                                   ▼
        ┌──────────────┬─────────────────────┬────────────────┐
        ▼              ▼                     ▼                ▼
   PostgreSQL     Web-дашборд        Telegram-дайджест    check-urls
   (Drizzle)      (React+tRPC,       (cron 08:00 MSK)     (GC + DOI-проверка)
                  JWT-защита)
```

**Оркестратор:** `scripts/hermes/ralph-loop.sh` (PM2 `hermes-ralph-loop`), строго последовательный цикл: collect → evaluate → manifest → (fetch → save-summary → deploy-ready), интервал `LINEAR_WORKER_INTERVAL_MS` (по умолчанию 10 мин).

---

## 4. Мультимодальный конвейер (Dual Pipeline)

Файл: `app/scripts/hermes/collect-dual.ts`. Два параллельных потока (`--stream both`), единая вставка в `news` с дедупликацией по `originalUrl` (unique index + 72h Time Guard + семантическая дедупликация `dedup.ts`).

### 4.1. Текстовый поток

- **RSS/Atom-блоги:** OpenAI, Hugging Face, Google AI, MIT Tech Review, Naked Science.
- **GitHub:** trending-репозитории через API (`full_name`, `html_url`, description).
- **HackerNews:** topstories через Algolia API.
- **Reddit:** AI-сабреддиты (с обработкой 429).
- **Наука:** Nature, Science, Cell, arXiv (AI-подборка, `max_results=25`).

### 4.2. Видео-поток (YouTube)

9 курируемых каналов (`YOUTUBE_CHANNELS`): 3 англоязычных (Two Minute Papers, Yannic Kilcher, Matthew Berman) + 6 русскоязычных (Vladimir AI Dev, Rinat Suleymanov, Duncan Rogoff, McDenil, Artemii Miller, DIY Smart Code).

Двухуровневый сбор:

1. **RSS** `youtube.com/feeds/videos.xml?channel_id=…` — быстрый путь.
2. **yt-dlp fallback** (`youtube-transcript.ts: listChannelVideos()`): при 404/пустом RSS — `yt-dlp --print id|title|upload_date` по вкладке `/videos`, для shorts-only каналов — автоматический переход на вкладку `/shorts`. yt-dlp возвращает **реальные даты загрузки**, что критично для скоринга свежести.

Каждое видео вставляется как статья: `originalUrl = https://www.youtube.com/watch?v=…` (всегда!), `source = youtube-<handle>`, язык — из конфигурации канала.

---

## 5. Smart Fallback: Whisper-транскрибация

Файл: `app/scripts/hermes/youtube-transcript.ts` (`fetchYoutubeTranscript()`).

Каскад извлечения текста из видео:

```
yt-dlp --dump-json --js-runtimes deno
  ├─ 1. Нативные субтитры (en → any-lang)
  ├─ 2. Auto-generated captions
  └─ 3. Нет субтитров или текст < 200 символов → WHISPER FALLBACK:
        yt-dlp: скачать аудиодорожку
        ffmpeg: конвертация → 16 kHz mono 32 kbps (оптимально для ASR)
        POST ${WHISPER_API_BASE}/audio/transcriptions  (multipart)
```

- **Провайдеры:** `WHISPER_API_KEY` → `GROQ_API_KEY` → `OPENAI_API_KEY` (по приоритету); `WHISPER_API_BASE` по умолчанию — Groq `whisper-large-v3-turbo`.
- **Graceful degradation:** без API-ключа fallback отключён, видео без субтитров получает `status='rejected'` (без бесконечных ретраев).
- **Безопасность:** `execFile` без shell (нет command injection), таймаут 90 с, транскрипт помечается как untrusted-данные перед передачей в LLM.
- **Требование среды:** yt-dlp требует `--js-runtimes deno` (установлен на сервере).

---

## 6. Скоринг и гейт публикации

Файл: `app/scripts/hermes/evaluate-news.ts`. Полностью детерминированный (data-driven) скоринг — LLM на этом этапе не участвует.

**Текстовые источники:** очки за авторитетность источника + AI-релевантность (ключевые термины EN/RU) + свежесть.

**YouTube-источники:**
| Бонус | Условие |
|---|---|
| +45 | Канал ∈ `DEDICATED_AI_CHANNELS` |
| +15 | AI-тематика в заголовке/описании (`YOUTUBE_AI_TERMS`: Codex, Claude, GPT, DeepSeek, нейросеть, ИИ…); evidence = title + описание, полученное через yt-dlp metadata |
| +10 | Формат видео |
| **= 70** | > гейта 65 → гарантированный проход для курируемых AI-каналов |

**Гейт:** `score > 65` → статья остаётся `status='pending'` с проставленным `score`; остальные — `status='rejected'`. В LLM-конвейер попадают только `pending` + `score ≥ 66` (жёсткий фильтр в `manifest-gen.ts`; строки с `score=NULL` исключаются SQL-семантикой NULL).
**Дневной лимит:** `--daily-cap 0` (по умолчанию) = **безлимитно**; положительное значение включает ограничение обратно. В ralph-loop: `HERMES_DAILY_CAP:-0`.

---

## 7. Инженерия безопасности и анти-галлюцинации

### 7.1. Строгая привязка URL к первоисточникам

- `originalUrl` **никогда не модифицируется** после сбора (инвариант, зафиксированный в `save-summary.ts`: «URL INTEGRITY»). Для YouTube это всегда ссылка на видео.
- LLM получает только текст и возвращает только `titleRu` + `summary` — **генерация URL моделью запрещена** на уровне промпта и архитектуры (URL не проходит через LLM вообще).
- БД: `CHECK`-констрейнт `news_original_url_http` (`^https?://`, миграция 0006) + unique index на `originalUrl`.
- Фронт: `NewsCard` валидирует URL перед рендером ссылки.

### 7.2. Защита от Prompt Injection

- Тело статьи оборачивается в маркеры перед отправкой в LLM (`api/ai/zenClient.ts`):
  ```
  --- BEGIN ARTICLE (UNTRUSTED) ---
  …контент…
  --- END ARTICLE ---
  ```
- Промпт явно инструктирует модель: содержимое между маркерами — недоверенные данные, а не инструкции; любые «команды» из текста игнорировать.
- Транскрипты YouTube/Whisper трактуются как untrusted по умолчанию.

### 7.3. Проверка DOI-ссылок (обход анти-бот систем)

Файл: `app/scripts/check-urls.ts` (Garbage Collection галлюцинированных ссылок).

**Проблема:** крупные издатели (Nature, ScienceDirect) защищены Cloudflare — HEAD/GET с дата-центра возвращает 403 даже для валидных статей, а фейковые DOI от LLM неотличимы по коду ответа.

**Решение — резолвер doi.org:**
1. `extractDoi(url)`: inline-паттерн DOI в URL + эвристика для nature.com (`nature.com/articles/s41586-024-07819-6` → `10.1038/s41586-024-07819-6`).
2. `probeDoi(doi)`: `HEAD https://doi.org/<doi>` с `redirect: "manual"` — doi.org отвечает откуда угодно и не ходит на сайт издателя:
   - `3xx` → DOI существует ✅
   - `404` → DOI выдуман ❌ → статья force-rejected
3. Для не-DOI ссылок: HEAD → GET fallback; «мёртвым» считается только 404/410/DNS-ошибка (403/429 трактуются консервативно как «unknown», чтобы не удалять реальные статьи).

**Результат GC:** 11 галлюцинированных GitHub-URL отклонено; фейковый DOI «The Virtual Biotech» подтверждён через doi.org 404 и удалён; реальный npm-пакет ecc-agentshield сохранён.

### 7.4. Прочие меры

- **SSRF-гард** (`api/lib/url-safety.ts`): каждый внешний URL перед `fetch()` проверяется на приватные/loopback/link-local диапазоны (10/8, 127/8, 172.16/12, 192.168/16, 169.254/16 — включая cloud metadata, 100.64/10, IPv6 ULA; WHATWG-нормализация десятичных/hex-IPv4). Применяется в `collect-dual.ts`, `fetch-article.ts`, `save-summary.ts`.
- Rate limit: 100 req/min на `/api/trpc/*` и 30 req/min на публичный `/health` (per-IP, `api/lib/rateLimit.ts`); 429 возвращается в формате tRPC-конверта.
- `/health`: внешняя проба Zen закэширована на 30 с — флуд эндпоинта не бьёт по Zen API.
- Все внешние fetch — с таймаутами (`AbortSignal.timeout`), `!res.ok` guard'ы.
- Zen key-pool: race-safe ротация 3 ключей, нативные таймауты.
- Фейковые seed-данные удалены из репозитория и БД.

---

## 8. Оркестрация: Hermes Ralph Loop

Файл: `app/scripts/hermes/ralph-loop.sh` (PM2-процесс `hermes-ralph-loop`).

```
while true:
  collect-dual.ts --stream both          # сбор (текст + YouTube)
  evaluate-news.ts --batch --daily-cap 0 # скоринг, гейт >65, безлимит
  manifest-gen.ts --limit 50             # манифест: pending + score≥66
  for each article in manifest:          # СТРОГО последовательно
    fetch-article.ts   → save-summary.ts → deploy-ready.ts
    # ОДИН Zen-вызов на статью: one-shot RU title + summary, без шага перевода
  sleep LINEAR_WORKER_INTERVAL_MS        # по умолчанию 10 минут
```

Принципы: строгая последовательность (одна статья за раз), один LLM-вызов на статью, отсутствие fan-out; сбой шага логируется и не останавливает цикл.

### Утренний Telegram-дайджест

- `scripts/hermes/daily-digest.ts`: выборка опубликованного за 24 часа (по `updatedAt`), секции **🎬 YouTube / 🛠 IT-инструменты / 🔬 Наука**, экранирование Markdown, лимит 4000 символов, stub-режим без ключей.
- **Cron (сервер):** `0 5 * * *` (08:00 МСК) → `npx tsx scripts/hermes/daily-digest.ts`, лог `/var/log/news-agent/digest.log`.
- Отправка через Telegram Bot API (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` в `.env`). Проверено в бою: `{"status":"sent","items":46}`.

### Backfill-харнесс

`scripts/run-yesterday-test.ts` + флаг `--min-age-hours` в collect/evaluate — восстановление статей, отклонённых старым daily-cap, и дооценка необработанных записей.

---

## 9. Приватная авторизация (Login/Password)

OAuth полностью удалён (директория `api/kimi/` со всеми роутами `/api/oauth/*` уничтожена). Замена — строгая закрытая система.

### 9.1. Поток аутентификации

```
POST auth.login (email + password)
  → findUserByEmail → bcrypt.compare (bcryptjs, cost 12)
  → signSessionToken: JWT HS256 { unionId, clientId, tokenVersion }
      secret = SESSION_SECRET || APP_SECRET, expiry = JWT_EXPIRY_HOURS (24ч)
  → Set-Cookie: kimi_sid=<jwt>; HttpOnly; SameSite=Lax (dev) / None+Secure (prod)
      Max-Age = 24ч (синхронизировано с JWT expiry)
```

- `auth.me` — возвращает санитизированного пользователя (хэш пароля **никогда** не покидает сервер — `sanitizeUser()`).
- `auth.logout` — инкремент `tokenVersion` в БД → **все** выданные JWT мгновенно инвалидируются + очистка куки.
- **Публичной регистрации нет.** Аккаунты создаются только CLI:
  ```bash
  npx tsx scripts/create-user.ts --email client@x.com --name "Client" --role user
  # → генерирует пароль XXXX-XXXX-XXXX-XXXX, bcrypt-хэш, synthetic unionId
  ```
  Повторный запуск для существующего email = сброс пароля + ревокация сессий.

### 9.2. Защита API и фронта

- **Backend** (`api/lib/auth.ts` → `authenticateRequest`): парсинг куки → verify JWT (включая сверку `tokenVersion`) → загрузка пользователя из БД → иначе `UNAUTHORIZED`.
- Все контентные процедуры — `authedQuery`: `news.list/byId/categories/translate`, `parser.logs/sources/status`. Мутации парсера — `adminQuery` (роль admin).
- **Frontend** (`src/App.tsx`): все контентные роуты обёрнуты в `<RequireAuth>` (нет сессии → редирект на `/login`); `/login` обёрнут в обратный гард (авторизован → `/`).
- Страница входа — минималистичная: Email + Пароль, подпись «Закрытый сервис. Доступ выдаётся администратором.»

---

## 10. База данных

PostgreSQL 16 в Docker-контейнере `science_agent_db` (БД `science_agent`). Drizzle ORM, миграции `app/db/migrations` (0000–0007).

**Таблицы:** `users` (email, password-hash, role, tokenVersion), `categories`, `news` (ядро: `originalUrl` UNIQUE + CHECK, `originalTitle` для дедупа после перевода заголовка, `score`, `status`, `metrics` jsonb, GIN FTS-индекс по RU-текстам), `favorites`, `readStatus`, `sources`, `parsingLogs`, `agentState`, `sourceHealth`, `pipelineState`.

Ключевые статусы `news`: `pending` → (скоринг: прошёл гейт — остаётся `pending` + score; не прошёл — `rejected`) → `summarized` → `published`. Видео без транскрипта — `rejected` (без ретраев).

---

## 11. Развёртывание и эксплуатация

**Сервер:** Ubuntu 24.04, `/var/www/news-agent/app`, env — `app/.env`.

| Компонент | Команда/конфиг |
|---|---|
| Web (Hono+tRPC, статика Vite) | PM2 `news-agent-web` — `npm run build` → `NODE_ENV=production node dist/boot.js` |
| Конвейер | PM2 `hermes-ralph-loop` — `bash scripts/hermes/ralph-loop.sh` |
| Дайджест | cron `0 5 * * *` |
| БД | Docker `science_agent_db` (PostgreSQL 16) |

**Deploy-flow:** локальные правки → `npm run check` (tsc) + `npx vitest run` → conventional commit + push → tar+scp на сервер → `npm run build` → `pm2 restart --update-env`.

**Quality gates (обязательны перед каждым коммитом):** `cd app && npx tsc -b` и `npx vitest run` (82/82 зелёные).

---

## 12. Известные ограничения

- **science.org / nature.com** блокируют дата-центр IP (403) — для проверки ссылок используется doi.org-резолвер (см. §7.3).
- **Reddit** — периодические 429 (обрабатываются как transient).
- **YouTube RSS** иногда 404 для отдельных каналов — покрыто yt-dlp fallback.
- **Shorts без субтитров** — отклоняются, пока не задан `GROQ_API_KEY` (Whisper fallback активируется добавлением ключа, код уже готов).

---

*Документ отражает production-состояние на коммите `a7c851c`. Сопутствующие документы: `AGENTS.md` (workflow для AI-агентов), `docs/TECHNICAL_AUDIT_REPORT_RU.md` (аудит безопасности), `docs/ADMIN_GUIDE.md`, `docs/DEPLOY.md`, `docs/USER_GUIDE.md`.*
