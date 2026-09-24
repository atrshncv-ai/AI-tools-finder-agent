# Evidence — read-only диагностика production

## Проверка и baseline

Проверка выполнялась по SSH BatchMode на `root@159.194.236.68`.

hostname: ineagyvcmc.local
checked_at: 2026-09-24T07:05:03+00:00 (UTC)
deployment_marker: sha256 app/api/ai/zenClient.ts = 2c8f3ed834467efa80e823cc653ee5602a6041c0c9d2a71f13f1d797f7f0e4c9; mtime=2026-09-10T06:26:46Z; cwd=/var/www/news-agent/app; PM2 scripts=/var/www/news-agent/app/dist/boot.js и /var/www/news-agent/app/scripts/hermes/ralph-loop.sh

- Пользовательский baseline: `94/94/2/16`, feeds `25/27`, проблемные `science` и `lancet`, Zen `4/4`.
- Независимый read-only SQL-агрегат за последние 24 часа: `94 collected / 94 evaluated / 92 unpublished / 2 published`; `16` processing-failure entries; `27` feed records, `2` failing (`lancet`, `science`).

## Deployment и процессы

- Production cwd: `/var/www/news-agent/app`.
- `news-agent-web`: PM2 `online`, script `/var/www/news-agent/app/dist/boot.js`, 70 restarts, logs `/var/log/news-agent/web.out.log` и `/var/log/news-agent/web.err.log`.
- `hermes-ralph-loop`: PM2 `online`, script `/var/www/news-agent/app/scripts/hermes/ralph-loop.sh`, 43 restarts, logs `/var/log/news-agent/hermes.out.log` и `/var/log/news-agent/hermes.err.log`.
- SHA-256/mtime deployment markers:
  - `dist/boot.js`: `2d916908e6fe30b6145fa036914db0e8249593793554749f8445e9ce89fba7cf`, mtime `2026-08-26T06:16:50Z`, 7,579,124 bytes.
  - `package.json`: `3d456e295d180cd560e322a2779a516b10c9fb6580f53e224bfd88dc81035c41`, mtime `2026-08-17T16:14:40Z`, 4,120 bytes.
  - `scripts/hermes/ralph-loop.sh`: `4098aa2e0d6fae28b0015d532812888ba0dd1c3f1db8807b5de4870d9bb0c643`, mtime `2026-08-14T05:25:07Z`, 5,135 bytes.
- Git commit/build metadata в deployment checkout не обнаружены; SHA файлов и PM2 script/cwd выше — доступные markers.

## Cron

Read-only чтение root crontab и `/etc/cron.d/*` дало точные команды (содержимое env-файлов не читалось и не выводилось):

```text
50 5 * * * cd /var/www/news-agent/app && /usr/bin/python3 scripts/publish_daily_batch.py >> /var/log/news-agent/publisher.log 2>&1
0 6 * * * cd /var/www/news-agent/app && set -a && . ./.env && set +a && npx tsx scripts/hermes/daily-digest.ts >> /var/log/news-agent/daily-digest.log 2>&1
0 4 * * 1 cd /var/www/news-agent/app && set -a && . ./.env && set +a && npx tsx scripts/check-urls.ts >> /var/log/news-agent/check-urls.log 2>&1
```

Publisher — ежедневно 05:50 UTC; digest — ежедневно 06:00 UTC; check-urls — по понедельникам 04:00 UTC.

## Журналы по этапам

Проверенные файлы и mtime: `hermes.out.log` `2026-09-24T06:30:14Z`, `hermes.err.log` `2026-09-24T06:30:12Z`, `publisher.log` `2026-09-24T05:50:02Z`, `daily-digest.log` `2026-09-24T06:00:05Z`; `check-urls.log` последний mtime `2026-09-21T04:11:18Z`.

