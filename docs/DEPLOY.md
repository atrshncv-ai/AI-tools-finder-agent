# Развёртывание: чистый Ubuntu 24.04 → работающий выпуск

Этот документ описывает **фактический стек** проекта, а не желаемый: Node.js 20,
PostgreSQL 16, PM2, nginx + Let's Encrypt, cron и rclone для бэкапа вне сервера.
Docker остался в репозитории как legacy-путь (`docker-compose.yml`, `Dockerfile`) и
описан в §13: в нём нет конвейера, `yt-dlp` и `ffmpeg`, поэтому прод так не
поднимается.

> **Статус развёртывания: заглушка (G02).** Адрес сервера, домен и доступы
> придут от владельца после покупки. Всё, что можно проверить без сервера,
> проверено: скрипты проходят `bash -n`, `scripts/check-env-example.ts` и
> `scripts/check-docs.ts` зелёные, `scripts/backup-offsite.sh` без переменных
> хранилища падает с кодом 78, а не «успехом». Шаги, которые требуют живой
> машины (§2–§12 и §16), помечены как **ждёт G02** и выполняются после получения
> доступов.

Документ рассчитан на человека, который видит проект впервые. Каждая команда
выполнима; пути — от корня репозитория, если не сказано иное.

---

## 1. Что именно запускается

| Компонент | Что это | Кто запускает |
|---|---|---|
| `news-agent-web` | Hono + tRPC + собранный дашборд, `dist/boot.js`, порт 3000 | PM2 |
| `hermes-ralph-loop` | конвейер: сбор → префильтр → судья → бюджет → выжимки → публикация, **один выпуск в сутки** | PM2 |
| `daily-digest.ts` | утренний дайджест: клиентский и служебный выпуски | cron, 06:00 UTC |
| `backup-offsite.sh` | дамп БД и выгрузка в S3-совместимое хранилище | cron, 03:30 UTC |
| PostgreSQL 16 | база `science_agent` | systemd |
| nginx + certbot | HTTPS-вход на дашборд, редирект http→https | systemd |

Один цикл в сутки — это не настройка, а инвариант: `cycle-YYYY-MM-DD` в
`pipeline_state`, после опубликованного выпуска второй запуск спит до следующих
UTC-суток. Пауза `LINEAR_WORKER_INTERVAL_MS` — только задержка повтора после
сбоя, а не интервал выпусков (см. `docs/adr/0004-one-release-per-day.md`).

---

## 2. Сервер

**Ждёт G02.**

Минимальная конфигурация под этот стек:

- 2 vCPU, 2–4 ГБ RAM, 40 ГБ SSD;
- Ubuntu 24.04 LTS, root или sudo-пользователь;
- публичный IPv4 и DNS-запись `A` домена на этот адрес;
- исходящий доступ в интернет (RSS, GitHub, arXiv, GigaChat, Telegram);
- для GigaChat — **российский IP** и корневые сертификаты (§5), иначе вызов не
  пройдёт независимо от ключа.

Проверка перед началом:

```bash
lsb_release -ds                  # Ubuntu 24.04.x LTS
getent hosts news.example.com    # должен вернуть адрес этого сервера
```

DNS должен указывать на сервер **до** выпуска сертификата: Let's Encrypt
проверяет домен снаружи.

---

## 3. Установка

**Ждёт G02.**

```bash
# 1. Забрать репозиторий на сервер (адрес remote — у владельца).
sudo git clone <remote-url> /srv/news-agent
cd /srv/news-agent

# 2. Установка одной командой: пакеты, Node 20, PM2, пользователь, база,
#    миграции, сиды, сертификаты GigaChat, cron, nginx, проверка /health.
sudo env APP_DIR=/srv/news-agent APP_USER=deploy \
     DOMAIN=news.example.com TLS_EMAIL=admin@example.com \
     bash scripts/deploy/install.sh
```

Скрипт идемпотентен: повторный запуск не пересоздаёт базу, не перезаписывает
`app/.env` и не теряет существующие данные. Он делает то же, что описано в §3–§7
вручную, в том же порядке.

