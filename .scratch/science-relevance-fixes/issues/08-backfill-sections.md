# Тикет 08: Бэкфилл — реклассификация существующих записей

Status: done
Blocked by: 04-unified-section-resolution.md

## Контекст

Предыдущий backfill-скрипт (`5bcea17`) был удалён при откате `0fcbe4f` и на
проде не запускался. В БД остались: карточки в чужих разделах (примеры клиента)
и limbo-бэклог pending 50–65.

## Что сделать

Создать `app/scripts/hermes/backfill-sections.ts`:

- Выборка: статусы `published`, `summarized`, `pending`.
- Для каждой строки `resolveSection({title: originalTitle ?? title,
  description: summary, content: originalContent ?? content})`.
- Diff-режим по умолчанию (dry-run): счётчики переходов секций + до 20 примеров.
- `--apply`: записать section/sphereTags/isScience/scienceField;
  `updatedAt` и `platformPublishedAt` НЕ трогать (не ломать окна свежести
  и дайджест).
- Без удаления строк и без выдуманных значений; отчёт JSON в stdout.

## Acceptance criteria

- Dry-run показывает предсказуемый diff; apply идемпотентен.
- Карточки клиента («митохондрии», «долгожители») получают section вне
  science/invention-tools либо остаются на месте только при реальном ИИ-сигнале.
