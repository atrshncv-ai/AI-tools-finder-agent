# Тикет 04: Fetch-fallback цепочка и аудит Whisper-ключа

Status: done
Blocked by: —

## Проблема

В цикле 25.08 — 4 fetch-ошибки (Cloudflare 403, пейволлы): статьи отклоняются
после 3 попыток одним и тем же способом. `scrapegraph-fallback.ts` — заглушка
(825 байт). Whisper-fallback для YouTube требует `GROQ_API_KEY`; наличие
на проде не проверено — если ключа нет, часть видео отклоняется молча.

## Что сделать

- `fetch-article.ts` / `save-summary.ts fetchAndCleanArticle`: при неуспехе —
  повтор с полноценным браузерным UA (как в collect-dual RSS_UA) и
  `Accept-Language`; затем попытка через r.jina.ai-стиль читалку недоступна —
  поэтому второй попыткой extractor'а берём альтернативный селектор
  (`article`, `main`, JSON-LD `articleBody`) — уже есть в article-content.ts,
  убедиться, что он применяется при втором заходе.
- Реализовать `scrapegraph-fallback.ts` либо удалить его и `subagents.ts`
  (мертвые заглушки вносят ложное впечатление о наличии fallback).
- Факт использования fallback и результат писать в `metrics.fetchFallback`.
- Проверить на проде наличие `GROQ_API_KEY`/`WHISPER_API_KEY`; если ключа
  нет — доложить владельцу с оценкой: сколько видео за неделю отклонено
  по «transcript-unavailable» (запрос к metrics), и что даст ключ.

## Acceptance criteria

- Хотя бы один из ранее падающих URL (Nature/Cloudflare) вытаскивается
  fallback-ом (проверить на 3–5 сохранённых примерах ошибок).
- Мёртвые заглушки удалены или реализованы.
- По Whisper-ключу владельцу доложен факт и рекомендация.
