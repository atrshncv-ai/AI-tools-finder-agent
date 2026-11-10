window.STATE =
{
  "slug": "zen-model-recovery",
  "dir": "2026-09-24-zen-model-recovery",
  "title": "Восстановление доступности Go-модели",
  "mode": "semi",
  "depth": "normal",
  "polish": null,
  "tier": "T1",
  "briefFile": "2026-09-24-zen-model-recovery/2026-09-24-brief.md",
  "memoryFile": "AGENTS.md",
  "skillDir": "/Users/aleksandrtrisenkov/.config/opencode/skills/autopilot",
  "startedAt": "2026-09-24T13:24:09+04:00",
  "updatedAt": "2026-09-24T13:52:20+04:00",
  "finishedAt": "2026-09-24T13:52:20+04:00",
  "stages": [
    { "id": "preflight", "status": "done", "finishedAt": "2026-09-24T13:26:00+04:00" },
    { "id": "manifest", "status": "done", "finishedAt": "2026-09-24T13:28:00+04:00" },
    { "id": "briefing", "status": "skipped", "note": "вопросов не потребовалось: продолжение диагностики и read-only проверка определены" },
    { "id": "spec", "status": "done", "finishedAt": "2026-09-24T13:34:00+04:00" },
    { "id": "plan", "status": "done", "finishedAt": "2026-09-24T13:38:00+04:00", "note": "T0 по объёму работ: один диагностический таск" },
    { "id": "build", "status": "failed", "startedAt": "2026-09-24T13:38:00+04:00", "finishedAt": "2026-09-24T13:48:00+04:00", "note": "T01: два read-only SSH-повтора завершились BLOCKED — фактический TypeScript production runtime недоступен" },
    { "id": "review", "status": "skipped", "note": "код не менялся; review не требовался" },
    { "id": "final", "status": "done", "startedAt": "2026-09-24T13:48:00+04:00", "finishedAt": "2026-09-24T13:52:20+04:00" }
  ],
  "requirements": { "total": 4, "done": 3, "inTicket": 0, "inSpec": 0, "placeholder": 1, "deferred": 0, "dropped": 0 },
  "tickets": [
    { "id": "01", "title": "Диагностика доступности выбранной Go-модели", "requirements": ["G01", "R01", "R02", "R03"], "blockedBy": [], "wave": 1, "zone": ["remote-model-diagnosis", "pipeline-config"], "status": "failed", "startedAt": "2026-09-24T13:28:00+04:00", "finishedAt": "2026-09-24T13:48:00+04:00", "retries": 2, "repairs": 0, "handoffs": 0, "tests": { "passed": 221, "failed": 0 }, "commit": "877ce6a", "concerns": ["T01: фактический TypeScript production runtime не найден; model availability remains unproven"] }
  ],
  "singlePass": null,
  "tests": { "passed": 221, "failed": 0 },
  "debt": { "placeholders": ["G01 — строгий read-only SSH-доступ к фактическому TypeScript production runtime"], "assumptions": [], "emptyEnv": [] },
  "additions": [],
  "coverage": {
    "found": 1,
    "fixed": 1,
    "deferred": 0,
    "note": "G2: независимая проверка указала, что краткий brief требует явного контекста продолжения; контекст добавлен в spec без изменения пользовательских слов"
  },
  "concerns": [
    "T01: фактический TypeScript production runtime не найден через доступные строгие SSH-пути",
    "T01: каталог Go содержит mimo-v2.5 и mimo-v2.6-flash, но completion availability не доказана",
    "T01: non-2xx error-body propagation concern в локальном zenClient требует отдельного narrowly scoped review; код не менялся"
  ],
  "reviewers": { "manifestSpec": null, "craft": null },
  "blind": {
    "verdict": "partial",
    "agreements": ["local Go implementation", "quality gates", "production not changed"],
    "drift": ["G01 — brief says only «продолжи работу», поэтому completion of the continuation cannot be objectively accepted from the brief alone"],
    "resolution": "the missing production completion proof is recorded as placeholder G01 and a concrete trusted read-only SSH next action; no model or provider was changed"
  }
}
