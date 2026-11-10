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

Закрытый дашборд и ежедневный Telegram-выпуск ИИ-новостей для одного заказчика; один выпуск в UTC-сутки.

## Команды

- `cd app && npm ci` — зависимости.
- `cd app && npx tsc -b` — типы.
- `cd app && npx vitest run` — все тесты.
- `cd app && npx tsc -b && npx vitest run` — полная проверка перед сдачей.
- `cd app && npx vitest run scripts/hermes/judge.test.ts` — один тестовый файл.
- `cd app && bash scripts/hermes/ralph-loop.sh` — конвейер-демон, один цикл в UTC-сутки.
- `cd app && npx tsx scripts/hermes/publish-budget.ts --status` — read-only состояние дня и бюджет.
- `cd app && npm run build` — веб-сборка и `dist/boot.js`.
- `npx tsx scripts/check-env-example.ts` и `npx tsx scripts/check-docs.ts` — сверка кода с env-примером и документов с кодом.

## Где что

- `app/scripts/hermes/ralph-loop.sh` — оркестратор: порядок шагов и ожидание следующей UTC-даты.
- `app/scripts/hermes/evaluate-news.ts` — префильтр → судья → бюджет → скачивание → балл.
- `app/scripts/hermes/topics.ts` — единственное описание разделов и направлений.
- `app/scripts/hermes/judge.ts` — LLM-судья, fail-closed, промпт берёт из `topics.ts`.
- `app/scripts/hermes/publish-budget.ts` и `deploy-ready.ts` — бюджет дня и единственная публикация.
- `app/api/ai/providers/` — GigaChat, OpenCode-адаптер, цепочка, классы ошибок.
- `app/scripts/hermes/digest-format.ts` и `daily-digest.ts` — формат и отправка дайджеста.

## Подводные камни

- Лид сохраняется при сборе: RSS-описание пишется в `news.summary` (`buildNewsRow` в `collect-dual.ts`), иначе судья судит по одному заголовку.
- Бюджет дня проверяется и на публикации (`planPublication` в `deploy-ready.ts`): прямой вызов сверх `DAILY_BUDGET` отказывает, а не публикует молча.
- Ошибка провайдера — не отказ по теме: `evaluate-news` пишет `provider-error` и оставляет кандидата `pending`, `judge.ts` пробрасывает `ProviderError`.
- Ключ меняется `scripts/update-key.sh` (значение только из stdin) и подхватывается без рестарта: `providers/env.ts` читает `.env` на каждый вызов, файл важнее `process.env`.
- GigaChat: без `scripts/deploy/gigachat-certs.sh` и `NODE_EXTRA_CA_CERTS` TLS падает до авторизации.
- `zenClient` разбирает пул ключей при импорте (`parseKeyPool`), поэтому долгоживущий процесс держит старый пул; в конвейере каждый шаг — отдельный `npx tsx`.

## Окружение

- `DATABASE_URL` — PostgreSQL для дашборда и состояния цикла.
- `JWT_SECRET` (`APP_SECRET` — legacy фолбэк) — подпись сессионного JWT.
- `TELEGRAM_BOT_TOKEN` — отправка дайджеста.
- `TELEGRAM_CLIENT_CHAT_IDS` — получатели клиентского выпуска.
- `TELEGRAM_OWNER_CHAT_IDS` — владелец: копия и служебный отчёт.
- `DIGEST_DASHBOARD_URL` — ссылка на дашборд в футере.
- `GIGACHAT_CLIENT_ID` и `GIGACHAT_CLIENT_SECRET` — OAuth основной модели.
- `GIGACHAT_SCOPE` — scope токена, по умолчанию `GIGACHAT_API_PERS`.
- `GIGACHAT_MODEL` — модель GigaChat.
- `ZEN_GO_API_KEYS` — пул ключей OpenCode Go, платный фолбэк.
- `DAILY_BUDGET` — 5..10, по умолчанию 8; вне диапазона — ошибка старта.
- `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` — офсайт-бэкап.

## Как здесь работает Autopilot

Сборка и диагностика ведутся навыком `/autopilot`. Требования, спецификация и тикеты находятся в `.autopilot/`.
Прогресс — `.autopilot/dashboard.html`. Требование из `manifest.md` может снять только пользователь.

Если работа продолжается — скажи «продолжи автопилот»: состояние поднимется из `.autopilot/state.js`, переспрашивать ничего не нужно.

Решения — `docs/adr/`, словарь терминов — `CONTEXT.md`.
<!-- autopilot:end -->
