1|# 01 — Восстановить daily-digest.ts из git и устранить Telegram 400
2|
3|Status: ready-for-agent
4|
5|## Проблема
6|
7|- Серверный `<PROD_APP_PATH>/scripts/hermes/daily-digest.ts` был
8|  отредактирован руками (вырезаны backticks из `(@url:\`...\`)`, обломан блок
9|  `okCount`: `let okCount = 0;` на строке 246 пропал) -> `ReferenceError:
10|  okCount is not defined` при запуске; файл расходится с origin/main.
11|- 09:00 МСК запуск падал с Telegram 400 «can't parse entities starting at
12|  byte offset 2512». Backticks в URL — НЕ причина (08:00 тест с backticks
13|  доставился; sample пользователя содержит backticks). Причина —
14|  несбалансированная Markdown-сущность в реальных данных (title/summary).
15|
16|## Что сделать
17|
18|1. Восстановить `<PROD_APP_PATH>/scripts/hermes/daily-digest.ts`
19|   дословно из origin/main (`7b31b25`) — вернуть backticks и okCount.
20|2. Диагностировать 400: прогнать `buildDigest` на реальных данных из БД,
21|   найти несбалансированные `*`, `_`, `, `[`, `]` в title/summary/source,
22|   которые esc() не покрывает.
23|3. Исправить esc()/форматирование так, чтобы сущности были сбалансированы
24|   для любого контента; добавить юнит-тест на найденный кейс.
25|4. Прогнать локально `cd app && npx tsc -b && npx vitest run` — зелёные.
26|5. Закоммитить и запушить.
27|
28|## Приёмка
29|
30|- git status чистый после пуша; серверный файл == origin/main (diff пуст).
31|- Дайджест в STUB-режиме (без TELEGRAM_BOT_TOKEN) печатается без ошибок.
32|- Реальные данные из БД не дают 400 в тесте на баланс сущностей.