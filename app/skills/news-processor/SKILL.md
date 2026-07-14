# News Processor — Ralph Loop

Этот файл описывает алгоритм обработки новостей для Hermes Agent.
Hermes выполняет **Ralph Loop** — цикл обработки статей из БД через CLI-скрипты.

## Архитектура

```
manifest-gen.ts  →  fetch-article.ts  →  save-summary.ts  →  translate-title.ts  →  deploy-ready.ts
     ↓                    ↓                     ↓                    ↓                     ↓
  SELECT pending       HTTP fetch +         Zen API call:        Zen API call:          UPDATE status
  FROM news WHERE      cheerio clean        summarizeArticle     translateTitle          → 'published'
  status='pending'     → stdout             → save to DB         → save to DB
```

Все скрипты расположены в `scripts/hermes/`.
Все используют общий модуль подключения к БД: `api/queries/connection.ts`.
AI-вызовы идут через `api/ai/zenClient.ts` (OpenAI-compatible API).

## Ralph Loop — пошаговый алгоритм

### Шаг 1: Генерация манифеста

```bash
cd app && npx tsx scripts/hermes/manifest-gen.ts --output /tmp/manifest.json --limit 50
```

**Что делает:**
- Запрашивает из БД статьи со статусом `pending` и `content=NULL`
- Формирует `manifest.json` с полным списком кандидатов
- Выводит статистику в stderr

**Decision:**
- Если `manifest.json` содержит `articles: []` — **закончить работу** (ожидание следующего запуска)
- Если есть статьи — перейти к Шагу 2

**Пример вывода:**
```
[manifest-gen] Generating manifest (limit=50, scienceOnly=false)...
[manifest-gen] Written 12 articles to /tmp/manifest.json
[manifest-gen] Cycle ID: cycle-2026-07-14T07-58-00-manifest
```

### Шаг 2: Взять первую статью из манифеста

```bash
ARTICLE_ID=$(cat /tmp/manifest.json | python3 -c "import sys,json; m=json.load(sys.stdin); print(m['articles'][0]['id'] if m['articles'] else '')")
ARTICLE_URL=$(cat /tmp/manifest.json | python3 -c "import sys,json; m=json.load(sys.stdin); print(m['articles'][0]['originalUrl'] if m['articles'] else '')")
ARTICLE_TITLE=$(cat /tmp/manifest.json | python3 -c "import sys,json; m=json.load(sys.stdin); print(m['articles'][0]['title'] if m['articles'] else '')")
```

**Decision:**
- Если `ARTICLE_ID` пуст — остановиться
- Иначе — перейти к обработке статьи

### Шаг 3: Цепочка обработки статьи

Для каждой статьи последовательно выполняются 4 скрипта:

#### 3a. Скачивание и очистка HTML

```bash
ARTICLE_TEXT=$(cd app && npx tsx scripts/hermes/fetch-article.ts --url "$ARTICLE_URL" 2>/dev/null)
```

**Что делает:**
- Скачивает HTML по URL
- Удаляет шумовые элементы (навигация, реклама, скрипты)
- Извлекает основной контент через cheerio
- Выводит чистый текст в stdout

**Decision:**
- Если exit code != 0 — залогировать ошибку, перейти к следующей статье (Шаг 2)
- Если текст < 100 символов — залогировать, перейти к следующей статье

#### 3b. Саммаризация через Zen API

```bash
cd app && npx tsx scripts/hermes/save-summary.ts --id "$ARTICLE_ID" --auto
```

**Что делает (auto mode):**
- Берёт статью из БД по ID
- Скачивает и очищает HTML (повторно, для надёжности)
- Вызывает `summarizeArticle()` из `zenClient.ts`
- Сохраняет в БД: `summary`, `content` (detailed), `originalContent`, `status='summarized'`

**Output (JSON в stdout):**
```json
{"status":"ok","articleId":42,"summaryLength":320,"contentLength":1200,"model":"zen-default"}
```

**Decision:**
- Если exit code != 0 — залогировать ошибку, перейти к следующей статье

#### 3c. Перевод заголовка

```bash
cd app && npx tsx scripts/hermes/translate-title.ts --id "$ARTICLE_ID" --auto
```

**Что делает (auto mode):**
- Берёт статью из БД
- Если `language='ru'` — пропускает Zen, использует оригинальный контент
- Иначе вызывает `translateTitle()` из `zenClient.ts`
- Сохраняет в БД: `title` (переведённый), `translation`, `status='translated'`

**Output (JSON в stdout):**
```json
{"status":"ok","articleId":42,"translatedTitle":"Новое открытие в квантовых вычислениях","translationLength":1200}
```

**Decision:**
- Если exit code != 0 — залогировать ошибку, перейти к следующей статье

#### 3d. Публикация

```bash
cd app && npx tsx scripts/hermes/deploy-ready.ts --batch-size 1
```

