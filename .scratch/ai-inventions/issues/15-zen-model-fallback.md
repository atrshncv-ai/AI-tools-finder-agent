# 15 — Фолбэк-модели Zen + извлечение reasoning_content

Status: done  
Blocked by: none

## Задача

Все 4 Zen-ключа получают HTTP 429 (FreeUsageLimitError) на модели `mimo-v2.5-free`. Пайплайн суммаризации мёртв: 99+ pending-статей без саммари. При этом модель `hy3-free` на тех же ключах отвечает 200. Reasoning-модели (hy3-free) при малом max_tokens возвращают пустой `content` и весь текст в `reasoning_content`.

## Где менять

- `app/api/ai/zenClient.ts`

## Что сделать

1. Новая env-переменная `ZEN_FALLBACK_MODELS` (через запятую). Цепочка моделей: `[ZEN_MODEL, ...ZEN_FALLBACK_MODELS]`.
2. В `chatCompletion`: при исчерпании всего пула ключов (quota) для текущей модели — переход к следующей модели, сброс cooldown-карты ключей (квота считается на пару ключ+модель).
3. В `rawChatCompletion`: если `message.content` пуст, брать текст из `message.reasoning_content`.
4. Итоговая ошибка при исчерпании всех моделей обязана содержать «key pool exhausted» (совместимость с тестами).

## Критерий приёмки

- Юнит-тест: первичная модель 429 на всех ключах → запрос уходит на фолбэк-модель и succeeds.
- Юнит-тест: пустой content + заполненный reasoning_content → возвращён текст reasoning.
- На сервере `save-summary --auto` на реальной pending-статье завершается успешно и пишет summary в БД.
