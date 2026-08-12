# AI Tools Finder Agent

**An autonomous AI news curation agent**: it continuously collects news about AI tools and scientific discoveries, evaluates them with deterministic scoring, summarizes them via LLM in Russian, and publishes them to a closed web dashboard with a morning Telegram digest.

> **Project status: prototype.** A working closed system (auth-gated, no public registration) that has been operated and refined over several months. It is not a public product — it serves a private audience.

## Overview

The agent runs a fully autonomous 24/7 pipeline: it gathers news from text sources (RSS blogs, GitHub trending, HackerNews, Reddit, arXiv, major science journals) **and** curated YouTube channels (including Shorts), scores every item with a deterministic rule-based gate, generates a Russian title + summary with a single LLM call per article, and publishes the results to a protected web dashboard. Every morning the administrator receives a Telegram digest of the last 24 hours of publications.

## Problem

Keeping up with AI news across blogs, GitHub, HackerNews, Reddit, YouTube and scientific journals is a full-time job, and most of it is noise. Existing aggregators don't distinguish "worth reading" from "worth skipping", don't summarize in Russian, and don't verify links.

## Solution

A strictly sequential, no-fan-out pipeline where each stage is a small, testable script in `app/scripts/hermes/`:

```
collect (text + YouTube) → evaluate (deterministic scoring) → manifest → fetch → save-summary → deploy-ready
```

- **collect-dual.ts** — text stream (RSS/GitHub/HackerNews/Reddit/arXiv/journals) + video stream (curated YouTube channels, yt-dlp), with a 72-hour Time Guard and semantic deduplication.
- **evaluate-news.ts** — fully deterministic, data-driven scoring (source authority + AI relevance + freshness + video format). Gate: `score > 65`; no daily cap by default.
- **manifest-gen.ts → fetch-article.ts → save-summary.ts** — enrichment. **One** Zen LLM call per article produces the Russian title + summary in a single shot (no translation step). For videos without subtitles, a Whisper fallback (Groq `whisper-large-v3-turbo`) transcribes the audio.
- **deploy-ready.ts** — marks the article as ready for the dashboard.
- **daily-digest.ts** (cron, 09:00 MSK) — sends the morning Telegram digest grouped into 🎬 YouTube / 🛠 IT tools / 🔬 Science sections.
- **check-urls.ts** — garbage collection of hallucinated links via the doi.org resolver (see Limitations).

The orchestrator is `app/scripts/hermes/ralph-loop.sh` (PM2 `hermes-ralph-loop`), which loops the pipeline every ~10 minutes; a failure in one step is logged and never stops the cycle.

## Anti-hallucination & security engineering

- **URL integrity**: `originalUrl` is never modified after collection, the LLM never generates URLs (prompt-level and architectural prohibition), and a `CHECK` constraint + unique index enforce `http(s)` URLs in the DB.
- **Prompt injection protection**: article bodies are wrapped in `--- BEGIN ARTICLE (UNTRUSTED) ---` markers; transcripts are treated as untrusted data.
- **SSRF guard**: every outbound URL is validated against private/loopback/link-local ranges before fetching.
- **Dead-link GC**: publisher sites behind Cloudflare return 403 even for valid articles, so links are validated via `doi.org` resolver (HEAD with manual redirects); invented DOIs get force-rejected.
- **Closed auth**: login/password with JWT in httpOnly cookies, bcrypt (cost 12), session revocation via `tokenVersion`, no public registration, per-IP rate limits on the API.

## Tech stack

| Layer | Technologies |
|---|---|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS 4, Radix UI, TanStack Query, tRPC client, wouter |
| Backend | Node.js 20, Hono, tRPC 11 (typed API), jose (JWT), bcryptjs |
| Database | PostgreSQL 16 (Docker), Drizzle ORM, migrations in `app/db/migrations` |
| LLM | Opencode Zen API (OpenAI-compatible), `deepseek-v4-flash-free`, race-safe key pool (`app/api/ai/zenClient.ts`) |
| Media pipeline | yt-dlp, ffmpeg, Whisper API (Groq / OpenAI-compatible) |
| Notifications | Telegram Bot API (morning digest) |
| Ops | Ubuntu 24.04, PM2, cron, nginx, Docker |
| Quality | Vitest (82 tests), `tsc -b`, ESLint, Prettier |