- **collect-dual:** stage time — `hermes.err.log` mtime `2026-09-24T06:30:12Z`, cycle starts `2026-09-24T00:58:48Z`, `02:04:06Z`, `03:09:30Z`, `04:14:29Z`, `05:19:50Z`, `06:25:15Z`. Безопасные completion markers: `[collect-dual] Done: 15 inserted, 88 duplicates blocked, 0 errors` и `[collect-dual] Done: 0 inserted, 90 duplicates blocked, 0 errors`; последние шесть агрегатов: inserted `15,15,1,0,0,0`, duplicates `88,88,85,88,90,82`, errors `0,0,0,0,0,0`. URL/payload не выводились.
- **evaluate-news:** stage time — `hermes.err.log` mtime `2026-09-24T06:30:12Z`. Безопасные completion markers включают `[evaluate-news] Done: 1 approved (>50), 3 rejected` и `[evaluate-news] Done: 0 approved (>50), 1 rejected`; последние шесть: approved `1,0,1,8,3,0`, rejected `3,2,0,7,12,1`. SQL подтвердил 94 evaluated; 78 строк имеют `score<50` и `decision=rejected-low-score`.
- **save-summary/Zen:** cycle time `2026-09-24T02:04:06Z` — `summarize FAILED=16`, `summarize OK=0`, `published=0`; следующие циклы также дали `16/0/0`. В БД 16 failure entries имеют stage `zen`, reason `unavailable`, timestamps от `2026-09-24T06:28:03.608Z` до `2026-09-24T06:30:13.949Z`; 14 относятся к 94 rolling candidates, 2 — более старый backlog. Значения ключей и error body не выводились.
- **daily-digest:** stage time — `daily-digest.log` mtime `2026-09-24T06:00:05Z`; последний безопасный marker: `[daily-digest] 2 published in last 24h`. В журнале 37 such markers и 18 Telegram-related строк; проверялись число публикаций, наличие health/collection/delivery markers и статусы доставки (health marker не обнаружен), без текста дайджеста и payload.

## Источники

Production source rows и одинаковая read-only GET-проверка (probe timestamp: `2026-09-24T07:05:59.446987Z`):

- `source_config_url: science` = `https://www.science.org/rss/news_current.xml`; `http_result: 403`.
- `source_config_url: lancet` = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi`; `http_result: URLError`, `reason: gaierror` (DNS resolution).
- Контроль: Nature `76` RSS items, Cell `27`, MIT Tech Review `10`, arXiv `25`; все HTTP `200` и успешный parse. Redirect arXiv HTTP→HTTPS зафиксирован.

`source_health` содержит 27 активных Hermes-feed records; только `science` и `lancet` имеют `status=failing`, `successCount=0`, `consecutiveFails=630`.

## Zen: что доказано и что нет

- Persisted health state: `poolSize=4`, `coolingKeys=0`, `updatedAt=2026-09-10T05:57:32.657Z`; это stale snapshot, а не доказательство успешных запросов 24 сентября.
- Безопасный probe существующего production-кода под тем же application environment: effective pool `1`, `goConfigured=true`, Go base URL; значения ключей не выводились.
- В логах есть quota/rotation и pool-exhaustion markers. Поэтому подтверждён непосредственный сбой summaries на Zen-этапе, но не подтверждён точный HTTP-ответ провайдера или конкретный лимит/credential.

## Причинность 92 неопубликованных кандидатов

`92 = 78 rejected-low-score + 14 pending`; это разложение подтверждено SQL-агрегатом. Status/score breakdown: `78` строк `score<50` отклонены evaluation, `16` строк имеют `score>=50` (`14 pending`, `2 published`), `score_null=0`; manifest cycles 24 сентября содержали `13`, затем по `16` pending. Из 16 Zen failure entries только 14 попадают в rolling-набор 94; ещё 2 относятся к старому backlog. Следовательно, 16 Zen failures — это 16 конкретных статей, но **не равны автоматически `94−2` и не объясняют все 92 неопубликованных кандидата**. Отдельная доказанная потеря — evaluation score/gate; feed failures science/lancet дополнительно объясняют отсутствие science/lancet candidates, но их полный вклад не измерен.

## Вывод и следующий безопасный шаг

Доказано: приложение и cron доступны; collection/evaluation продолжаются; 24 сентября summaries блокируются Zen-ошибками; 78 кандидатов отдельно отсеяны низким score; science/lancet endpoint-доступность сломана. Zen не назначается первопричиной всего падения: 16 Zen failures — только 16 статей, а 92 имеют отдельную status/score/manifest breakdown. Не доказано: какой именно Zen key/provider/лимит исчерпан и почему именно он отличается от persisted `4/4`.

Следующий шаг — только read-only provider-level диагностика с выводом HTTP-класса и effective pool, затем отдельно согласовать конфигурацию Go/legacy pool; endpoint science/lancet чинить отдельным изменением. Никаких исправлений в этой задаче не применялось.

## Что не менялось

Production-файлы, база, PM2, cron, приложение, код и конфигурация не изменялись. Не выполнялись delete, reset, restart, deploy или публикация; секретные значения не попали в evidence.
