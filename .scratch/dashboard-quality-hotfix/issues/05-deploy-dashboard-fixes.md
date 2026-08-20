# 05 — Деплой накопленных правок дэшборда на сервер

Status: ready-for-agent

## Что сделать

Развернуть коммиты `3b9d7c7..7b31b25` (main) на production-сервер (см. DEPLOY.md)
(`/var/www/news-agent/app`), которые не были задеплоены 19 августа:

- `api/queries/newsDateRules.ts` + фильтр/сортировка по `updatedAt`
- строгая science-классификация с AI-сигналом (`api/lib/classify.ts`)
- новый формат дайджеста (`scripts/hermes/daily-digest.ts`)
- каталог invention-tools в дашборде

Шаги: tar исходников (без node_modules/.env/dist) → scp → распаковка на сервере →
`npm run build` → `pm2 restart news-agent-web hermes-ralph-loop --update-env`.

## Критерии приёмки

- На сервере `ls api/queries/newsDateRules.ts` существует.
- `grep -c hasExplicitAiSignal api/lib/classify.ts` ≥ 1.
- `pm2 list` — оба процесса online после рестарта.
- `curl localhost:3000/health` → `{"status":"ok"}`.
- Cron-задания не изменены.

## Операционные заметки

- Не трогать `.env` на сервере, не читать и не выводить секреты.
- Сервер не git-репозиторий — деплой только tar+scp.
- PM2-процесс `hermes-ralph-loop` может быть mid-cycle: рестарт безопасен
  (цикл идемпотентен, statuses в БД).
