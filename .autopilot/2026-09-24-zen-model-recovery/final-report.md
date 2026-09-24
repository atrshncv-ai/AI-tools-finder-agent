# Отчёт прогона: восстановление доступности Go-модели

## Готово

- Каталог OpenCode Go проверен: HTTP 200, в нём есть `mimo-v2.5` и `mimo-v2.6-flash`.
- Локальная Go-маршрутизация и default-модель проверены read-only.
- Качество репозитория подтверждено: TypeScript build PASS, Vitest — 26 файлов / 221 тест PASS.
- Production не изменялся: не было restart, deploy, reset, delete или изменения модели/провайдера.
- Зафиксировано, что наличие модели в `/models` не доказывает доступность completion для production key/subscription.

## Что заблокировано

Фактический TypeScript production runtime не удалось надёжно достичь через строгий SSH:

- `factory` остановлен проверкой host key; проверка не обходилась.
- `cntr-mvp` доступен, но не содержит target Node/PM2/runtime.
- Прямой доступ к production host отклонён после строгой BatchMode-проверки.

Поэтому effective endpoint, configured `ZEN_GO_MODEL`, наличие/длина `ZEN_GO_*` в production environment и минимальный `/chat/completions` probe остались неподтверждёнными. Причина runtime-сообщения `Model is unavailable` не установлена.

## Что нужно от тебя

1. Восстановить доверенный read-only SSH-доступ к фактическому TypeScript production runtime через существующий host-key/alias.
2. После этого повторить один безопасный probe; не отключать `StrictHostKeyChecking`.
3. Если probe подтвердит недоступность выбранной модели, отдельно выбрать рабочую модель до любого изменения production.

## Что не вошло

| Что | Почему |
|---|---|
| Доказательство доступности `mimo-v2.6-flash` | фактический production runtime недоступен |
| Смена модели или restart PM2 | нет доказанной причины и отдельного разрешения на deployment в этом прогоне |
| Исправление `science`/`lancet` | отдельная задача |

## Что пошло не по плану

| Что не сработало | Как обработано |
|---|---|
| Каталог показывает модель, но runtime её не принимает | сохранено как расхождение `catalog != completion`; автоматический fallback не добавлен |
| Production host key не совпал | host-key verification не обходился; доступ не weakened |

## Проверки

- `cd app && npx tsc -b` — PASS.
- `cd app && npx vitest run` — PASS, 26/26 файлов, 221/221 тестов.
- Secret-pattern scan по `.autopilot/` — совпадений нет.
- Production changes — none.

## Где что лежит

- Доказательства: `.autopilot/2026-09-24-zen-model-recovery--wip/evidence-01-model-runtime-diagnosis.md`
- Требования и их судьба: `.autopilot/2026-09-24-zen-model-recovery--wip/manifest.md`
- Спецификация: `.autopilot/2026-09-24-zen-model-recovery--wip/spec.md`
- Состояние прогона: `.autopilot/state.js`
- Память проекта: `AGENTS.md`
