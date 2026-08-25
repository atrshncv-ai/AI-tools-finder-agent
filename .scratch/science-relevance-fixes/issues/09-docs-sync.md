# Тикет 09: Синхронизация документации с кодом

Status: done
Blocked by: 01-unified-score-gate.md, 05-science-scoring-floor.md, 06-digest-heartbeat.md

## Что сделать (по правилу AGENTS.md «держать SKILL.md синхронно»)

- `app/skills/news-processor/SKILL.md`: гейт ≥50 + обязательный ИИ-гейт;
  daily-cap по умолчанию 0 (∞); Reddit отключён; manifest использует ту же
  константу; пустой выпуск дайджеста; научная ветка скоринга (+20 за ИИ-сигнал,
  tier2: arxiv*, naked-science).
- `ARCHITECTURE.md`: §3/§6/§8 — те же числа и правила.
- `AGENTS.md`: строка pipeline «gate >65» → актуальная формулировка.

## Acceptance criteria

- Ни один документ не противоречит константам кода; grep по «65» в трёх
  документах не даёт ложных утверждений о гейте.
