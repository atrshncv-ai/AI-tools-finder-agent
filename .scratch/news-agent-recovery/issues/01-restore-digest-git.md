# 01 — Восстановить daily-digest.ts из git и устранить Telegram 400

Status: ready-for-agent

## Проблема

- Серверный `/var/www/news-agent/app/scripts/hermes/daily-digest.ts` был
  отредактирован руками (вырезаны backticks из `(@url:\`...\`)`, обломан блок
  `okCount`: `let okCount = 0;` на строке 246 пропал) -> `ReferenceError:
  okCount is not defined` при запуске; файл расходится с origin/main.
- 09:00 МСК запуск падал с Telegram 400 «can't parse entities starting at
  byte offset 2512». Backticks в URL — НЕ причина (08:00 тест с backticks
  доставился; sample пользователя содержит backticks). Причина —
  несбалансированная Markdown-сущность в реальных данных (title/summary).

## Что сделать

1. Восстановить `/var/www/news-agent/app/scripts/hermes/daily-digest.ts`
   дословно из origin/main (`7b31b25`) — вернуть backticks и okCount.
2. Диагностировать 400: прогнать `buildDigest` на реальных данных из БД,
   найти несбалансированные `*`, `_`, `, `[`, `]` в title/summary/source,
   которые esc() не покрывает.
3. Исправить esc()/форматирование так, чтобы сущности были сбалансированы
   для любого контента; добавить юнит-тест на найденный кейс.
4. Прогнать локально `cd app && npx tsc -b && npx vitest run` — зелёные.
5. Закоммитить и запушить.

## Приёмка

- git status чистый после пуша; серверный файл == origin/main (diff пуст).
- Дайджест в STUB-режиме (без TELEGRAM_BOT_TOKEN) печатается без ошибок.
- Реальные данные из БД не дают 400 в тесте на баланс сущностей.