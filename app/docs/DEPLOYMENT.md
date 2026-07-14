# Руководство по деплою

## Деплой на сервер

### Требования к серверу

| Параметр | Минимум | Рекомендуется |
|---|---|---|
| ОС | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |
| RAM | 8 ГБ | 16 ГБ |
| CPU | 4 ядра | 8 ядер |
| Диск | 50 ГБ SSD | 100 ГБ SSD |
| Docker | 24.0+ | 24.0+ |
| Docker Compose | 2.20+ | 2.20+ |

### Установка Docker

```bash
# Обновите пакеты
sudo apt update && sudo apt upgrade -y

# Установите Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Добавьте текущего пользователя в группу docker
sudo usermod -aG docker $USER

# Войдите заново для применения изменений
newgrp docker

# Проверьте установку
docker --version
docker compose version
```

### Подготовка сервера

1. **Склонируйте проект:**
```bash
git clone <repository-url>
cd НАУЧНЫЙ АГЕНТ
```

2. **Настройте переменные окружения:**
```bash
cp .env.example .env
nano .env
```

Заполните обязательные переменные:
```env
# Безопасность
POSTGRES_PASSWORD=your_strong_password
APP_ID=your_kimi_app_id
APP_SECRET=your_kimi_app_secret
KIMI_AUTH_URL=https://kimi.platform/api/auth
KIMI_OPEN_URL=https://kimi.platform/api/open

# LM Studio (если запускаете на сервере)
LM_STUDIO_URL=http://localhost:1234
LM_STUDIO_MODEL=google/gemma-4-e4b

# CORS
CORS_ORIGIN=https://your-domain.com
```

3. **Запустите деплой:**
```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

### Настройка SSL

1. **Убедитесь, что DNS настроен:**
```bash
# Проверьте, что домен указывает на ваш сервер
nslookup your-domain.com
```

2. **Запустите настройку SSL:**
```bash
chmod +x scripts/setup-ssl.sh
./scripts/setup-ssl.sh your-domain.com admin@your-domain.com
```

3. **Проверьте сертификат:**
```bash
# Сертификат будет автоматически обновляться
docker compose logs certbot
```

### Проверка работоспособности

```bash
# Проверьте статус контейнеров
docker compose ps

# Проверьте логи приложения
docker compose logs app

# Проверьте healthcheck
curl http://localhost/health

# Проверьте доступность сайта
curl -I https://your-domain.com
```

---

## Управление сервисами

### Остановка всех сервисов
```bash
docker compose down
```

### Перезапуск приложения
```bash
docker compose restart app
```

### Просмотр логов
```bash
# Все логи
docker compose logs

# Только логи приложения
docker compose logs -f app

# Только логи Nginx
docker compose logs -f nginx
```

### Обновление приложения

```bash
# Остановите сервисы
docker compose down

# Pull последние изменения
git pull

# Пересоберите образ
docker compose build app

# Запустите сервисы
docker compose up -d

# Миграции применяются автоматически при старте
# Проверьте статус:
curl http://localhost:3000/health
```

### Бэкап базы данных

```bash
# Создайте бэкап (автоматически хранит последние 7)
chmod +x scripts/backup.sh
./scripts/backup.sh

# Восстановите из бэкапа
gunzip -c backups/backup_20260617_060000.sql.gz | docker compose exec -T postgres psql -U postgres science_agent
```

### Бэкап базы данных

```bash
# Создайте бэкап
docker compose exec postgres pg_dump -U postgres science_agent > backup_$(date +%Y%m%d).sql

# Восстановите из бэкапа
docker compose exec -T postgres psql -U postgres science_agent < backup_20260617.sql
```

---

## Мониторинг

### Проверка здоровья системы

```bash
# Healthcheck endpoint
curl http://localhost:3000/health

# Ответ (ok):
# {"status":"ok","checks":{"database":"ok","lmStudio":"ok"},"ts":1781714600}

# Ответ (degraded - LM Studio недоступен):
# {"status":"degraded","checks":{"database":"ok","lmStudio":"unavailable"},"ts":1781714600}

# Ответ (error - БД недоступна, HTTP 503):
# {"status":"error","checks":{"database":"error","lmStudio":"ok"},"ts":1781714600}
```

### Проверка LM Studio

```bash
# Проверка доступности модели
curl http://localhost:1234/v1/models

# Тест суммаризации
curl -X POST http://localhost:1234/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "google/gemma-4-e4b",
    "messages": [{"role": "user", "content": "Привет"}],
    "max_tokens": 50
  }'
```

### Мониторинг ресурсов

```bash
# Использование ресурсов контейнеров
docker stats

# Использование диска
df -h

# Использование памяти
free -h
```

---

## Решение проблем

### Проблема: Приложение не запускается

```bash
# Проверьте логи
docker compose logs app

# Проверьте подключение к БД
curl http://localhost:3000/health
```

### Проблема: Nginx возвращает 502

```bash
# Проверьте, запущено ли приложение
docker compose ps

# Проверьте порт приложения
curl http://localhost:3000/health
```

### Проблема: SSL не работает

```bash
# Проверьте сертификаты
docker compose exec nginx ls -la /etc/letsencrypt/live/your-domain.com/

# Перезапустите certbot
docker compose restart certbot
```

### Проблема: LM Studio недоступен

```bash
# Проверьте, запущен ли LM Studio
curl http://localhost:1234/v1/models

# Если LM Studio на другом хосте, обновите .env
# LM_STUDIO_URL=http://other-host:1234
```

---

## Переменные окружения

| Переменная | Описание | Обязательна |
|---|---|---|
| `POSTGRES_PASSWORD` | Пароль PostgreSQL | Да |
| `APP_ID` | Kimi OAuth App ID | Да |
| `APP_SECRET` | Kimi OAuth App Secret | Да |
| `KIMI_AUTH_URL` | URL авторизации Kimi | Да |
| `KIMI_OPEN_URL` | URL открытия Kimi | Да |
| `LM_STUDIO_URL` | URL LM Studio сервера | Да |
| `LM_STUDIO_MODEL` | Модель для суммаризации | Нет (default: google/gemma-4-e4b) |
| `CORS_ORIGIN` | Разрешённый origin для CORS | Нет (default: *) |
| `DOMAIN` | Домен для SSL сертификата | Нет (default: science-agent.ru) |
| `LINEAR_WORKER_INTERVAL_MS` | Интервал линейного worker'а между статьями, мс | Нет (default: 600000) |
| `LM_STUDIO_MAX_INPUT_TOKENS` | Макс. входных токенов для LM Studio | Нет (default: 4000) |
| `LM_STUDIO_SUMMARY_MAX_TOKENS` | Макс. токенов краткого саммари | Нет (default: 512) |
| `LM_STUDIO_DETAILED_MAX_TOKENS` | Макс. токенов подробного описания | Нет (default: 1024) |

---

## Безопасность

### Рекомендации

1. **Используйте сильные пароли** для всех сервисов
2. **Включите firewall:**
```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

3. **Настройте автоматические обновления:**
```bash
sudo apt install unattended-upgrades
sudo dpkg-reconfigure unattended-upgrades
```

4. **Регулярно обновляйте Docker образы:**
```bash
docker compose pull
docker compose up -d
```

5. **Мониторьте логи на подозрительную активность:**
```bash
docker compose logs | grep -i "error\|unauthorized\|forbidden"
```

---

## Контакты

По вопросам поддержки обращайтесь к администратору системы.