Ручной эквивалент первого шага (если скрипт недоступен):

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git build-essential python3 \
  postgresql postgresql-contrib nginx certbot python3-certbot-nginx \
  ffmpeg fail2ban ufw rclone unzip openssl sudo gettext-base
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | sudo gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
echo 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main' \
  | sudo tee /etc/apt/sources.list.d/nodesource.list
sudo apt-get update && sudo apt-get install -y nodejs
sudo npm install -g pm2
sudo timedatectl set-timezone UTC
```

Пользователь приложения и каталоги логов:

```bash
sudo useradd --create-home --shell /bin/bash deploy
sudo usermod -aG sudo deploy
sudo install -d -o deploy -g deploy -m 0755 /var/log/news-agent
sudo chown -R deploy:deploy /srv/news-agent
```

---

## 4. База, переменные, миграции, сиды

**Ждёт G02.**

Роль и база (пароль — только в `app/.env`; в примере его нет):

```bash
sudo -u postgres psql -c "CREATE ROLE science_agent LOGIN PASSWORD '<пароль>'"
sudo -u postgres createdb --owner science_agent science_agent
```

Переменные. Единственный контракт — `app/.env.example`; `app/.env` создаётся из
него и в git не попадает:

```bash
cd /srv/news-agent
sudo -u deploy install -m 600 app/.env.example app/.env
sudo -u deploy nano app/.env      # DATABASE_URL, GIGACHAT_*, TELEGRAM_*, BACKUP_S3_*
```

Обязательный минимум, без которого ничего не работает:

- `DATABASE_URL` — `postgresql://science_agent:<пароль>@localhost:5432/science_agent`;
- `JWT_SECRET` (или legacy `APP_SECRET`) — иначе веб не стартует. Значение
  `APP_SECRET` в примере — заглушка, задайте настоящий `JWT_SECRET`;
- `GIGACHAT_CLIENT_ID`, `GIGACHAT_CLIENT_SECRET` (и `GIGACHAT_SCOPE` для физлица) —
  основное плечо цепочки провайдеров (§5.1). Без пары вызов провайдера падает с
  классом `config`, фолбэка нет: судья не получит вердикт, и выпуска за эти сутки
  не будет. Это конфигурационная ошибка, а не квота;
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CLIENT_CHAT_IDS`, `TELEGRAM_OWNER_CHAT_IDS` —
  иначе дайджест печатается в лог вместо отправки;
- `BACKUP_S3_*` — иначе ночной бэкап честно падает (§9).

`DAILY_BUDGET` — 5..10, по умолчанию 8. Значение вне диапазона останавливает
конвейер на старте, а не подменяется молча.

Сборка, миграции и сиды (миграции — `app/db/migrations`, актуально `0011`):

```bash
cd /srv/news-agent/app
sudo -u deploy npm ci
sudo -u deploy npm run check          # tsc -b
sudo -u deploy npm run build          # dist/boot.js + dist/public
sudo -u deploy npm run db:migrate
sudo -u deploy npm run db:seed        # 6 научных направлений + источники
sudo -u deploy npx tsx scripts/seed-ai-science-tools.ts   # каталог инструментов
sudo -u deploy npx tsx scripts/seed-invention-tools.ts    # расширение каталога
```

После сидов дашборд не пустой: заполнены категории (включая шесть научных
направлений) и каталог инструментов (`invention_tools`).

Проверка:

```bash
sudo -u postgres psql science_agent -c "select count(*) from categories"
sudo -u postgres psql science_agent -c "select count(*) from invention_tools"
```

---

## 5. GigaChat: пара ключей, сертификаты, проверка вызова

GigaChat — основное плечо цепочки провайдеров: через него идут и вердикты судьи,
и русские выжимки. OpenCode Go подключается только как фолбэк на квоту и
транзиентный сбой, поэтому без пары GigaChat выпуска не будет.

### 5.1. Получить пару `GIGACHAT_CLIENT_ID` и `GIGACHAT_CLIENT_SECRET`

Делается в браузере; сервер для этого не нужен.

1. Откройте кабинет разработчика Сбера — `https://developers.sber.ru` — и войдите
   под своим аккаунтом (Сбер ID).
