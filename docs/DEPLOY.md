# Руководство по развёртыванию

## Требования

- Docker и Docker Compose
- Сервер с Ubuntu 22.04 LTS (рекомендуется)
- RAM: минимум 8 ГБ (для LM Studio / Gemma 4)
- CPU: 4+ ядра
- Диск: 50+ ГБ SSD
- Домен и DNS-записи, указывающие на сервер

## Переменные окружения

Скопируйте `.env.example` в `.env` и заполните:

```bash
# Обязательные
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/science_agent
POSTGRES_PASSWORD=<сложный_пароль>
APP_ID=<kimi_app_id>
APP_SECRET=<kimi_app_secret>
KIMI_AUTH_URL=https://<kimi-auth-host>
KIMI_OPEN_URL=https://<kimi-open-host>
OWNER_UNION_ID=<your_union_id>

# CORS (в продакшене не оставляйте *)
CORS_ORIGIN=https://your-domain.com

# AI (параметры для текущей модели; при смене модели достаточно изменить LM_STUDIO_MODEL)
LM_STUDIO_URL=http://host.docker.internal:1234
LM_STUDIO_MODEL=google/gemma-4-e4b
LM_STUDIO_TIMEOUT_MS=60000
LM_STUDIO_MAX_INPUT_TOKENS=6000
LM_STUDIO_SUMMARY_MAX_TOKENS=1024
LM_STUDIO_DETAILED_MAX_TOKENS=2048
LM_STUDIO_TRANSLATION_MAX_TOKENS=4096
LM_STUDIO_RETRIES=3
LM_STUDIO_RETRY_DELAY_MS=5000
LM_STUDIO_CONCURRENCY=3

# Локальный перевод (Transformers.js / ONNX)
LOCAL_TRANSLATE_MODEL=Xenova/opus-mt-en-ru
LOCAL_TRANSLATE_MAX_CHUNK_CHARS=400
LOCAL_TRANSLATE_DEVICE=cpu
```

## Запуск

```bash
# 1. Билд и запуск
 docker compose -p scienceagent up --build -d

# 2. Применение миграций (первый запуск)
 docker compose -p scienceagent exec app npm run db:migrate

# 3. Сид категорий и источников (первый запуск)
 docker compose -p scienceagent exec app npm run db:seed
```

## SSL (Let's Encrypt)

```bash
./scripts/setup-ssl.sh
```

Или вручную:

```bash
docker run -it --rm \
  -v scienceagent_certbot_conf:/etc/letsencrypt \
  -v scienceagent_certbot_www:/var/www/certbot \
  -p 80:80 \
  certbot/certbot certonly --standalone -d your-domain.com
```

## Обновление

```bash
git pull
 docker compose -p scienceagent up --build -d
 docker compose -p scienceagent exec app npm run db:migrate
```

## Проверка состояния

- API health: `https://your-domain.com/health`
- Admin panel: `https://your-domain.com/admin`

## Бэкап БД

```bash
./scripts/backup.sh
```
