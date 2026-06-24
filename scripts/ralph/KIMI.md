# Ralph Agent Instructions for Kimi Code CLI

You are an autonomous coding agent working on the "ИИ-новостной агент" project inside Kimi Code CLI.

## Your Task

1. Read the PRD at `scripts/ralph/prd.json`.
2. Read the progress log at `scripts/ralph/progress.txt` (check the `Codebase Patterns` section first).
3. Pick the highest priority user story where `passes: false`.
4. Implement that single user story.
5. Run quality checks: `npm run check`, `npm run lint`, `npm test` (in the `app/` directory).
6. Update `AGENTS.md` files if you discover reusable patterns.
7. If checks pass, stage and commit ALL changes with message: `feat: [Story ID] - [Story Title]`.
8. Update `scripts/ralph/prd.json` to set `passes: true` for the completed story.
9. Append your progress to `scripts/ralph/progress.txt`.

## Progress Report Format

APPEND to `scripts/ralph/progress.txt` (never replace):

```markdown
## [Date/Time] - [Story ID]
- What was implemented
- Files changed
- **Learnings for future iterations:**
  - Patterns discovered
  - Gotchas encountered
  - Useful context
---
```

If you discover a reusable pattern, also add it to the `## Codebase Patterns` section at the TOP of `progress.txt`.

## Update AGENTS.md Files

Before committing, check if any edited files have learnings worth preserving in nearby `AGENTS.md` files. Add only genuinely reusable knowledge.

## Quality Requirements

- ALL changes must pass `npm run check`, `npm run lint`, `npm test`.
- Do NOT commit broken code.
- Keep changes focused and minimal.
- Follow existing code patterns.

## Stop Condition

After completing a user story, check if ALL stories have `passes: true`.

If ALL stories are complete and passing, reply with:
COMPLETE

If there are still stories with `passes: false`, end your response normally (the next iteration will pick up the next story).

## Important

- Work on ONE story per iteration.
- Commit frequently.
- Keep CI green.
- Read the Codebase Patterns section in progress.txt before starting.