2. Создайте проект для GigaChat API. Для физического лица выбирайте проект с
   доступом **«Физлицо»**: ему соответствует scope `GIGACHAT_API_PERS`.
   Корпоративный проект — отдельный путь: там свой scope (`GIGACHAT_API_B2B` и
   подобные), который пришлось бы прописывать в `GIGACHAT_SCOPE`. Ниже описан
   проект физлица, как в `app/.env.example`.
3. В карточке проекта откройте авторизационные данные: **Client ID** — это
   `GIGACHAT_CLIENT_ID`, **Client Secret** — `GIGACHAT_CLIENT_SECRET`.
   Секрет — такой же пароль, как ключ API: он не идёт в чаты, тикеты и логи.
4. Впишите пару в `app/.env` (файл создаётся из `app/.env.example` в §4; значения
   живут только там, в git файл не попадает):

   ```ini
   GIGACHAT_CLIENT_ID=<Client ID из кабинета>
   GIGACHAT_CLIENT_SECRET=<Client Secret из кабинета>
   # Scope физлица; пустое значение — тот же GIGACHAT_API_PERS из кода
   GIGACHAT_SCOPE=GIGACHAT_API_PERS
   ```

   Заменить один секрет, не переписывая файл и не печатая значение в терминал
   (из корня репозитория, от имени владельца `app/.env`, то есть `deploy`):

   ```bash
   sudo -u deploy scripts/update-key.sh GIGACHAT_CLIENT_SECRET
   ```

   Значение читается только из stdin: при интерактивном запуске — без эха, в
   историю команд и в `ps` не попадает; запись атомарная, файл остаётся `600`.

5. **Лимит токенов.** Актуальный лимит проекта показывается в том же кабинете, в
   карточке проекта и тарифа: цифру задаёт кабинет, а не приложение, поэтому в
   `.env` её нет. Приложение считает расход само: провайдер возвращает `usage`
   каждого вызова, суточная сумма лежит в `pipeline_state.metrics.usage`, а
   владелец видит её в служебном отчёте строкой
   «Токены за сутки: N вызовов · вход X · выход Y». Исчерпанный лимит приходит
   как 402/429 — класс `quota`; только он и `transient` разрешают фолбэк на
   OpenCode Go. Сам код лимит не повышает и тариф не меняет.
6. Проверка пары — на сервере, после сертификатов (§5.2), скриптом из §5.3. Если
   пары нет, скрипт вернёт код 78, а цикл завершится без выпуска с ошибкой класса
   `config` — это ожидаемое поведение, а не повод включать фолбэк.

### 5.2. Сертификаты (на сервере)

**Ждёт G02 (выполняется на сервере).**

GigaChat (`gigachat.devices.sberbank.ru`, `ngw.devices.sberbank.ru`) выписан
российским доверенным центром. Без этих сертификатов TLS-рукопожатие падает до
авторизации. Node.js **не использует** системное хранилище — ему нужен
`NODE_EXTRA_CA_CERTS`.

```bash
sudo bash scripts/deploy/gigachat-certs.sh
```

Скрипт скачивает Russian Trusted Root CA и Sub CA, ставит их в системное
хранилище (`update-ca-certificates`), собирает bundle
`/etc/ssl/certs/news-agent-russian-trusted.pem` и проверяет TLS до
`gigachat.devices.sberbank.ru:443`. В конце он печатает строку для `app/.env`:

```ini
NODE_EXTRA_CA_CERTS=/etc/ssl/certs/news-agent-russian-trusted.pem
```

`scripts/deploy/install.sh` прописывает её сам, если сертификаты установились;
cron получает ту же переменную в расписании. После ручной правки `app/.env`
перезапустить процессы:

```bash
sudo -u deploy pm2 restart news-agent-web --update-env
sudo -u deploy pm2 restart hermes-ralph-loop --update-env
```

### 5.3. Проверка вызова с этого сервера

**Ждёт G02 (выполняется на сервере).**

Проверка «вызов проходит **с этого сервера**» — отдельный скрипт. Он берёт пару из
`app/.env` (другой файл задаётся `ENV_FILE`), делает те же два запроса, что и
провайдер (OAuth → `/chat/completions`), и печатает только HTTP-код и имя модели,
без токена и без тела ответа:

