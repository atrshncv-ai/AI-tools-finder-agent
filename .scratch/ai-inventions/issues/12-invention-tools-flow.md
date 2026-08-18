# 12 — Обеспечить приток материалов в «Инструменты для изобретений»

Status: done  
Blocked by: none

## Задача

Клиент ожидает, что в разделе «Инструменты для изобретений» появляется всё, что парсится на эту тему. Сейчас там 6 новостей + 10 карточек каталога, не обновлявшихся с 14 августа.

## Где менять

- `app/scripts/hermes/collect-dual.ts` — классификация при сборе.
- `app/api/lib/invention-classify.ts` — правила классификации.
- `app/scripts/hermes/save-summary.ts` — переклассификация после получения summary.
- `app/scripts/hermes/evaluate-news.ts` — не отбрасывать invention-кандидаты из-за общих порогов, если они явно про инструменты/открытия.
- При необходимости — `app/scripts/seed-invention-tools.ts` для обновления каталога.

## Что сделать

1. **Убедиться, что classifyInvention получает максимум контекста:**
   - Для RSS — `title`.
   - Для YouTube — `title + description` (если доступно).
   - После summarize — перепроверить и переназначить section на `invention-tools`, если summary + title содержит invention-термины.
2. **Проверить, что science-статьи с invention-терминами не застревают в `science`:** если `isScience=true` и `classifyInvention` говорит `isInvention`, section должен быть `invention-tools`.
3. **Добавить отдельный источник / усиление сбора** для invention-новостей (arXiv `cs.ET`, `cs.AI` + keyword фильтр, Materials Project блог, MIT Materials Research Laboratory и т.п.) — минимально без новых платных API.
4. **Обновить дату проверки (`lastVerifiedAt`)** у существующих карточек каталога при каждом деплое/пайплайне, чтобы раздел не выглядел «заброшенным с 14 августа».

## Критерий приёмки

- После запуска пайплайна в разделе `invention-tools` появляются свежие новости по теме.
- Карточки каталога показывают актуальную дату проверки.
- Не ухудшается качество: общие AI-новости не попадают в invention-tools.
