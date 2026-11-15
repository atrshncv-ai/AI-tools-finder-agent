#!/bin/bash
# ralph-loop.sh — Hermes Agent autonomous Ralph Loop runner
#
# Continuous cycle: collect → prefilter → judge → day budget → manifest →
# per-article fetch/summarize → publication → pause → repeat. A card publishes
# as soon as it is summarized (ready at 17:00 — published and on the dashboard
# at 17:00); the only cap is DAILY_BUDGET. A cycle that finds nothing to
# publish just pauses LINEAR_WORKER_INTERVAL_MS (15 minutes by default) and
# collects again — the morning Telegram digest stays the only daily job
# (cron, 06:00 UTC).
#
# Response to "куча данных обрабатывалась впустую": evaluation downloads a page
# only for the candidates that passed the cheap prefilter, the LLM judge and
# the day's download budget — see evaluate-news.ts.
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
# Pause between cycles: collection, summaries and publication all repeat on
# this cadence. A failed or empty cycle uses the same pause — there is no
# overnight wait any more.
INTERVAL_MS="${LINEAR_WORKER_INTERVAL_MS:-900000}"
PAUSE_SECS=$((INTERVAL_MS / 1000))
[ "$PAUSE_SECS" -lt 30 ] && PAUSE_SECS=30