**Что делает:**
- Находит статьи со статусом `translated`
- Меняет статус на `published`

**Output (текст в stdout):**
```
[deploy-ready] Deploying up to 1 translated articles...
[deploy-ready] Deployed 1/1 articles
```

### Шаг 4: Прогресс и переход к следующей статье

- Залогировать результат обработки статьи (ID, статус, время)
- Вернуться к Шагу 2 (взять следующую статью из манифеста)
- Повторять пока все статьи не обработаны

### Завершение

После обработки всех статей:
- Вывести итоговую статистику (обработано / ошибки / пропущено)
- Завершить работу

## Полный пример Ralph Loop (один проход)

```bash
#!/bin/bash
set -e
cd "$(dirname "$0")/../../app"

MANIFEST="/tmp/hermes-manifest.json"

# Шаг 1: Манифест
echo "=== Step 1: Generate manifest ==="
npx tsx scripts/hermes/manifest-gen.ts --output "$MANIFEST" --limit 50

# Проверяем есть ли статьи
COUNT=$(python3 -c "import json; m=json.load(open('$MANIFEST')); print(len(m['articles']))")
if [ "$COUNT" = "0" ]; then
  echo "No pending articles. Done."
  exit 0
fi

echo "Found $COUNT articles to process"

# Шаг 2-4: Обработка каждой статьи
for i in $(seq 0 $((COUNT - 1))); do
  ARTICLE_ID=$(python3 -c "import json; m=json.load(open('$MANIFEST')); print(m['articles'][$i]['id'])")
  ARTICLE_URL=$(python3 -c "import json; m=json.load(open('$MANIFEST')); print(m['articles'][$i]['originalUrl'])")

  echo ""
  echo "=== Processing article #$ARTICLE_ID ==="

  # 3a: Fetch
  echo "[fetch] Downloading..."
  TEXT=$(npx tsx scripts/hermes/fetch-article.ts --url "$ARTICLE_URL" 2>/dev/null) || {
    echo "[fetch] FAILED - skipping"
    continue
  }
  echo "[fetch] OK: ${#TEXT} chars"

  # 3b: Summarize
  echo "[summarize] Calling Zen API..."
  npx tsx scripts/hermes/save-summary.ts --id "$ARTICLE_ID" --auto 2>/dev/null || {
    echo "[summarize] FAILED - skipping"
    continue
  }
  echo "[summarize] OK"

  # 3c: Translate
  echo "[translate] Translating title..."
  npx tsx scripts/hermes/translate-title.ts --id "$ARTICLE_ID" --auto 2>/dev/null || {
    echo "[translate] FAILED - skipping"
    continue
  }
  echo "[translate] OK"

  # 3d: Deploy
  echo "[deploy] Publishing..."
  npx tsx scripts/hermes/deploy-ready.ts --batch-size 1 2>/dev/null
  echo "[deploy] OK"

  echo "=== Article #$ARTICLE_ID done ==="
done

echo ""
echo "=== Ralph Loop complete ==="
```

## Обработка ошибок

| Скрипт | Тип ошибки | Действие |
|--------|-----------|----------|
| manifest-gen | DB connection | Прервать цикл |
| manifest-gen | Пустой манифест | Завершить (success) |
| fetch-article | HTTP error | Пропустить статью |
| fetch-article | Текст < 100 chars | Пропустить статью |
| save-summary | Zen API unavailable | Прервать цикл |
| save-summary | Garbage output | Пропустить статью |
| translate-title | Zen API unavailable | Прервать цикл |
| translate-title | Empty translation | Использовать оригинал |
| deploy-ready | DB error | Залогировать, продолжить |

## Статусы статей в БД

```
pending → summarized → translated → published
```

| Статус | Описание |
|--------|----------|
| `pending` | Статья найдена парсером, ждёт обработки |
| `summarized` | Получено саммари через Zen API |
| `translated` | Заголовок переведён, контент готов к публикации |
| `published` | Опубликована, видна пользователям |

## Зависимости

- **Node.js** + **tsx** (для запуска .ts файлов)
- **PostgreSQL** (подключение через `DATABASE_URL`)
- **Zen API** (OpenAI-compatible endpoint через `ZEN_BASE_URL`)
- **cheerio** (парсинг HTML)
- **drizzle-orm** (запросы к БД)

## Конфигурация (env)

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/science_agent
ZEN_BASE_URL=https://api.zen.ai/v1
ZEN_API_KEY=your_key_here
ZEN_MODEL=zen-default
ZEN_TIMEOUT_MS=120000
ZEN_MAX_INPUT_TOKENS=6000
ZEN_SUMMARY_MAX_TOKENS=1024
ZEN_DETAILED_MAX_TOKENS=2048
ZEN_TRANSLATION_MAX_TOKENS=4096
```
