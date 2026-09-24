window.STATE =
{
  "slug": "diagnose-pipeline",
  "dir": "2026-09-24-diagnose-pipeline--wip",
  "title": "Диагностика и исправление конвейера научного агента",
  "mode": "semi",
  "depth": "normal",
  "polish": null,
  "tier": null,
  "briefFile": "2026-09-24-diagnose-pipeline--wip/2026-09-24-brief.md",
  "memoryFile": "AGENTS.md",
  "skillDir": "/Users/aleksandrtrisenkov/.claude/skills/autopilot",
  "startedAt": "2026-09-24T10:16:00+04:00",
  "updatedAt": "2026-09-24T11:18:25+04:00",
  "finishedAt": null,
  "stages": [
    { "id": "preflight", "status": "done", "finishedAt": "2026-09-24T10:21:11+04:00" },
    { "id": "manifest", "status": "done", "finishedAt": "2026-09-24T10:21:37+04:00" },
    { "id": "briefing", "status": "skipped", "note": "вопросов не потребовалось: задача и ограничения определены" },
    { "id": "spec", "status": "done", "finishedAt": "2026-09-24T10:42:58+04:00" },
    { "id": "plan", "status": "done", "finishedAt": "2026-09-24T10:44:28+04:00", "note": "2 таска, 2 волны" },
    { "id": "build", "status": "active", "startedAt": "2026-09-24T10:44:28+04:00", "note": "2 из 2 тасков готов; ожидается финальная приёмка" },
    { "id": "review", "status": "done", "startedAt": "2026-09-24T11:08:53+04:00", "finishedAt": "2026-09-24T11:18:25+04:00", "note": "проверены 2 из 2" },
    { "id": "final", "status": "pending" }
  ],
  "requirements": {
    "total": 13, "done": 8, "inTicket": 4, "inSpec": 0,
    "placeholder": 1, "deferred": 0, "dropped": 0
  },
  "tickets": [
    {
      "id": "01",
      "title": "Read-only диагностика production-инцидента",
      "requirements": ["R01", "R01.1", "R02", "R03", "R04", "R04.1", "R05", "R06", "R09", "R09.1", "R10", "R11", "R12"],
      "blockedBy": [],
      "wave": 1,
      "zone": ["remote-diagnosis", "production-logs"],
      "status": "done",
      "startedAt": "2026-09-24T10:44:28+04:00",
      "finishedAt": "2026-09-24T11:08:53+04:00",
      "retries": 0,
      "repairs": 1,
      "repairFindings": ["evidence.md:13-17 — нет конкретных hostname/time/deployment marker/cron", "evidence.md:11-29 — неполное покрытие журналов и URL-идентификаторов", "evidence.md:36 — не доказана связь Zen с потерей 92 кандидатов"],
      "handoffs": 0,
      "tests": { "passed": 219, "failed": 0 },
      "files": [".autopilot/2026-09-24-diagnose-pipeline--wip/evidence.md"],
      "commit": "37579f7"
    },
    {
      "id": "02",
      "title": "Минимальное локальное исправление и проверки",
      "requirements": ["R07", "R07.1", "R08", "R08.1", "R10", "R11", "R12", "R13"],
      "blockedBy": ["01"],
      "wave": 2,
      "zone": ["app/scripts/hermes/", "app/skills/news-processor/"],
      "status": "review",
      "startedAt": "2026-09-24T11:12:10+04:00",
      "finishedAt": "2026-09-24T11:16:20+04:00",
      "retries": 0,
      "repairs": 0,
      "handoffs": 0,
      "files": ["app/api/ai/zenClient.ts", "app/api/ai/goModels.test.ts", "app/scripts/hermes/save-summary.ts", "app/skills/news-processor/SKILL.md"],
      "tests": { "passed": 221, "failed": 0 }
    }
  ],
  "singlePass": null,
  "tests": { "passed": 219, "failed": 0 },
  "debt": {
    "placeholders": ["R06 — provider-level Zen limit/credential attribution"],
    "assumptions": [],
    "emptyEnv": ["SSH_PASSWORD"]
  },
  "additions": [],
  "coverage": {
    "found": 18,
    "fixed": 18,
    "deferred": 0,
    "note": "G2: независимая проверка выявила частичное покрытие и лишние детали; спецификация уточнена"
  },
  "concerns": [
    "T01: точный Zen provider response не доказан; подтверждены zen/unavailable и pool-exhaustion/quota rotation",
    "T01: science HTTP 403; lancet DNS/URL error — источники требуют отдельного endpoint/config решения",
    "PM2 env-метаданные содержат секреты; значения не записывались, но credentials следует ротировать"
  ],
  "reviewers": { "manifestSpec": "t02-manifest-spec", "craft": "t02-craft" },
  "blind": null
}
