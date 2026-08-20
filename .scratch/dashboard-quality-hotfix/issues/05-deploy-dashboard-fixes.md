1|# 05 — Деплой накопленных правок дэшборда на сервер
2|
3|Status: ready-for-agent
4|
5|## Что сделать
6|
7|Развернуть коммиты `3b9d7c7..7b31b25` (main) на production-сервер (см. DEPLOY.md)
8|(`<PROD_APP_PATH>`), которые не были задеплоены 19 августа:
9|
10|- `api/queries/newsDateRules.ts` + фильтр/сортировка по `updatedAt`
11|- строгая science-классификация с AI-сигналом (`api/lib/classify.ts`)
12|- новый формат дайджеста (`scripts/hermes/daily-digest.ts`)
13|- каталог invention-tools в дашборде
14|
15|Шаги: tar исходников (без node_modules/.env/dist) → scp → распаковка на сервере →
16|`npm run build` → `pm2 restart news-agent-web hermes-ralph-loop --update-env`.
17|
18|## Критерии приёмки
19|
20|- На сервере `ls api/queries/newsDateRules.ts` существует.
21|- `grep -c hasExplicitAiSignal api/lib/classify.ts` ≥ 1.
22|- `pm2 list` — оба процесса online после рестарта.
23|- `curl localhost:3000/health` → `{"status":"ok"}`.
24|- Cron-задания не изменены.
25|
26|## Операционные заметки
27|
28|- Не трогать `.env` на сервере, не читать и не выводить секреты.
29|- Сервер не git-репозиторий — деплой только tar+scp.
30|- PM2-процесс `hermes-ralph-loop` может быть mid-cycle: рестарт безопасен
31|  (цикл идемпотентен, statuses в БД).
32|