## Quick start (local)

```bash
cp .env.example .env   # fill in the required values
docker compose -p scienceagent up --build -d
docker compose -p scienceagent exec app npm run db:migrate
docker compose -p scienceagent exec app npm run db:seed
```

The web app (Hono + tRPC + Vite static build) runs under PM2 in production (`news-agent-web`), the pipeline under `hermes-ralph-loop`.

## Configuration

Environment variables are documented in `.env.example` and read from `.env` (never committed). Key names include: `DATABASE_URL`, `SESSION_SECRET`/`APP_SECRET`, Zen API keys for the key pool, `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_IDS` (digest recipients), `GROQ_API_KEY`/`WHISPER_API_BASE` (Whisper fallback), `YOUTUBE_CHANNELS`, `LINEAR_WORKER_INTERVAL_MS` (loop interval), `HERMES_DAILY_CAP` (0 = unlimited by default).

## Limitations

- `science.org` / `nature.com` block datacenter IPs (403) — link validation relies on the doi.org resolver.
- Reddit occasionally returns 429s (handled as transient).
- YouTube RSS can 404 for individual channels — covered by the yt-dlp fallback.
- Shorts without subtitles are rejected unless a Whisper API key is configured.

## Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — full technical passport of the system (pipeline, scoring, security, deployment).
- [`AGENTS.md`](AGENTS.md) — repository workflow for AI development agents.
- `docs/` — deployment, admin and user guides; technical audit report.

---

# AI Tools Finder Agent

**Автономный ИИ-новостной агент**: непрерывно собирает новости об ИИ-инструментах и научных открытиях, оценивает их детерминированным скорингом, суммаризирует через LLM на русском языке и публикует в закрытом веб-дашборде с утренним Telegram-дайджестом.

> **Статус проекта: prototype.** Рабочая закрытая система (доступ по паролю, публичной регистрации нет), которая эксплуатировалась и дорабатывалась несколько месяцев. Это не публичный продукт — сервис рассчитан на приватную аудиторию.

## Обзор

Агент работает полностью автономно, в режиме 24/7: собирает новости из текстовых источников (RSS-блоги, GitHub trending, HackerNews, Reddit, arXiv, ведущие научные журналы) **и** курируемых YouTube-каналов (включая Shorts), оценивает каждый материал детерминированным скорингом, одним вызовом LLM формирует русский заголовок и саммари, после чего публикует результат в защищённый веб-дашборд. Каждое утро администратор получает Telegram-дайджест публикаций за последние 24 часа.

## Проблема

Следить за ИИ-новостями одновременно в блогах, GitHub, HackerNews, Reddit, YouTube и научных журналах — отдельная работа, и большая часть потока — шум. Обычные агрегаторы не отличают «стоит прочитать» от «можно пропустить», не суммаризируют на русском и не проверяют ссылки.

## Решение

Строго последовательный конвейер без fan-out, где каждый этап — небольшой тестируемый скрипт в `app/scripts/hermes/`:

```
сбор (текст + YouTube) → оценка (детерминированный скоринг) → манифест → fetch → save-summary → deploy-ready
```

- **collect-dual.ts** — текстовый поток (RSS/GitHub/HackerNews/Reddit/arXiv/журналы) + видео-поток (курируемые YouTube-каналы, yt-dlp), с 72-часовым Time Guard и семантической дедупликацией.
- **evaluate-news.ts** — полностью детерминированный скоринг (авторитетность источника + AI-релевантность + свежесть + формат видео). Гейт: `score > 65`; дневной лимит по умолчанию отключён.
- **manifest-gen.ts → fetch-article.ts → save-summary.ts** — обогащение. **Один** вызов Zen LLM на статью даёт русский заголовок + саммари (one-shot, без отдельного шага перевода). Для видео без субтитров аудио транскрибируется через Whisper-fallback (Groq `whisper-large-v3-turbo`).
- **deploy-ready.ts** — помечает статью готовой к публикации в дашборде.
- **daily-digest.ts** (cron, 09:00 МСК) — утренний Telegram-дайджест с секциями 🎬 YouTube / 🛠 IT-инструменты / 🔬 Наука.
- **check-urls.ts** — «сборка мусора»: отсев галлюцинированных ссылок через doi.org-резолвер (см. Ограничения).

