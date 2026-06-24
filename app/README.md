# ИИ-новостной агент для научного журнала

Автоматический сервис для мониторинга и анализа новостей в области искусственного интеллекта. Парсит новости из профильных мировых источников, генерирует краткие аннотации на русском языке и предоставляет удобный веб-интерфейс для чтения.

## Возможности

- **Автоматический парсинг** — ежедневный сбор новостей из 5 источников (ArXiv, TechCrunch, The Verge, Naked Science, AI News)
- **ИИ-суммаризация** — генерация кратких и подробных аннотаций на русском языке через локальную LLM (LM Studio)
- **Полный перевод** — перевод оригинальных статей на русский язык по запросу
- **Избранное** — сохранение интересных статей в закладки
- **Поиск** — полнотекстовый поиск по заголовкам и аннотациям
- **Непрочитанные** — индикация новых статей с badge-счётчиком
- **Научные инструменты** — отдельный раздел для новостей об ИИ-инструментах для научной работы
- **Тёмная/светлая тема** — адаптивный дизайн для desktop и mobile

## Технический стек

| Компонент | Технологии |
|---|---|
| Фронтенд | React 19, Vite 7, TypeScript, TailwindCSS, shadcn/ui |
| API | Hono 4, tRPC 11, Drizzle ORM |
| База данных | PostgreSQL 16 |
| ИИ-компонент | LM Studio (OpenAI-compatible API), google/gemma-4-e4b; локальный перевод через Transformers.js/ONNX |
| Инфраструктура | Docker, Docker Compose, Nginx, Let's Encrypt |

## Быстрый старт

### Предварительные требования

- Node.js 20+
- PostgreSQL 16+ (или Docker)
- LM Studio с моделью `google/gemma-4-e4b` (для ИИ-суммаризации)

### Локальная разработка

1. Клонируйте проект:
```bash
git clone <repository-url>
cd НАУЧНЫЙ АГЕНТ/app
```

2. Установите зависимости:
```bash
npm install
```

3. Настройте переменные окружения:
```bash
cp .env.example .env
# Отредактируйте .env с您的 настройками
```

4. Запустите PostgreSQL (через Docker):
```bash
docker compose up -d postgres
```

5. Примените миграции:
```bash
npm run db:push
```

6. Заполните базу данных тестовыми данными:
```bash
npm run db:seed
```

7. Запустите development-сервер:
```bash
npm run dev
```

Приложение будет доступно по адресу `http://localhost:3000`

### Запуск LM Studio

1. Скачайте и установите [LM Studio](https://lmstudio.ai/)
2. Загрузите модель `google/gemma-4-e4b`
3. Запустите сервер на порту 1234

### Локальный перевод

Полный перевод статей выполняется отдельной локальной моделью перевода (Transformers.js / ONNX), а не общей LLM.
По умолчанию используется `Xenova/opus-mt-en-ru`. Модель скачивается один раз при первом запуске агента перевода и кешируется, после чего работает офлайн.
Настройки: `LOCAL_TRANSLATE_MODEL`, `LOCAL_TRANSLATE_MAX_CHUNK_CHARS`, `LOCAL_TRANSLATE_DEVICE`.

### Docker деплой

```bash
# Клонируйте проект
git clone <repository-url>
cd НАУЧНЫЙ АГЕНТ

# Настройте .env
cp .env.example .env
# Отредактируйте .env

# Запустите деплой
./scripts/deploy.sh
```

### Настройка SSL

```bash
./scripts/setup-ssl.sh your-domain.com admin@email.com
```

## Структура проекта

```
НАУЧНЫЙ АГЕНТ/
├── app/                          # Основное приложение
│   ├── api/                      # Backend (Hono + tRPC)
│   │   ├── ai/                   # AI-клиент (LM Studio)
│   │   ├── lib/                  # Утилиты (logger, rateLimit, cookies)
│   │   ├── parser/               # Модуль парсинга новостей
│   │   ├── scheduler/            # Планировщик задач (cron)
│   │   ├── kimi/                 # OAuth аутентификация
│   │   └── queries/              # Запросы к БД
│   ├── db/                       # Drizzle ORM (схема, миграции)
│   ├── contracts/                # Типы и константы
│   ├── src/                      # Frontend (React)
│   │   ├── components/           # Компоненты
│   │   ├── hooks/                # Хуки
│   │   ├── pages/                # Страницы
│   │   └── providers/            # Провайдеры (tRPC, тема)
│   └── test/                     # Тесты
├── nginx/                        # Конфигурация Nginx
├── scripts/                      # Скрипты деплоя
├── docker-compose.yml            # Docker Compose
└── Dockerfile                    # Docker образ
```

## API Endpoints

### tRPC API

| Метод | Описание | Авторизация |
|---|---|---|
| `news.list` | Список новостей с фильтрацией | Публичный |
| `news.byId` | Детали статьи | Публичный |
| `news.categories` | Список категорий | Публичный |
| `news.translate` | Перевод статьи | Публичный |
| `favorite.list` | Список избранного | Требуется |
| `favorite.add` | Добавить в избранное | Требуется |
| `favorite.remove` | Удалить из избранного | Требуется |
| `readStatus.markRead` | Отметить как прочитанное | Требуется |
| `readStatus.unreadCount` | Количество непрочитанных | Требуется |
| `parser.parse` | Запустить парсинг | Admin |
| `parser.summarize` | Запустить суммаризацию | Admin |
| `parser.status` | Статус LM Studio | Публичный |

### REST Endpoints

| Метод | Путь | Описание |
|---|---|---|
| GET | `/health` | Healthcheck |
| GET | `/api/oauth/callback` | OAuth callback |

## Расписание парсинга

| Задача | Расписание | Описание |
|---|---|---|
| Daily Parse | `0 6 * * *` (06:00) | Основной парсинг всех источников |
| Daily Summarize | `30 6 * * *` (06:30) | Суммаризация новых статей |
| Hourly Parse | `0 */4 * * *` (каждые 4ч) | Дополнительный парсинг |

## Источники новостей

| Источник | Тип | Описание |
|---|---|---|
| ArXiv AI | RSS | Научные статьи по AI |
| TechCrunch AI | HTML | Технологические новости |
| The Verge AI | HTML | AI новости |
| Naked Science | HTML | Научные новости |
| AI News | HTML | AI новости на русском |

## Переменные окружения

```env
# База данных
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/science_agent

# Kimi OAuth
APP_ID=your_app_id
APP_SECRET=your_app_secret
KIMI_AUTH_URL=https://kimi.platform/api/auth
KIMI_OPEN_URL=https://kimi.platform/api/open

# LM Studio
LM_STUDIO_URL=http://localhost:1234
LM_STUDIO_MODEL=google/gemma-4-e4b

# CORS
CORS_ORIGIN=https://your-domain.com
```

## Лицензия

MIT
