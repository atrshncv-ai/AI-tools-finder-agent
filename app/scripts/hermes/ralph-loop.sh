#!/bin/bash
# ralph-loop.sh — Hermes Agent autonomous Ralph Loop runner
#
# Implements the loop described in app/skills/news-processor/SKILL.md:
#   manifest-gen → (fetch → save-summary → translate-title → deploy-ready) per article
#   then sleeps LINEAR_WORKER_INTERVAL_MS and repeats forever.
#
# Designed to run under PM2 (interpreter: bash) or as a plain daemon.

set -uo pipefail
cd "$(dirname "$0")/../.."

# Load environment (.env in app/)
if [ -f ./.env ]; then
  set -a
  . ./.env
  set +a
fi

MANIFEST="${HERMES_MANIFEST:-/tmp/hermes-manifest.json}"
LIMIT="${HERMES_MANIFEST_LIMIT:-50}"
INTERVAL_MS="${LINEAR_WORKER_INTERVAL_MS:-600000}"
SLEEP_SECS=$((INTERVAL_MS / 1000))
[ "$SLEEP_SECS" -lt 30 ] && SLEEP_SECS=30

log() { echo "[hermes $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

log "Ralph Loop started (interval=${SLEEP_SECS}s, manifest limit=${LIMIT})"

CYCLE=0
while true; do
  CYCLE=$((CYCLE + 1))
  log "=== Cycle #${CYCLE} started ==="

  # Step 0a: Dual-pipeline collection (tech + science streams, dedup guarded)
  if ! npx tsx scripts/hermes/collect-dual.ts --stream both; then
    log "WARN: collect-dual failed — continuing with existing pending articles"
  fi

  # Step 0b: Hard data-driven scoring (gate > 75, daily cap)
  if ! npx tsx scripts/hermes/evaluate-news.ts --batch --daily-cap "${HERMES_DAILY_CAP:-5}"; then
    log "WARN: evaluate-news failed — continuing"
  fi

  # Step 1: Generate manifest of approved pending articles
  if ! npx tsx scripts/hermes/manifest-gen.ts --output "$MANIFEST" --limit "$LIMIT"; then
    log "ERROR: manifest-gen failed. Sleeping ${SLEEP_SECS}s"
    sleep "$SLEEP_SECS"
    continue
  fi

  COUNT=$(python3 -c "import json; m=json.load(open('$MANIFEST')); print(len(m['articles']))" 2>/dev/null || echo "0")
  if [ "$COUNT" = "0" ] || [ -z "$COUNT" ]; then
    log "No pending articles. Sleeping ${SLEEP_SECS}s"
    sleep "$SLEEP_SECS"
    continue
  fi

  log "Found ${COUNT} pending articles"

  OK=0
  ERR=0
  for i in $(seq 0 $((COUNT - 1))); do
    ARTICLE_ID=$(python3 -c "import json; m=json.load(open('$MANIFEST')); print(m['articles'][$i]['id'])" 2>/dev/null)
    ARTICLE_URL=$(python3 -c "import json; m=json.load(open('$MANIFEST')); print(m['articles'][$i]['originalUrl'])" 2>/dev/null)

    if [ -z "$ARTICLE_ID" ] || [ -z "$ARTICLE_URL" ]; then
      log "WARN: empty article data at index $i — skipping"
      ERR=$((ERR + 1))
      continue
    fi

    log "--- Article #${ARTICLE_ID} ($((i + 1))/${COUNT}) ---"

    # Step 3a: Fetch & clean HTML (validation probe)
    TEXT=$(npx tsx scripts/hermes/fetch-article.ts --url "$ARTICLE_URL" 2>/dev/null)
    if [ $? -ne 0 ] || [ "${#TEXT}" -lt 100 ]; then
      log "fetch FAILED for #${ARTICLE_ID} (len=${#TEXT}) — skipping"
      ERR=$((ERR + 1))
      continue
    fi
    log "fetch OK: ${#TEXT} chars"

    # Step 3b: Summarize via Zen API (saves summary+content, status='summarized')
    if ! npx tsx scripts/hermes/save-summary.ts --id "$ARTICLE_ID" --auto; then
      log "summarize FAILED for #${ARTICLE_ID} — skipping"
      ERR=$((ERR + 1))
      continue
    fi
    log "summarize OK"

    # Step 3c: Translate title via Zen API (status='translated')
    if ! npx tsx scripts/hermes/translate-title.ts --id "$ARTICLE_ID" --auto; then
      log "translate FAILED for #${ARTICLE_ID} — skipping"
      ERR=$((ERR + 1))
      continue
    fi
    log "translate OK"

    # Step 3d: Publish (status='published')
    npx tsx scripts/hermes/deploy-ready.ts --batch-size 1 || log "deploy WARN for #${ARTICLE_ID}"
    log "Article #${ARTICLE_ID} published"
    OK=$((OK + 1))
  done

  log "=== Cycle #${CYCLE} complete: ${OK} published, ${ERR} errors. Sleeping ${SLEEP_SECS}s ==="
  sleep "$SLEEP_SECS"
done
