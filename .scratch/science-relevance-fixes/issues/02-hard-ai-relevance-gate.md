# Тикет 02: Жёсткий ИИ-гейт релевантности в evaluate-news

Status: done
Blocked by: 01-unified-score-gate.md

## Проблема

Скоринг измеряет только «важность» (звёзды, точки, tier источника), но не
релевантность продукту. Новости без какой-либо связи с ИИ проходят по баллам
социального/источникового сигнала. Клиент: «он вообще должен отсеивать такие
новости».

## Что сделать

В `evaluate-news.ts`:

- Экспортировать из `app/api/lib/classify.ts` общий предикат
  `hasExplicitAiSignal(text)` (существующий `SCIENCE_AI_PATTERNS` +
  англоязычные термины и названия моделей: gpt, bert, alphafold, transformer,
  diffusion, deepmind и т.п.). Один словарь сигналов для всего конвейера.
- Перед скорингом вычислять `aiSignal` по `title + pageText + github
  description/topics` (для YouTube — по title + description транскрипта).
- Если сигнала нет и источник не «AI by construction» → немедленный reject
  с reason `no-ai-signal` (score 0, критерий `ai-relevance-gate` в breakdown),
  до invention-reroute и начисления баллов.
- Источники «AI by construction»: `openai-blog`, `huggingface-blog`,
  `google-ai-blog`, `github-trending`, `hackernews`, а также dedicated AI
  YouTube-каналы (`DEDICATED_AI_YOUTUBE_SOURCES`). Недедикированные YouTube-
  каналы гейт проходят на общих основаниях (`dedicatedChannel || aiRelevant`).
- Факт проверки сохранять в `metrics.aiSignal` (bool) для аудита.

## Acceptance criteria

- Статья без ИИ-терминов в тексте не может быть опубликована ни в одном разделе.
- Curated AI-источники не теряют пропускную способность.
- Тесты/ручная проверка: примеры клиента («митохондрии», «долгожители») дают
  reject `no-ai-signal`; AlphaFold-новость проходит.
