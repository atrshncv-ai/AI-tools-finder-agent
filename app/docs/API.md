# API Документация

## Обзор

Приложение предоставляет API через tRPC (типизированный RPC) и REST endpoints.

**Базовый URL:** `http://localhost:3000`

**tRPC endpoint:** `/api/trpc`

---

## REST Endpoints

### Healthcheck

```
GET /health
```

**Ответ:**
```json
{
  "status": "ok",
  "ts": 1781714600
}
```

### OAuth Callback

```
GET /api/oauth/callback?code=<auth_code>&state=<state>
```

Обрабатывает callback от Kimi OAuth и перенаправляет на главную страницу.

---

## tRPC API

### Инициализация клиента

```typescript
import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../api/router";

const trpc = createTRPCReact<AppRouter>();
```

### News Router

#### news.list

Получить список новостей с фильтрацией.

**Вход:**
```typescript
{
  isScience?: boolean;      // Фильтр по научным новостям
  categorySlug?: string;    // Фильтр по категории
  search?: string;          // Поиск по ключевым словам
  limit?: number;           // Лимит (1-100, по умолчанию 50)
  offset?: number;          // Смещение
}
```

**Выход:**
```typescript
{
  items: News[];            // Массив новостей
  total: number;            // Общее количество
}
```

**Пример:**
```typescript
const { data } = await trpc.news.list.useQuery({
  isScience: false,
  categorySlug: "new-llm",
  limit: 10
});
```

#### news.byId

Получить детали статьи по ID.

**Вход:**
```typescript
{ id: number }
```

**Выход:**
```typescript
News & { category: Category }
```

#### news.categories

Получить список категорий.

**Вход:**
```typescript
{ type?: "general" | "science" }
```

**Выход:**
```typescript
Category[]
```

#### news.translate

Перевести статью на русский язык.

**Вход:**
```typescript
{ id: number }
```

**Выход:**
```typescript
{ translation: string }
```

---

### Favorite Router

#### favorite.list

Получить список избранных статей (требуется авторизация).

**Выход:**
```typescript
Array<{
  id: number;
  newsId: number;
  createdAt: Date;
  news: {
    id: number;
    title: string;
    summary: string;
    originalUrl: string;
    source: string;
    categorySlug: string;
    tags: string;
    publishedAt: Date;
    isScience: boolean;
    scienceField: string;
  };
}>
```

#### favorite.check

Проверить, находится ли статья в избранном (требуется авторизация).

**Вход:**
```typescript
{ newsId: number }
```

**Выход:**
```typescript
{ isFavorite: boolean }
```

#### favorite.add

Добавить статью в избранное (требуется авторизация).

**Вход:**
```typescript
{ newsId: number }
```

#### favorite.remove

Удалить статью из избранного (требуется авторизация).

**Вход:**
```typescript
{ newsId: number }
```

#### favorite.count

Получить количество избранных статей (требуется авторизация).

**Выход:**
```typescript
{ count: number }
```

---

### Read Status Router

#### readStatus.list

Получить список статусов прочтения (требуется авторизация).

**Выход:**
```typescript
Array<{
  id: number;
  userId: number;
  newsId: number;
  read: boolean;
  readAt: Date | null;
  createdAt: Date;
}>
```

#### readStatus.check

Проверить статус прочтения статьи (требуется авторизация).

**Вход:**
```typescript
{ newsId: number }
```

**Выход:**
```typescript
{ read: boolean }
```

#### readStatus.unreadCount

Получить количество непрочитанных статей (требуется авторизация).

**Выход:**
```typescript
{ count: number }
```

#### readStatus.markRead

Отметить статью как прочитанную (требуется авторизация).

**Вход:**
```typescript
{ newsId: number }
```

#### readStatus.markUnread

Отметить статью как непрочитанную (требуется авторизация).

**Вход:**
```typescript
{ newsId: number }
```

---

### Parser Router

#### parser.parse

Запустить парсинг всех источников (требуется роль Admin).

**Выход:**
```typescript
{
  totalFound: number;    // Всего найдено статей
  totalNew: number;      // Количество новых статей
  errors: string[];      // Список ошибок
}
```

#### parser.summarize

Запустить суммаризацию новых статей (требуется роль Admin).

**Выход:**
```typescript
{
  summarized: number;    // Количество обработанных статей
  errors: string[];      // Список ошибок
}
```

#### parser.logs

Получить последние логи парсинга.

**Выход:**
```typescript
Array<{
  id: number;
  sourceId: number;
  status: string;
  articlesFound: number;
  articlesNew: number;
  errorMessage: string | null;
  createdAt: Date;
}>
```

#### parser.sources

Получить список источников.

**Выход:**
```typescript
Array<{
  id: number;
  name: string;
  url: string;
  type: string;
  config: object;
  enabled: boolean;
  createdAt: Date;
}>
```

#### parser.status

Проверить статус LM Studio.

**Выход:**
```typescript
{ lmStudio: boolean }
```

---

## Типы данных

### News
```typescript
{
  id: number;
  title: string;
  summary: string;
  content: string | null;
  originalUrl: string;
  source: string;
  categoryId: number | null;
  categorySlug: string | null;
  tags: string | null;
  imageUrl: string | null;
  publishedAt: Date;
  isScience: boolean;
  scienceField: string | null;
  createdAt: Date;
}
```

### Category
```typescript
{
  id: number;
  name: string;
  slug: string;
  type: "general" | "science";
  createdAt: Date;
}
```

### User
```typescript
{
  id: number;
  unionId: string;
  name: string | null;
  email: string | null;
  avatar: string | null;
  role: "user" | "admin";
  createdAt: Date;
  updatedAt: Date;
  lastSignInAt: Date;
}
```

---

## Ошибки

### tRPC ошибки

| Код | Описание |
|---|---|
| `UNAUTHORIZED` | Требуется авторизация |
| `FORBIDDEN` | Недостаточно прав |
| `NOT_FOUND` | Ресурс не найден |
| `INTERNAL_SERVER_ERROR` | Внутренняя ошибка сервера |

### HTTP ошибки

| Код | Описание |
|---|---|
| 400 | Неверный запрос |
| 401 | Не авторизован |
| 403 | Доступ запрещён |
| 404 | Не найдено |
| 429 | Слишком много запросов |
| 500 | Внутренняя ошибка сервера |

---

## Rate Limiting

API защищён от злоупотреблений:

- **Лимит:** 100 запросов в минуту на IP
- **Окно:** 60 секунд
- **Эндпоинты:** Все tRPC запросы

При превышении лимита возвращается ошибка 429.