```bash
bash scripts/deploy/check-gigachat.sh
```

Ожидаемый результат:
`[check-gigachat] GigaChat OK: HTTP 200 on /chat/completions (model GigaChat)`.

Коды ошибок читаются так: 78 — пара не задана в `app/.env`; 69 — не хватает
`curl`, `python3` или `openssl`; 401/403 — конфигурация (ключ, scope), фолбэк не
поможет и не должен включаться; 402/429 — квота/лимит, в приложении сработает
OpenCode Go как фолбэк.

Интерактивная диагностика, если что-то не сходится:

```bash
sudo bash scripts/deploy/gigachat-certs.sh --check   # сертификаты и TLS
openssl s_client -connect gigachat.devices.sberbank.ru:443 \
  -servername gigachat.devices.sberbank.ru \
  -CAfile /etc/ssl/certs/news-agent-russian-trusted.pem </dev/null | tail -3
```

---

## 6. PM2

**Ждёт G02.**

Конфигурация — `ecosystem.config.cjs`, два процесса. Она читает `app/.env` сама
(PM2 не умеет dotenv), пустые значения отбрасываются, секреты не печатаются.

```bash
cd /srv/news-agent
sudo -u deploy pm2 start ecosystem.config.cjs
sudo -u deploy pm2 save
# один раз, чтобы процессы пережили ребут; если PM2 напечатает команду — выполнить её
sudo pm2 startup systemd -u deploy --hp /home/deploy
```

Проверка:

```bash
sudo -u deploy pm2 status
curl -fsS http://127.0.0.1:3000/health && echo
sudo -u deploy pm2 logs news-agent-web --lines 50
sudo -u deploy pm2 logs hermes-ralph-loop --lines 50
```

`/health` отвечает 200; статус `degraded` означает недоступность LLM, а 503 —
недоступность базы.

---

## 7. Домен и HTTPS

**Ждёт G02.**

Шаблон сайта — `scripts/deploy/nginx-site.conf.template`; `install.sh` подставляет
`DOMAIN` и `PROXY_PORT` и кладёт файл в `/etc/nginx/sites-available/news-agent`.
Сертификат выпускает certbot, он же добавляет HTTPS-сервер и редирект http→https:

```bash
sudo certbot --nginx --non-interactive --agree-tos --no-eff-email --redirect \
  -m admin@example.com -d news.example.com
sudo nginx -t && sudo systemctl reload nginx
```

Проверка (R01.1): адрес без IP и порта, валидный сертификат, редирект.

```bash
curl -sSI http://news.example.com | head -3      # 301 → https
curl -sSI https://news.example.com | head -3     # 200
echo | openssl s_client -connect news.example.com:443 -servername news.example.com 2>/dev/null \
  | grep 'Verify return code'                     # 0 (ok)
```

В `app/.env` адрес дашборда задаёт `DIGEST_DASHBOARD_URL=https://news.example.com`
— он попадает в футер клиентского дайджеста.

---

## 8. Cron

**Ждёт G02.**

```bash
sudo env APP_DIR=/srv/news-agent APP_USER=deploy bash scripts/deploy/cron.sh
```

Ставится `/etc/cron.d/news-agent` — два задания и `NODE_EXTRA_CA_CERTS`, если
сертификаты установлены:

| Время (UTC) | Команда | Лог |
|---|---|---|
| 06:00 | `npx tsx scripts/hermes/daily-digest.ts` | `/var/log/news-agent/digest.log` |
| 03:30 | `bash scripts/backup-offsite.sh` | `/var/log/news-agent/backup.log` |

Сервер живёт в UTC (§3), поэтому 06:00 UTC = 09:00 МСК. Удалить расписание:
`sudo bash scripts/deploy/cron.sh --remove`.

Проверка дайджеста без отправки (stub-режим включается сам, когда нет токена или
получателей):

```bash
cd /srv/news-agent/app && sudo -u deploy npx tsx scripts/hermes/daily-digest.ts
```

---

## 9. Бэкап вне сервера и проверка восстановления