log() { echo "[hermes $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

# Read one field out of a JSON line; booleans come out as true/false, null as "".
json_field() {
  python3 -c '
import json, sys
value = json.loads(sys.argv[1]).get(sys.argv[2])
print("" if value is None else (str(value).lower() if isinstance(value, bool) else value))
' "$1" "$2" 2>/dev/null
}

# Publish every card that is summarized right now, within the day's remaining
# budget. Called after each successful summary and once more at the end of the
# cycle, so a card ready at 17:00 is on the dashboard at 17:00.
publish_ready() {
  DEPLOY_ERR=$(mktemp)
  DEPLOY_OUT=$(npx tsx scripts/hermes/deploy-ready.ts 2>"$DEPLOY_ERR")
  DEPLOY_CODE=$?
  if [ $DEPLOY_CODE -ne 0 ]; then
    cat "$DEPLOY_ERR" >&2
    rm -f "$DEPLOY_ERR"
    return $DEPLOY_CODE
  fi
  rm -f "$DEPLOY_ERR"
  log "deploy-ready: published=$(json_field "$DEPLOY_OUT" published), reason=$(json_field "$DEPLOY_OUT" reason)"
}

log "Ralph Loop started (continuous publication, pause=${PAUSE_SECS}s, manifest limit=${LIMIT})"

# Fail fast: a DAILY_BUDGET outside 5..10 is a configuration error, and so is an
# unreachable database. Exit and let PM2 surface the restart instead of running
# a cycle with a silent default (ticket 03 acceptance).
if ! STARTUP_STATUS=$(npx tsx scripts/hermes/publish-budget.ts --status 2>/dev/null); then
  log "ERROR: pipeline configuration is invalid (DAILY_BUDGET range or database access)"
  npx tsx scripts/hermes/publish-budget.ts --status
  exit 1
fi
log "Configuration OK (cycle $(json_field "$STARTUP_STATUS" cycleId), budget=$(json_field "$STARTUP_STATUS" budget))"

CYCLE=0
while true; do
  STATUS=$(npx tsx scripts/hermes/publish-budget.ts --status 2>/dev/null) || STATUS=""
  if [ -z "$STATUS" ]; then
    log "ERROR: cannot read the day's cycle state — retry in ${PAUSE_SECS}s"
    sleep "$PAUSE_SECS"
    continue
  fi

  BUDGET=$(json_field "$STATUS" budget)
  CYCLE=$((CYCLE + 1))
  log "=== Cycle #${CYCLE} started (stage=$(json_field "$STATUS" stage), published $(json_field "$STATUS" published)/${BUDGET} today, remaining $(json_field "$STATUS" remainingBudget)) ==="

  # Step 0a: Dual-pipeline collection (tech + science streams, dedup guarded).
  # The RSS lead is stored in news.summary — stage A and the judge read it.
  if ! npx tsx scripts/hermes/collect-dual.ts --stream both; then
    log "WARN: collect-dual failed — continuing with existing pending articles"
  fi

  # Step 0b: prefilter → judge → day budget → deterministic score.
  if ! npx tsx scripts/hermes/evaluate-news.ts --batch; then
    log "WARN: evaluate-news failed — continuing with already scored articles"
  fi

  # Step 1: Manifest of the day's best approved articles (bounded by DAILY_BUDGET).
  if ! npx tsx scripts/hermes/manifest-gen.ts --output "$MANIFEST" --limit "$LIMIT"; then
    log "ERROR: manifest-gen failed — retry in ${PAUSE_SECS}s"
    sleep "$PAUSE_SECS"
    continue
  fi

  COUNT=$(python3 -c "import json; m=json.load(open('$MANIFEST')); print(len(m['articles']))" 2>/dev/null || echo "0")
  [ -z "$COUNT" ] && COUNT=0
  log "Manifest: ${COUNT} articles within the day budget"

  OK=0
  ERR=0
  for i in $(seq 0 $((COUNT - 1))); do
    ARTICLE_ID=$(python3 -c "import json; m=json.load(open('$MANIFEST')); print(m['articles'][$i]['id'])" 2>/dev/null)
    ARTICLE_URL=$(python3 -c "import json; m=json.load(open('$MANIFEST')); print(m['articles'][$i]['originalUrl'])" 2>/dev/null)
    ARTICLE_CONTENT_LEN=$(python3 -c "import json; m=json.load(open('$MANIFEST')); print(len(m['articles'][$i].get('originalContent') or ''))" 2>/dev/null || echo "0")

    if [ -z "$ARTICLE_ID" ] || [ -z "$ARTICLE_URL" ]; then
      log "WARN: empty article data at index $i — skipping"
      ERR=$((ERR + 1))
      continue
    fi

    log "--- Article #${ARTICLE_ID} ($((i + 1))/${COUNT}) ---"

    # Step 2a: Fetch & clean HTML. YouTube transcript preflight stores reusable
    # originalContent, avoiding a second caption/Whisper request.
    if [ "$ARTICLE_CONTENT_LEN" -ge 100 ]; then
      log "preflight content OK: ${ARTICLE_CONTENT_LEN} chars"
    else
      FETCH_ERR=$(mktemp)
      TEXT=$(npx tsx scripts/hermes/fetch-article.ts --url "$ARTICLE_URL" 2>"$FETCH_ERR")
      FETCH_CODE=$?
      if [ $FETCH_CODE -ne 0 ] || [ "${#TEXT}" -lt 100 ]; then
        cat "$FETCH_ERR" >&2
        FAILURE_ARGS=(--id "$ARTICLE_ID" --stage fetch --reason content-unavailable)
        if [[ "$ARTICLE_URL" =~ (youtube\.com|youtu\.be) ]]; then
          FAILURE_ARGS=(--id "$ARTICLE_ID" --stage fetch --reason youtube-transcript-unavailable --youtube)
        fi
        npx tsx scripts/hermes/record-processing-failure.ts "${FAILURE_ARGS[@]}" || true
        rm -f "$FETCH_ERR"
        log "fetch FAILED for #${ARTICLE_ID} (len=${#TEXT}) — failure recorded"
        ERR=$((ERR + 1))
        continue
      fi
      rm -f "$FETCH_ERR"
      log "fetch OK: ${#TEXT} chars"
    fi

    # Step 2b: One-shot summarize via the LLM (RU title + summary, status='summarized').
    SUMMARY_ERR=$(mktemp)
    if ! npx tsx scripts/hermes/save-summary.ts --id "$ARTICLE_ID" --auto 2>"$SUMMARY_ERR"; then
      cat "$SUMMARY_ERR" >&2
      if grep -qE "Failed to fetch or extract|looks like garbage" "$SUMMARY_ERR"; then
        npx tsx scripts/hermes/record-processing-failure.ts \
          --id "$ARTICLE_ID" --stage extract --reason unusable-content || true
        log "summarize FAILED for #${ARTICLE_ID} — extraction failure recorded"
      else
        npx tsx scripts/hermes/record-processing-failure.ts \
          --id "$ARTICLE_ID" --stage zen --reason unavailable || true
        # The refusal belongs to the counters: no publication, reason visible.
        npx tsx scripts/hermes/publish-budget.ts --reject provider:unavailable || true
        log "summarize FAILED for #${ARTICLE_ID} — provider refusal recorded"
      fi
      rm -f "$SUMMARY_ERR"
      ERR=$((ERR + 1))
      continue
    fi
    rm -f "$SUMMARY_ERR"
    log "summarize OK"
    OK=$((OK + 1))

    # Publish the card now, not at the end of the day: a successful summary is
    # immediately visible on the dashboard. deploy-ready also flushes cards an
    # earlier run left summarized.
    if ! publish_ready; then
      log "ERROR: deploy-ready failed after #${ARTICLE_ID} — card stays summarized, retried later"
      ERR=$((ERR + 1))
    fi
  done

  # Final publication pass: flushes cards left by an earlier run or an earlier
  # failed deploy, and runs even when the manifest was empty. Its output also
  # feeds the cycle's operator line about the day's budget.
  if ! publish_ready; then
    log "ERROR: deploy-ready failed — retry in ${PAUSE_SECS}s"
    sleep "$PAUSE_SECS"
    continue
  fi

  PUBLISHED_TODAY=$(json_field "$DEPLOY_OUT" publishedToday)
  REMAINING=$(json_field "$DEPLOY_OUT" remainingBudget)
  BUDGET=$(json_field "$DEPLOY_OUT" budget)
  [ -z "$PUBLISHED_TODAY" ] && PUBLISHED_TODAY=$(json_field "$STATUS" published)
  [ -z "$REMAINING" ] && REMAINING=$(json_field "$STATUS" remainingBudget)
  [ -z "$BUDGET" ] && BUDGET=$(json_field "$STATUS" budget)
  log "Budget: ${PUBLISHED_TODAY}/${BUDGET} published today, ${REMAINING} left"

  log "=== Cycle #${CYCLE} finished: ${OK} summarized, ${ERR} errors. Next cycle in ${PAUSE_SECS}s ==="
  sleep "$PAUSE_SECS"
done
