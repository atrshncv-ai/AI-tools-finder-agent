# ИИ-новостной агент для научного журнала

Автономный сервис для мониторинга, классификации и суммаризации новостей в области искусственного интеллекта и смежных научных направлений.

## Возможности

- Автоматический сбор новостей из RSS, HTML, API и Google News
- ИИ-суммаризация: краткое и подробное описание на русском языке
- Полный перевод статей по запросу
- Лента ИИ-новостей и отдельный раздел «ИИ-инструменты для научной работы»
- Фильтрация по научным направлениям и типам материалов
- Избранное, поиск, индикация непрочитанных статей
- Адаптивный веб-интерфейс с тёмной/светлой темой
- Панель администратора с управлением источниками и пользователями

## Технологии

- Frontend: React 19, Vite 7, TypeScript, TailwindCSS, shadcn/ui, tRPC, React Router 7
- Backend: Hono 4, tRPC 11, Drizzle ORM, PostgreSQL 16
- AI: LM Studio (OpenAI-compatible API)
- Инфраструктура: Docker, Docker Compose, Nginx, Let's Encrypt

## Быстрый старт

```bash
cp .env.example .env
# отредактируйте .env

docker compose -p scienceagent up --build -d
docker compose -p scienceagent exec app npm run db:migrate
docker compose -p scienceagent exec app npm run db:seed
```

## Документация

- [Руководство по развёртыванию](docs/DEPLOY.md)
- [Руководство администратора](docs/ADMIN_GUIDE.md)
- [Руководство пользователя](docs/USER_GUIDE.md)

## Лицензия

Проект разработан для научного журнала.
