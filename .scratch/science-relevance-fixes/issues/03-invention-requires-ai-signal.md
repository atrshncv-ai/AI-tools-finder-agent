# Тикет 03: classifyInvention требует ИИ-сигнал

Status: done
Blocked by: —

## Проблема

`INVENTION_TERMS` матчит бытовую лексику (`терапи`, `клиническ`, `вакцин`,
`препарат`, `лаборатори`, `автономн|самостоятельн`, bare `алгоритм/
optimization`, `discover…`) и не требует признака ИИ. Проверено на примерах
клиента: «инъекция митохондрий» → `invention=true`. Полный текст страницы в
evaluate-news почти всегда содержит хотя бы один терм → массовый ложный reroute.

## Что сделать

В `app/api/lib/invention-classify.ts`:

- Ввести `AI_SIGNAL_TERMS` (переиспользовать словарь из тикета 02 — общий
  предикат `hasExplicitAiSignal`). `isInvention = INVENTION_TERMS ∧ AI-сигнал`.
- Удалить из `INVENTION_TERMS` бытовые триггеры: standalone `клиническ`,
  `вакцин`, `терапи…`, `препарат`, `лаборатори…` (оставить EN `autonomous lab`),
  `автономн…/самостоятельн…`, `алгоритм…/optimization/combinatorial`.
  Группы «Chemistry/Biology/Materials/Quantum/Astronomy/Climate» сохранить —
  при обязательном ИИ-сигнале они безопасны.
- `SPHERES` (теги) не менять.
- Обновить тесты: негативы из обратной связи (митохондрии, долгожители,
  ужины Google), позитивы (AlphaFold RU, «ИИ открыл новый материал»,
  CRISPR + machine learning).

## Acceptance criteria

- Примеры клиента больше не классифицируются как invention.
- Реальные AI-for-science кейсы проходят; существующие тесты зелёные.
