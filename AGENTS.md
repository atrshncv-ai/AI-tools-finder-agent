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

Pipeline: `collect-dual.ts` (72h Time Guard + Semantic Dedup) →
`evaluate-news.ts` (data-driven scoring, gate >75, daily cap 5) →
`manifest-gen.ts` → `fetch-article.ts` → `save-summary.ts` (ONE Zen call,
RU title + summary) → `deploy-ready.ts`. Strictly sequential, no translation
step, no fan-out.