**Загрузка и восстановление ждут G02 (нужны аккаунт хранилища и сервер);
локально проверен отказ без настроек.**

Прошлый сервер потерял данные вместе с собой, потому что копия лежала на нём же.
Поэтому дамп уезжает в S3-совместимое хранилище, и скрипт **не сообщает успех**,
если хранилище не настроено (код возврата 78).

```bash
# Сухой прогон: проверка конфигурации без дампа и загрузки.
sudo -u deploy bash scripts/backup-offsite.sh --dry-run

# Настоящий бэкап (cron делает это каждую ночь).
sudo -u deploy bash scripts/backup-offsite.sh
```

Проверка ночного задания утром:

```bash
cat /var/log/news-agent/backup.log | tail -20
sudo -u deploy cat /home/deploy/.news-agent/last-backup.json   # дата, размер, sha256, объект
```

Переменные (`app/.env`): `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`,
`BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, опционально
`BACKUP_S3_REGION`, `BACKUP_S3_PREFIX`, `BACKUP_STATUS_FILE`. Имена — в
`app/.env.example`, значения пишет владелец.

### Процедура восстановления (выполняется и проверяется после G02)

```bash
cd /srv/news-agent

# 1. Посмотреть, что лежит в хранилище (тот же доступ, что у бэкапа).
sudo -u deploy bash scripts/backup-offsite.sh --list

# 2. Скачать нужный дамп в /srv/restore и проверить архив.
sudo bash scripts/backup-offsite.sh --fetch <файл из списка>
gunzip -t /srv/restore/<файл из списка>

# 3. Восстановить в ЧИСТУЮ базу, а не поверх рабочей.
sudo -u postgres createdb --owner science_agent news_agent_restore_check
gunzip -c /srv/restore/<файл из списка> \
  | sudo -u postgres psql news_agent_restore_check

# 4. Сверить объёмы с рабочей базой.
sudo -u postgres psql news_agent_restore_check -c \
  "select count(*) from news; select count(*) from pipeline_state;"

