# AGENTS.md — Instructions for AI development agents

## Repository workflow (MANDATORY)

Any future change made by an AI development agent — architecture, scripts,
configuration, documentation — MUST end with:

1. A **meaningful commit** (conventional commits: `feat:`, `fix:`, `refactor:`,
   `docs:` …) describing WHAT changed and WHY.
2. A **push to the remote repository**:

   ```bash
   git push origin main
   ```

No task is considered done until the code is committed and pushed.

## Hard rules

- **Never commit secrets**: `.env`, API keys, tokens, passwords, SSH helpers.
  `.gitignore` must cover them — verify before every push.
- **Never commit** `node_modules/`, `dist/`, logs, local databases, `tmp/`.
- Keep changes minimal and focused; do not refactor unrelated code.
- The production pipeline logic lives in `app/scripts/hermes/` and
  `app/skills/news-processor/SKILL.md` — keep SKILL.md in sync with the code.
- Quality gates before committing: `cd app && npx tsc -b` and `npx vitest run`.

## Project context

ИИ-новостной агент: autonomous news curation pipeline (Hermes Ralph Loop).
Stack: React/Vite frontend, Hono + tRPC backend, Drizzle ORM + PostgreSQL,
Opencode Zen API (OpenAI-compatible) via key-pool client `app/api/ai/zenClient.ts`.

Pipeline: `collect-dual.ts` (text + YouTube via yt-dlp, 72h Time Guard +
Semantic Dedup) → `evaluate-news.ts` (hard AI-relevance gate + data-driven
scoring, gate >=50 via `pipeline-config.ts`, no daily cap by default) →
`manifest-gen.ts` → `fetch-article.ts` →
`save-summary.ts` (ONE Zen call, RU title + summary) → `deploy-ready.ts`.
Strictly sequential, no translation step, no fan-out. Morning Telegram
digest via cron (`daily-digest.ts`). Full reference: `ARCHITECTURE.md`.

<!-- autopilot:start -->
# Научный агент

Автономный ИИ-новостной агент с последовательным конвейером сбора, оценки, суммаризации и дайджеста.

## Команды

| Команда | Что делает |
|---------|------------|
| `cd app && npm ci` | Установить зависимости приложения |
| `cd app && npx tsc -b` | Проверить типы |
| `cd app && npx vitest run` | Запустить тесты |
| `node ecosystem.config.cjs` | Проверить конфигурацию PM2 (после установки зависимостей) |

## Как здесь работает Autopilot

Сборка и диагностика ведутся навыком `/autopilot`. Требования, спецификация и тикеты находятся в `.autopilot/`.
Прогресс — `.autopilot/dashboard.html`. Требование из `manifest.md` может снять только пользователь.

Если работа продолжается — скажи «продолжи автопилот»: состояние поднимется из `.autopilot/state.js`, переспрашивать ничего не нужно.

## Проверенные факты

- Источники поведения и тестов: `app/api/ai/zenClient.ts`, `app/api/ai/goModels.test.ts`, `app/scripts/hermes/save-summary.ts`, `app/skills/news-processor/SKILL.md`.
- Go-first: непустой `ZEN_GO_API_KEYS` или `ZEN_GO_API_KEY` переключает chat completions на Go endpoint/model и обходит legacy `ZEN_API_KEYS`/`ZEN_API_KEY`. Go требует активной подписки; HTTP 403 с сообщением `active OpenCode Go subscription is required` — ошибка account/config, не quota и не повод переводить ключ в cooldown или делать legacy fallback.
- Redaction gotcha: upstream error body может содержать credential. Безопасная диагностика не возвращает сырые response body/headers; `getZenConnectionStatus()` сообщает только фиксированный класс ошибки.
<!-- autopilot:end -->
