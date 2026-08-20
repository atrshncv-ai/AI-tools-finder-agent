# 06 — Очистка мусорных статей из production-БД

Status: ready-for-agent
Blocked by: 05

## Что сделать

Вычистить из production-БД статьи, ошибочно попавшие в разделы из-за старой
классификации, чтобы дашборд и завтрашний дайджест не показывали мусор.

Правила (детерминированные, без LLM):

1. **Сегодняшняя пачка Nature d41586** — статьи с `source` из Nature-новостной
   ленты, опубликованные сегодня паблишером, у которых нет AI-сигнала в
   title+summary → `status='rejected'`, `section='ai-news'` (или rejected для
   science/invention-tools), `digestArchiveSentAt=NOW()` чтобы не попали в архив.
2. **Пул `summarized`** — пере-классифицировать `classifyArticle(title, summary)`
   по новым правилам: те, что больше не проходят science-гейт, → `rejected`.
   Invention-кандидатов, не являющихся реальными инструментами, → `science`
   или `rejected` по AI-сигналу.
3. **Июльские записи в invention-tools** — seed-инструменты (GROMACS, DiffDock,
   id 4177–4188) оставить как есть (это легитимный каталог). Проверить
   остальных: без AI-сигнала и без официального URL инструмента → rejected.

## Безопасность

- Перед UPDATE — SELECT с выводом списка для проверки (dry-run).
- UPDATE только по явным id, полученным из SELECT.
- Бэкап таблицы news не требуется (UPDATE обратим через status), но лог
  всех изменений сохранить в `/var/log/news-agent/cleanup-20260820.log`.
- Не трогать: seed-каталог invention_tools (source='science-seed'/'seed-data'),
  youtube-статьи с саммари, любые записи с AI-сигналом.

## Критерии приёмки

- В `status='published'` за последние 24ч нет статей с July `publishedAt`
  без AI-сигнала.
- Пул `summarized` не содержит статей, не проходящих новый science-гейт.
- Дайджест-прогон в stub-режиме (без TELEGRAM_BOT_TOKEN) показывает чистые секции.
