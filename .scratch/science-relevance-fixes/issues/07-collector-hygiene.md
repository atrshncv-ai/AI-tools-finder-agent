# Тикет 07: Гигиена сборщика — fail-closed даты, явные коды выхода

Status: done
Blocked by: —

## Что сделать

- `collect-dual.ts` `fromRssItem`: RSS-запись без `isoDate` → candidate не
  создаётся (fail-closed, как задокументировано), а не подмену `new Date()`.
- `fetch-article.ts`: при срабатывании SSRF-гарда — сообщение в stderr и
  `process.exit(1)` вместо тихого `return null` (exit 0).

## Acceptance criteria

- Кандидат без даты физически не доходит до БД; в логе виден отказ.
- SSRF-блок завершает процесс ненулевым кодом.