Оркестратор — `app/scripts/hermes/ralph-loop.sh` (PM2 `hermes-ralph-loop`), цикл запускается каждые ~10 минут; сбой одного шага логируется и не останавливает цикл.

## Инженерия безопасности и анти-галлюцинаций

- **Целостность URL**: `originalUrl` не модифицируется после сбора, LLM никогда не генерирует ссылки (запрет на уровне промпта и архитектуры), в БД — `CHECK`-констрейнт + unique index на `http(s)` URL.
- **Защита от Prompt Injection**: тело статьи оборачивается в маркеры `--- BEGIN ARTICLE (UNTRUSTED) ---`; транскрипты считаются недоверенными данными.
- **SSRF-гард**: каждый внешний URL перед запросом проверяется на приватные/loopback/link-local диапазоны.
- **Проверка «мёртвых» ссылок**: издатели за Cloudflare возвращают 403 даже для валидных статей, поэтому ссылки проверяются через doi.org-резолвер (HEAD с manual redirect); выдуманные DOI отклоняются принудительно.
- **Закрытая авторизация**: логин/пароль, JWT в httpOnly-куках, bcrypt (cost 12), отзыв сессий через `tokenVersion`, публичной регистрации нет, на API — rate limit по IP.

## Технологический стек

| Слой | Технологии |
|---|---|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS 4, Radix UI, TanStack Query, tRPC client, wouter |
| Backend | Node.js 20, Hono, tRPC 11 (типизированный API), jose (JWT), bcryptjs |
| База данных | PostgreSQL 16 (Docker), Drizzle ORM, миграции в `app/db/migrations` |
| LLM | Opencode Zen API (OpenAI-compatible), `deepseek-v4-flash-free`, race-safe пул ключей (`app/api/ai/zenClient.ts`) |
| Медиа-конвейер | yt-dlp, ffmpeg, Whisper API (Groq / OpenAI-compatible) |
| Уведомления | Telegram Bot API (утренний дайджест) |
| Эксплуатация | Ubuntu 24.04, PM2, cron, nginx, Docker |
| Качество | Vitest (82 теста), `tsc -b`, ESLint, Prettier |

## Быстрый старт (локально)

```bash
cp .env.example .env   # заполните необходимые значения
docker compose -p scienceagent up --build -d
docker compose -p scienceagent exec app npm run db:migrate
docker compose -p scienceagent exec app npm run db:seed
```

В production веб-приложение (Hono + tRPC + статика Vite) работает под PM2 (`news-agent-web`), конвейер — под `hermes-ralph-loop`.

## Конфигурация

Переменные окружения описаны в `.env.example` и читаются из `.env` (в git не коммитятся). Ключевые имена: `DATABASE_URL`, `SESSION_SECRET`/`APP_SECRET`, ключи Zen для пула, `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_IDS` (получатели дайджеста), `GROQ_API_KEY`/`WHISPER_API_BASE` (Whisper-fallback), `YOUTUBE_CHANNELS`, `LINEAR_WORKER_INTERVAL_MS` (интервал цикла), `HERMES_DAILY_CAP` (0 = безлимит по умолчанию).

## Ограничения

- `science.org` / `nature.com` блокируют IP дата-центров (403) — проверка ссылок опирается на doi.org-резолвер.
- Reddit периодически отдаёт 429 (обрабатываются как временные).
- YouTube RSS иногда 404 для отдельных каналов — покрыто yt-dlp fallback.
- Shorts без субтитров отклоняются, пока не настроен Whisper API-ключ.

## Документация

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — полный технический паспорт системы (конвейер, скоринг, безопасность, развёртывание).
- [`AGENTS.md`](AGENTS.md) — workflow репозитория для AI-агентов разработки.
- `docs/` — руководства по развёртыванию, администрированию и использованию; отчёт о техническом аудите.
