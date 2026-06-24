# PRD: Приведение проекта в соответствие с Техническим Заданием

## Introduction

Проект «ИИ-новостной агент для научного журнала» уже имеет работающий MVP: парсинг, суммаризация, перевод, публикация, веб-интерфейс, авторизация. Однако в ходе аудита текущего состояния по отношению к ТЗ выявлен ряд расхождений — от неверной конфигурации ИИ-модели до инфраструктурных проблем деплоя.

Этот PRD описывает работу по устранению критических расхождений и доведению проекта до состояния, полностью соответствующего ТЗ.

## Goals

- Использовать в качестве ИИ-модели Google Gemma 4 12B QAT через LM Studio, как указано в ТЗ.
- Обеспечить полный перевод статей через LM Studio, а не внешний Bing-переводчик.
- Привести расписание парсинга к ТЗ: ежедневный дайджест в 06:00, научные инструменты в 07:00, дополнительный парсинг каждые 4 часа.
- Исправить ошибки, приводящие к потере качества контента (усечение саммари, отсутствие даты в HTML, наивное определение языка).
- Устранить проблемы безопасности аутентификации (CSRF-state, срок жизни JWT).
- Исправить инфраструктурные баги деплоя (nginx placeholder, env vars, Docker Compose).
- Добавить недостающие тесты и дедупликацию.

## User Stories

### US-001: Настроить модель суммаризации на Gemma 4 12B QAT
**Description:** As a developer, I want the AI module to use the model specified in the TZ so that summarization quality matches requirements.

**Acceptance Criteria:**
- [ ] Default model in `app/api/ai/client.ts` and `.env.example` changed to `gemma-4-e4b` (or exact model ID from LM Studio).
- [ ] `docs/DEPLOY.md` updated to mention Gemma 4 12B QAT instead of glm-4.6v-flash.
- [ ] Typecheck passes.

### US-002: Исправить усечение подробного саммари
**Description:** As a user, I want the detailed article summary to contain 10-15 sentences as required, not just the first paragraph.

**Acceptance Criteria:**
- [ ] Remove or make optional `extractFirstParagraph` for detailed summaries in `app/api/ai/client.ts`.
- [ ] Short summary still returns concise output (3-5 sentences).
- [ ] Typecheck passes.
- [ ] Tests pass (if existing tests cover summarization).

### US-003: Переводить статьи через LM Studio вместо Bing
**Description:** As a developer, I want batch translation to use the configured local LLM so that translation quality and privacy match the TZ.

**Acceptance Criteria:**
- [ ] `app/api/agent/translateAgent.ts` uses `translateArticle()` from `app/api/ai/client.ts` instead of `translators` Python subprocess.
- [ ] Remove or deprecate `translateViaBing()` and `translateTitleViaBing()`.
- [ ] Token and concurrency limits from env vars are respected.
- [ ] Typecheck passes.

### US-004: Реализовать расписание парсинга по ТЗ
**Description:** As an admin, I want parsing to run at 06:00 daily, science tools at 07:00, and additional parsing every 4 hours.

**Acceptance Criteria:**
- [ ] `app/api/scheduler/index.ts` registers three separate cron jobs: `0 6 * * *`, `0 7 * * *`, `0 */4 * * *`.
- [ ] 06:00 and every-4h jobs run the full pipeline (parse + summarize + translate + deploy).
- [ ] 07:00 job runs parsing and processing only for science sources (`isScience: true`).
- [ ] Typecheck passes.

### US-005: Извлекать дату публикации из HTML-источников
**Description:** As a developer, I want HTML-parsed articles to have correct `publishedAt` so the feed is sorted properly.

**Acceptance Criteria:**
- [ ] `app/api/agent/parseAgent.ts` extracts `publishedAt` from common HTML meta tags (`article:published_time`, `datePublished`, etc.).
- [ ] Falls back to current date if not found.
- [ ] Typecheck passes.

### US-006: Улучшить определение языка статьи
**Description:** As a developer, I want reliable language detection for non-English/Russian articles.

**Acceptance Criteria:**
- [ ] Replace Cyrillic/Latin heuristic with `franc` or `cld3` library.
- [ ] Detect at least ru/en/de/es/zh/ja/fr.
- [ ] Add confidence threshold; fallback to "unknown".
- [ ] Typecheck passes.

### US-007: Применить maxArticles ко всем типам источников
**Description:** As a developer, I want RSS and API sources to respect the per-source article limit.

**Acceptance Criteria:**
- [ ] `fetchRssFeed()` returns at most `maxArticles` items.
- [ ] `fetchApiArticles()` returns at most `maxArticles` items.
- [ ] HTML path already respects it; verify.
- [ ] Typecheck passes.

### US-008: Добавить dedicated-логику для Google News
**Description:** As a developer, I want Google News sources to be parsed correctly, not as generic RSS.

**Acceptance Criteria:**
- [ ] Implement `fetchGoogleNews()` in `app/api/agent/parseAgent.ts`.
- [ ] Handle Google News RSS/Atom specifics and topic feeds.
- [ ] Add at least one Google News source to seeds.
- [ ] Typecheck passes.

