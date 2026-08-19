# 18 — «Прочитать всё» и общий unread-счётчик: учитывать все опубликованные

Status: ready-for-agent  
Blocked by: none

## Задача

`markAllAsRead` обновляет только существующие строки read_status. У статей без строки статус остаётся «непрочитано» → кнопка «Прочитать всё» не обнуляет бейдж. `getUnreadCount` считает только read_status(read=false) — та же ошибка семантики.

## Где менять

- `app/api/queries/readStatus.ts`

## Что сделать

1. `markAllAsRead`: INSERT недостающих строк read_status(read=true) для всех опубликованных статей с непустым summary (NOT EXISTS), затем UPDATE существующих read=false → read=true.
2. `getUnreadCount`: считать как «опубликовано с summary» MINUS «есть строка read=true» (leftJoin, как в getUnreadCountBySection).

## Критерий приёмки

- После markAllAsRead бейджи во всех разделах = 0.
- Юнит-тест не требуется (SQL-логика), проверяется вручную на проде через tRPC после деплоя.
