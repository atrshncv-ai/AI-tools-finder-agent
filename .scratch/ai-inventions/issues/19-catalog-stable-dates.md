# 19 — Стабильные даты каталога: не поднимать updatedAt при верификации

Status: ready-for-agent  
Blocked by: none

## Задача

`deploy-ready.ts` при каждом публикации проставляет lastVerifiedAt=now И updatedAt=now для ВСЕХ карточек каталога (WHERE 1=1). Из-за этого 42 каталог-карточки всплывают наверх списка и проходят фильтр «за сутки», а настоящие новости (например, новость про CRISPR от 18 августа) уходят вниз — клиент её «не видит» без фильтра.

## Где менять

- `app/scripts/hermes/deploy-ready.ts`
- `app/scripts/seed-invention-tools.ts`
- `app/src/pages/InventionTools.tsx` (свежесть каталога — по lastVerifiedAt)
- данные на сервере: `UPDATE invention_tools SET "updatedAt"="createdAt"` (один раз)

## Что сделать

1. deploy-ready: обновлять только lastVerifiedAt (не updatedAt).
2. seed: при refresh существующих — только lastVerifiedAt; updatedAt не трогать.
3. InventionTools: для каталог-карточек свежесть считать по lastVerifiedAt, сортировка объединённого списка — по updatedAt (у каталога он теперь = дата добавления).
4. На сервере один раз выровнять updatedAt каталога по createdAt.

## Критерий приёмки

- Свежие новости invention-tools отображаются выше каталога.
- Повторный запуск deploy-ready/seed не меняет порядок списка.
