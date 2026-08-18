# 09 — Счётчики непрочитанных во всех разделах

Status: done  
Blocked by: none

## Задача

Добавить бейджи непрочитанных новостей в «ИИ для науки» и «Инструменты для изобретений» в шапке и мобильной навигации. Сейчас счётчик есть только у «ИИ-новости».

## Где менять

- `app/api/queries/readStatus.ts` — добавить `getUnreadCountBySection(userId, section)`.
- `app/api/readStatusRouter.ts` — добавить процедуру `unreadCountBySection`.
- `app/src/components/Header.tsx` — добавить бейджи для `/science` и `/inventions`.
- `app/src/components/BottomNav.tsx` — заменить `badge: 0` для «Наука» на реальный счётчик.
- `app/src/pages/Home.tsx`, `Science.tsx`, `InventionTools.tsx` — убрать/исправить локальный `unreadCount` (сейчас он считает только текущую страницу и не учитывает отсутствующие строки read_status).

## Что сделать

1. Новая функция на бэкенде считает опубликованные статьи, для которых нет записи `read_status` с `read=true` у данного пользователя, фильтруя по `section`.
2. Добавить роут `readStatus.unreadCountBySection({ section })`.
3. В `Header` и `BottomNav` запросить счётчики для `ai-news`, `science`, `invention-tools`.
4. Убрать из `Home.tsx` локальный пересчёт (`items.filter(...)`), заменить на данные от бэкенда.

## Критерий приёмки

- В шапке и мобильном меню у всех трёх разделов показываются актуальные счётчики непрочитанных.
- Счётчик уменьшается при открытии новости.
- «Отметить все прочитанными» работает для всех разделов.
