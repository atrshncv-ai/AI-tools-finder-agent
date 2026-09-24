# Интерфейсы и границы

## Границы, решённые в спецификации

### `remote-model-diagnosis`

- Владеет read-only сбором effective endpoint, configured model, каталога и безопасных runtime-маркеров.
- Публичный результат: `model`, `http`, `runtime_error`, `confidence`, `checked_at`.
- Прячет credentials, тела ответов с секретами, изменение production и управление процессами.

### `pipeline-config`

- Владеет локальным контрактом выбора Go-модели и доказанными изменениями репозитория.
- Публичный результат: проверенный model-selection contract и безопасный next action.
- Прячет автоматический fallback, смену провайдера и неподтверждённые модели.

### `evidence-report`

- Владеет сопоставлением каталога, completion и runtime-ошибок, а также итоговым отчётом.
- Публичный результат: `cause`, `evidence`, `changes`, `confidence`, `next_action`.
- Прячет черновые секретные фрагменты и неподтверждённые гипотезы.

## Правила проекта для исполнителя

- Стек: TypeScript, Node.js, Vitest; production-конвейер — `app/scripts/hermes/`.
- Текущая задача — диагностическая, read-only; production не менять без отдельного явного разрешения.
- Не выводить и не сохранять значения ключей, токенов, паролей или `.env`.
- Не выполнять delete, reset, deploy, restart или публикацию.
- Если причина не доказана, вернуть `BLOCKED` с конкретным следующим read-only шагом, не придумывать исправление.
- Перед commit запускать `cd app && npx tsc -b` и `npx vitest run`.
- Отсутствующая зависимость возвращается как `BLOCKED`, а не устанавливается молча.

## Швы для тестов

- Публичные функции `zenClient` и существующий Go-routing test seam.
- Read-only модельный probe проверяется через безопасные HTTP-классы и фактический model id; response body с credentials не используется как evidence.