# 5. Только после сверки — переключение (остановить цикл, переименовать базы).
```

`--list` и `--fetch` читают те же `BACKUP_S3_*` из `app/.env`, что и загрузка:
отдельный профиль rclone на сервере заводить не нужно.

Проверка считается пройденной, когда шаги 1–4 выполнены на чистой базе и числа
совпали. До G02 эта строка — открытый пункт, а не «сделано».

---

## 10. Закрытие сервера

**Ждёт G02.**

```bash
sudo bash scripts/deploy/harden.sh --user deploy
```

Скрипт делает пять вещей: вход по SSH только ключом, `ufw` (22/80/443, остальное
закрыто), `fail2ban` для sshd, блокировка root-пароля, автообновления
безопасности. Он **отказывается** выключать парольный вход, если у выбранного
sudo-пользователя нет непустого `~/.ssh/authorized_keys`, — иначе сервер остался
бы без входа.

Чек-лист (R03.1), проверять из **второго** терминала, не закрывая первый:

```bash
ssh -p 22 deploy@news.example.com                                   # ключ работает
ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no deploy@news.example.com  # должен отказать
sudo sshd -T | grep -E 'passwordauthentication|permitrootlogin'     # no / prohibit-password
sudo ufw status verbose                                             # 22, 80, 443
sudo fail2ban-client status sshd
sudo passwd -S root                                                 # L (locked)
sudo ss -tlnp | grep -E ':(3000|5432)'                              # 3000/5432 — только 127.0.0.1
```

---

## 11. Первый выпуск: что проверить

**Ждёт G02.**

1. `/health` — 200; `pm2 status` — оба процесса `online`.
2. Один цикл вручную. Сначала остановить PM2-цикл, чтобы не запустить два
   параллельно (`pm2 stop hermes-ralph-loop`), затем в отдельном терминале:
   `cd /srv/news-agent/app && bash scripts/hermes/ralph-loop.sh`, после проверки
   — `pm2 start hermes-ralph-loop`.
   В логе: `Configuration OK`, `Cycle #1 started`, `Manifest: N articles within
   the day budget`, `deploy-ready: published=N/8 today`.
3. Счётчики цикла (имена колонок — camelCase, в кавычках):
   `select "cycleId", stage, metrics from pipeline_state order by "createdAt" desc limit 1;`
   В `metrics` — `collected / prefiltered / judged / approved / published` и
   `rejectedByReason`, `usage`.
4. Дашборд: вход по паролю из §16, карточки с разделами и направлениями.
5. Дайджест: `cd /srv/news-agent/app && sudo -u deploy npx tsx scripts/hermes/daily-digest.ts`.
   Владелец получает служебный отчёт и копию; клиент — только чистый выпуск.

---

## 12. Обновление

```bash
cd /srv/news-agent
sudo -u deploy git pull --ff-only
cd app
sudo -u deploy npm ci
sudo -u deploy npm run check && sudo -u deploy npx vitest run
sudo -u deploy npm run build
sudo -u deploy npm run db:migrate
sudo -u deploy pm2 restart /srv/news-agent/ecosystem.config.cjs --update-env
```

Перед обновлением — бэкап (`sudo -u deploy bash /srv/news-agent/scripts/backup-offsite.sh`).
Проверки документации: `cd app && npx tsx ../scripts/check-docs.ts` и
`npx tsx ../scripts/check-env-example.ts` (§14).

---

## 13. Legacy: Docker и корневой `.env.example`

`docker-compose.yml` и `Dockerfile` остались от прежней схемы. В контейнере
поднимается только веб (`node dist/boot.js`); конвейер `hermes-ralph-loop` в
compose отсутствует, `yt-dlp`, `ffmpeg` и `deno` в образ не ставятся, а `cron`
для дайджеста и бэкапа не настраивается. Прод так не поднимается.

Корневой `.env.example` относится к той же legacy-схеме (MCP-ключи, docker-
переменные `POSTGRES_PASSWORD`, `DOMAIN`). Контракт приложения — `app/.env.example`;
`scripts/check-env-example.ts` сверяет код именно с ним.

Переменные `APP_ID`, `KIMI_AUTH_URL`, `KIMI_OPEN_URL` — мёртвые остатки прежней
внешней авторизации: ни один код их не читает, вход теперь email + пароль и JWT.
Имена остались только в `app/.env.example` ради старого `.env`; новые развёртывания
их не заполняют, и никакой функции они не включают. `OWNER_UNION_ID` для новых
развёртываний тоже пустая: роль `admin` выдаётся при создании учётной записи
флагом `--role admin` (§16), а не этой переменной.

---

## 14. Проверки, которые обязаны быть зелёными

```bash
cd app && npx tsc -b && npx vitest run          # типы и тесты (369 тестов)
cd /srv/news-agent
bash -n scripts/deploy/install.sh && bash -n scripts/deploy/cron.sh \
  && bash -n scripts/deploy/harden.sh && bash -n scripts/deploy/gigachat-certs.sh \
  && bash -n scripts/deploy/check-gigachat.sh && bash -n scripts/backup-offsite.sh
