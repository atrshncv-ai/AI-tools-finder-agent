# Тикет 04: Единая трёхсторонняя маршрутизация секций по полному тексту

Status: done
Blocked by: 02-hard-ai-relevance-gate.md, 03-invention-requires-ai-signal.md

## Проблема

Секция назначается трижды (collect → evaluate → save-summary), но логика в
трёх местах разная, а reroute односторонний (только В invention-tools).
`isScience` после collect не переоценивается: RSS-сниппет без слова «ИИ»
навечно отправляет AI×science новость в `ai-news` — раздел науки пустеет.

## Что сделать

- Создать `app/api/lib/section-resolve.ts`: `resolveSection({title, description,
  content})` → `{ isScience, scienceField, section, sphereTags }`.
  Приоритет: invention ∧ ИИ > science (∧ ИИ) > ai-news. Один источник правды.
- `collect-dual.ts`: заменить локальный блок классификации на resolveSection
  (title + description).
- `evaluate-news.ts`: reroute через resolveSection(title, —, pageText);
  записывать section/sphereTags/isScience/scienceField всегда, двунаправленно.
- `save-summary.ts`: финальная проверка на русском тексте
  (titleRu + summary + originalContent), двунаправленная; удалять сферные теги,
  если статья вышла из invention-tools.
- `parseAgent.ts`: те же два блока классификации заменить на resolveSection.

## Acceptance criteria

- AI×science новость, у которой сниппет был без «ИИ», но полный текст содержит
  сигнал, попадает в `science`.
- Ошибочно перенесённая в invention-tools статья возвращается в правильный
  раздел при появлении полного текста.
- Тесты section-resolve: приоритет секций, двунаправленность, примеры клиента.
