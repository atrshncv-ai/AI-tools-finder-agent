# 08 — Показывать дату публикации источника, а не дату публикации на платформе

Status: done  
Blocked by: none

## Задача

В карточках и детальном просмотре дата должна соответствовать `publishedAt` (дата источника), а не `updatedAt` (когда мы опубликовали на платформе).

## Где менять

- `app/src/components/NewsCard.tsx` — строка `new Date(article.updatedAt || article.publishedAt)`.
- `app/src/pages/InventionTools.tsx` — для новостных элементов показывать `publishedAt`, для каталога — `lastVerifiedAt` или `createdAt`.
- `app/src/pages/NewsDetail.tsx` — уже показывает `publishedAt`, проверить и оставить.

## Что сделать

1. В `NewsCard` заменить `updatedAt` на `publishedAt`.
2. В `InventionTools` для элементов из news использовать `publishedAt`; для карточек каталога оставить `lastVerifiedAt` или `createdAt`.
3. Убедиться, что freshness-фильтр (`findAllNews`) всё ещё использует `updatedAt` для «новизны на платформе» — это корректное поведение, но в UI пользователь видит исходную дату.

## Критерий приёмки

- В карточках и деталях дата совпадает с датой источника.
- Фильтр «За сутки / 3 дня / неделя / месяц» по-прежнему работает по дате появления на платформе.
