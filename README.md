# Научный агент (news agent)

An autonomous news-curation agent for one private client: it collects AI and
AI-for-science news once a day, drops the noise with a cheap deterministic
prefilter, asks an LLM judge whether each item is really on topic, publishes at
most a hard daily budget of the best items as one release, and sends a clean
Telegram digest to the client while the owner gets a copy plus a separate
service report.

> **Статус:** v2 на новом стеке. Код, тесты и runbook готовы, развёртывание
> ждёт G02 — адрес сервера, домен и доступы от владельца (см. `PROGRESS.md`).

## Что делает

Раз в сутки, по расписанию:

```
collect-dual → prefilter → judge → дневной бюджет → выжимки → ОДИН выпуск
                                                             └→ дайджест 06:00 UTC
```

- **Три раздела, шесть направлений науки** — данные в
  `app/scripts/hermes/topics.ts`, а не словари в коде отбора.
- **Судья fail-closed** (`app/scripts/hermes/judge.ts`): сомнение трактуется как
  отказ, а не как публикация. Материал про энергосети не попадает в «Биологию»
  только потому, что рядом стоит слово «ИИ».
- **Бюджет дня** `DAILY_BUDGET` (5..10, по умолчанию 8) проверяется и при
  отборе, и на публикации: обойти его манифестом или ручным вызовом нельзя.
- **Два провайдера:** GigaChat основной, OpenCode Go — фолбэк только на
  quota/transient; 401/403 — ошибка конфигурации, фолбэка нет.
- **Клиент и владелец получают разное:** клиент — чистый выпуск, владелец —
  копию и служебный отчёт со счётчиками и причинами отказов.
- **База уезжает вне сервера:** ночной дамп в S3-совместимое хранилище; скрипт
  падает, если хранилище не настроено, вместо «успеха» с пустым файлом.

## Стек

| Слой | Технологии |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS 3.4, Radix UI, TanStack Query, tRPC client, react-router 7 |
| Backend | Node.js 20, Hono, tRPC 11, jose (JWT), bcryptjs |
| База | PostgreSQL 16, Drizzle ORM, миграции `app/db/migrations` |
| LLM | GigaChat → OpenCode Go (цепочка в `app/api/ai/providers/chain.ts`) |
| Медиа | yt-dlp, ffmpeg, Whisper API для видео без субтитров |
| Эксплуатация | Ubuntu 24.04, PM2 (`ecosystem.config.cjs`), nginx + certbot, cron, rclone |
| Качество | Vitest (354 теста), `tsc -b`, ESLint, Prettier |

## Быстрый старт (локально)

```bash
cd app
npm ci
cp .env.example .env          # заполнить DATABASE_URL, JWT_SECRET, ключи
npm run db:migrate
npm run db:seed
npx tsx scripts/seed-ai-science-tools.ts
npx tsx scripts/seed-invention-tools.ts
npm run dev                   # vite на http://localhost:3000
```

Один шаг конвейера вручную:

```bash
cd app && npx tsx scripts/hermes/collect-dual.ts --stream both
cd app && npx tsx scripts/hermes/evaluate-news.ts --batch
cd app && npx tsx scripts/hermes/manifest-gen.ts --limit 50
```

## Продакшен

Пошаговый runbook для чистого Ubuntu 24.04 (пакеты, база, миграции, сиды, PM2,
cron, домен и HTTPS, GigaChat-сертификаты, харденинг) — `docs/DEPLOY.md`.
Установка одной командой после клонирования:

```bash
sudo env APP_DIR=/srv/news-agent APP_USER=deploy DOMAIN=news.example.com \
     TLS_EMAIL=admin@example.com bash scripts/deploy/install.sh
```

## Конфигурация

Единственный контракт переменных — `app/.env.example`; значения живут только в
`app/.env`. Ключевые имена: `DATABASE_URL`, `JWT_SECRET`, `DAILY_BUDGET`,
`GIGACHAT_CLIENT_ID` / `GIGACHAT_CLIENT_SECRET`, `NODE_EXTRA_CA_CERTS`,
`ZEN_GO_API_KEYS` / `ZEN_GO_MODEL`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CLIENT_CHAT_IDS`, `TELEGRAM_OWNER_CHAT_IDS`, `BACKUP_S3_*`,
`LINEAR_WORKER_INTERVAL_MS` (пауза повтора после сбоя, не интервал выпусков).

Замена секрета без рестарта и без эха значения:

```bash
scripts/update-key.sh GIGACHAT_CLIENT_SECRET
```

## Проверки

```bash
cd app && npx tsc -b && npx vitest run
cd app && npx tsx ../scripts/check-env-example.ts   # код ↔ app/.env.example
cd app && npx tsx ../scripts/check-docs.ts          # факты в доках, пути, bash -n
```

`check-docs.ts` сверяет с кодом порог гейта, бюджет дня, id моделей по
умолчанию, число разделов и направлений и падает при расхождении.

## Документация

- [`docs/DEPLOY.md`](docs/DEPLOY.md) — развёртывание и эксплуатация.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — как устроено и почему, точки отказа.
- [`CONTEXT.md`](CONTEXT.md) — словарь: раздел, направление, префильтр, судья,
  бюджет дня, выпуск, служебный отчёт.
- [`PROGRESS.md`](PROGRESS.md) — сделано и открыто (G02 — доступы к серверу).
- [`docs/adr/`](docs/adr) — решения с причинами (разделы и направления, судья,
  цепочка провайдеров, один выпуск в сутки, бэкап вне сервера, нативный деплой).
- [`app/skills/news-processor/SKILL.md`](app/skills/news-processor/SKILL.md) —
  алгоритм конвейера для агента-исполнителя.
- `AGENTS.md` — workflow репозитория для AI-агентов.

## Ограничения

- Развёртывание не выполнено: ждёт G02.
- GigaChat проверен на моках; живой вызов с российского сервера — после ключа и
  сертификатов (`scripts/deploy/check-gigachat.sh`).
- Выжимки пока идут через `app/api/ai/zenClient.ts`, а не через цепочку
  провайдеров; судья — через цепочку.
- Хранилище бэкапов не настроено; путь отказа проверен, восстановление — после G02.
- `science.org` / `nature.com` блокируют IP дата-центров — ссылки проверяются
  через doi.org-резолвер.
- Reddit отключён по политике; YouTube-каналы курируются вручную.

## License / Лицензия

Released under the MIT License. See [LICENSE](LICENSE).
Проект распространяется по лицензии MIT. См. [LICENSE](LICENSE).