cd app && npx tsx ../scripts/check-env-example.ts   # код ↔ app/.env.example
cd app && npx tsx ../scripts/check-docs.ts          # факты, пути, bash -n
```

`check-env-example.ts` падает, если код читает переменную, которой нет в
`app/.env.example`, или пример объявляет переменную, которую никто не читает и
которая не описана как исключение с причиной. `check-docs.ts` сверяет с кодом
порог гейта, бюджет дня, id моделей по умолчанию, число разделов и направлений,
порог уверенности судьи и лимиты дайджеста, проверяет существование каждого
`scripts/…`, `app/…`, `docs/…` пути в документах и `bash -n` всех shell-скриптов.
Таблица фактов живёт в `ARCHITECTURE.md` между маркерами `checked-facts`.

---

## 15. Точки отказа и что смотреть

| Симптом | Где смотреть | Вероятная причина |
|---|---|---|
| `/health` 503 | `pm2 logs news-agent-web`, `systemctl status postgresql` | база недоступна, неверный `DATABASE_URL` |
| `/health` `degraded` | `pm2 logs` | LLM-провайдер недоступен или ключ не принят |
| Нет выпуска | `/var/log/news-agent/hermes.err.log`, `pipeline_state.metrics` | судья всё отклонил, пустой сбор, бюджет исчерпан |
| Дайджест не пришёл | `/var/log/news-agent/digest.log` | нет `TELEGRAM_BOT_TOKEN`/chat_id, 403 от бота |
| Нет бэкапа | `/var/log/news-agent/backup.log`, `/home/deploy/.news-agent/last-backup.json` | хранилище не настроено, нет `rclone`, истёк ключ |
| GigaChat 401/403 | `scripts/deploy/check-gigachat.sh` | ключ/scope; фолбэк не поможет, это не квота |
| Карточки не видны | логи web, `/health` | не применены сиды или миграции |

---

## 16. Пользователь дашборда и доступы клиенту

**Ждёт G02.**

Публичной регистрации в приложении нет. Учётные записи создаются только на
сервере скриптом `app/scripts/create-user.ts`; он же служит сменой пароля. В панели
`/admin` учётки не создаются и пароли не меняются.

1. Создайте владельца с ролью `admin` — без неё панель недоступна, иначе войти в
   дашборд некому:

   ```bash
   cd /srv/news-agent/app
   sudo -u deploy npx tsx scripts/create-user.ts \
     --email [EMAIL ВЛАДЕЛЬЦА] --name "[ИМЯ ВЛАДЕЛЬЦА]" --role admin
   ```

2. Создайте клиента; роль по умолчанию — `user` (только контент, без панели):

   ```bash
   sudo -u deploy npx tsx scripts/create-user.ts \
     --email [EMAIL КЛИЕНТА] --name "[ИМЯ КЛИЕНТА]"
   ```

   Скрипт подключается к базе по `app/.env`, поэтому запускается из `app/` и от
   пользователя, которому принадлежит `.env` (`deploy`).

   Что печатает скрипт и почему это важно:

   - в stdout — одна строка JSON `{"status","email","password","role"}`, в stderr —
     диагностика; пароля в stderr нет;
   - без `--password` пароль генерируется сам: четыре группы по четыре знака без
     похожих символов — придумывать его не нужно;
   - `--password` в аргументах остаётся в истории shell и виден в `ps`, поэтому
     лучше его не передавать;
   - пароль из stdout — единственная передача: сохраните его в терминале (или в
     файле с правами `600`) и отдайте клиенту лично.

3. Выдайте доступы клиенту:
   - адрес — `https://<домен из §7>`, вход на `/login`;
   - email и сгенерированный пароль — личным сообщением, отдельно от ссылок и
     скриншотов;
   - клиент видит опубликованный выпуск, разделы и направления, поиск, избранное и
     профиль; служебные строки, счётчики и ошибки конвейера уходят только
     владельцу;
   - `/admin` клиенту недоступен: панель перенаправляет на главную, пока роль не
     `admin` (выдать её можно кнопкой «Сделать админом» в панели —
     `docs/ADMIN_GUIDE.md`).

4. Проверьте вход до передачи пароля:

   ```bash
   curl -fsS https://<домен из §7>/health     # 200
   ```

   и вход в браузере под клиентской учёткой: карточки открываются, `/admin`
   перенаправляет на главную.

### Смена пароля

Встроенной смены пароля в дашборде нет; пароль меняется повторным запуском того же
скрипта с тем же email:

```bash
cd /srv/news-agent/app
sudo -u deploy npx tsx scripts/create-user.ts --email [EMAIL КЛИЕНТА]
```

Существующая запись обновляется, а не дублируется: скрипт ищет пользователя по
email и перезаписывает пароль (в выводе `"status":"updated"`). Заодно
увеличивается `tokenVersion` — все ранее выданные сессии клиента перестают
действовать, старый пароль больше не подходит.

Флаг `--role` при смене пароля указывайте явно для владельца: без него скрипт
запишет роль по умолчанию `user` и снимет админские права.

---

## 17. Что осталось за G02

Выполнение §2–§12 и §16 на живом сервере. До получения адреса, домена, ключей GigaChat,
Telegram-получателей и аккаунта хранилища проект остаётся с **готовым runbook и
проверенными скриптами без выполнения**. Это записано манифестом как G02, и
снимает ограничение только владелец.
