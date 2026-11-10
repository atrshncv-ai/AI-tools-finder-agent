#!/bin/bash
# ralph-loop.sh — Hermes Agent autonomous Ralph Loop runner
#
# ONE cycle per UTC calendar day (spec §9): collect → prefilter → judge →
# day budget → summaries → ONE publication. A second run after the day's
# release is committed does nothing until the next UTC day; a run after a
# failure retries the same cycle, which is the only allowed repetition (R19).
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
# Retry delay after a failed/incomplete cycle (the release is committed once
# published, so retries can never create a second release).
RETRY_MS="${LINEAR_WORKER_INTERVAL_MS:-900000}"
RETRY_SECS=$((RETRY_MS / 1000))
[ "$RETRY_SECS" -lt 30 ] && RETRY_SECS=30

log() { echo "[hermes $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

# Read one field out of a JSON line; booleans come out as true/false, null as "".
json_field() {
  python3 -c '
import json, sys
value = json.loads(sys.argv[1]).get(sys.argv[2])
print("" if value is None else (str(value).lower() if isinstance(value, bool) else value))
' "$1" "$2" 2>/dev/null
}

secs_until_utc_midnight() {
  python3 -c '
import datetime
now = datetime.datetime.now(datetime.timezone.utc)
next_midnight = (now + datetime.timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
print(int((next_midnight - now).total_seconds()))
' 2>/dev/null || echo 3600
}

log "Ralph Loop started (one cycle per UTC day, retry=${RETRY_SECS}s, manifest limit=${LIMIT})"

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
    log "ERROR: cannot read the day's cycle state — retry in ${RETRY_SECS}s"
    sleep "$RETRY_SECS"
    continue
  fi

  if [ "$(json_field "$STATUS" released)" = "true" ]; then
    WAIT=$(secs_until_utc_midnight)
    log "Today's release (cycle $(json_field "$STATUS" cycleId), published=$(json_field "$STATUS" published)) is already out — sleeping ${WAIT}s until the next UTC day"
    sleep "$WAIT"
    continue
  fi

  CYCLE=$((CYCLE + 1))
  log "=== Cycle #${CYCLE} started (stage=$(json_field "$STATUS" stage), budget=$(json_field "$STATUS" budget)) ==="

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
    log "ERROR: manifest-gen failed — retry in ${RETRY_SECS}s"
    sleep "$RETRY_SECS"
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
  done

  # Step 3: ONE publication per cycle, capped by the day budget and by the
  # one-release-per-day rule. deploy-ready writes the counters and reports
  # whether anything more can be published today.
  DEPLOY_ERR=$(mktemp)
  DEPLOY_OUT=$(npx tsx scripts/hermes/deploy-ready.ts 2>"$DEPLOY_ERR")
  DEPLOY_CODE=$?
  if [ $DEPLOY_CODE -ne 0 ]; then
    cat "$DEPLOY_ERR" >&2
    rm -f "$DEPLOY_ERR"
    log "ERROR: deploy-ready failed — retry in ${RETRY_SECS}s"
    sleep "$RETRY_SECS"
    continue
  fi
  rm -f "$DEPLOY_ERR"

  log "deploy-ready: published=$(json_field "$DEPLOY_OUT" published)/$(json_field "$DEPLOY_OUT" budget) today, reason=$(json_field "$DEPLOY_OUT" reason)"

  if [ "$(json_field "$DEPLOY_OUT" done)" = "true" ]; then
    WAIT=$(secs_until_utc_midnight)
    log "=== Cycle #${CYCLE} complete: ${OK} summarized, ${ERR} errors, release committed. Next run in ${WAIT}s (next UTC day) ==="
    sleep "$WAIT"
  else
    log "=== Cycle #${CYCLE} incomplete: ${OK} summarized, ${ERR} errors. Retry in ${RETRY_SECS}s ==="
    sleep "$RETRY_SECS"
  fi
done