### US-009: Защитить OAuth state от CSRF
**Description:** As a security engineer, I want OAuth `state` to be a random CSRF token validated server-side.

**Acceptance Criteria:**
- [ ] `app/api/kimi/auth.ts` generates cryptographically random `state` and stores it in httpOnly cookie or session.
- [ ] Callback validates `state` against stored value.
- [ ] Typecheck passes.
- [ ] Existing OAuth flow still works.

### US-010: Сократить срок жизни JWT и добавить инвалидацию сессий
**Description:** As a security engineer, I want sessions to expire reasonably and logout to invalidate the token server-side.

**Acceptance Criteria:**
- [ ] JWT expiry reduced to 24 hours (configurable via env).
- [ ] Server-side session blocklist or token versioning implemented (e.g., `sessions` table or Redis blocklist).
- [ ] Logout invalidates the token.
- [ ] Typecheck passes.

### US-011: Исправить nginx placeholder для домена
**Description:** As a DevOps engineer, I want deploy.sh to correctly substitute the domain in nginx config.

**Acceptance Criteria:**
- [ ] Replace `__DOMAIN__` with `$DOMAIN` in `nginx/conf.d/default.conf` OR update `deploy.sh` to replace `__DOMAIN__` explicitly.
- [ ] `deploy.sh` still works after change.
- [ ] Nginx config syntax valid (`nginx -t`).

### US-012: Прокинуть все env-переменные в docker-compose
**Description:** As a DevOps engineer, I want the app container to receive all required environment variables.

**Acceptance Criteria:**
- [ ] `docker-compose.yml` forwards all variables used by the app (or uses `env_file: .env`).
- [ ] `CORS_ORIGIN` defaults to a safe value, not `*`.
- [ ] `LM_STUDIO_URL` configurable, not hardcoded to `host.docker.internal`.
- [ ] docker-compose config is valid (`docker compose config`).

### US-013: Добавить тесты для parseAgent
**Description:** As a developer, I want parseAgent to have unit tests for key logic.

**Acceptance Criteria:**
- [ ] Create `app/api/agent/parseAgent.test.ts`.
- [ ] Cover: `containsAiKeywords`, `detectLanguage`, `makeDecisions`, deduplication.
- [ ] Tests pass.

### US-014: Добавить семантическую дедупликацию новостей
**Description:** As a developer, I want duplicate articles with slightly different titles/URLs to be detected.

**Acceptance Criteria:**
- [ ] Implement content-based deduplication using URL normalization + title similarity (e.g., Levenshtein or embeddings fallback).
- [ ] Integrate into `runParseAgent()` before insert.
- [ ] Typecheck passes.
- [ ] Tests pass.

### US-015: Инициализировать git-репозиторий и добавить базовый CI
**Description:** As a project maintainer, I want version control and automated checks.

**Acceptance Criteria:**
- [ ] `git init` in project root.
- [ ] `.gitignore` created/updated (node_modules, dist, .env, backups).
- [ ] Initial commit with current state.
- [ ] Add GitHub Actions workflow: typecheck, lint, test on PR/push.
- [ ] Workflow file valid.

## Functional Requirements

- FR-1: AI model must match TZ: Google Gemma 4 12B QAT.
- FR-2: Translation must use the configured local LLM.
- FR-3: Parsing schedule must include 06:00, 07:00, and every 4 hours.
- FR-4: Summaries must not be truncated by post-processing.
- FR-5: HTML parsing must extract or infer `publishedAt`.
- FR-6: Language detection must support major languages reliably.
- FR-7: All source types must respect `maxArticles`.
- FR-8: Google News must have dedicated parsing logic.
- FR-9: OAuth flow must use random CSRF state.
- FR-10: Sessions must have reasonable TTL and server-side invalidation.
- FR-11: Deployment config must substitute domain correctly.
- FR-12: Docker Compose must forward all required env vars.
- FR-13: parseAgent must have automated tests.
- FR-14: Duplicate articles must be detected semantically.
- FR-15: Project must be under git with CI checks.

## Non-Goals

- No complete UI redesign.
- No new user-facing features beyond TZ compliance.
- No migration from PostgreSQL to another DB.
- No replacement of tRPC/Hono stack.
- No production deployment itself (only config fixes).

## Technical Considerations

- All changes must pass `npm run check` (TypeScript) and `npm run lint`.
- All changes must pass `npm test`.
- Prefer minimal diffs; follow existing code style.
- Update `AGENTS.md` if new reusable patterns are discovered.
- Keep LM Studio integration backward-compatible where possible.

## Success Metrics

- `npm run check && npm run lint && npm test` passes after each story.
- TZ discrepancies from the audit are resolved.
- Deployment config can be validated with `docker compose config` and `nginx -t`.
- Project is under git with green CI.

## Open Questions

- Exact model ID string for Gemma 4 12B QAT in LM Studio (may need discovery).
- Whether Redis should be added to Compose or removed from `.env.example`.
- Preferred session invalidation mechanism: DB table vs Redis blocklist.
