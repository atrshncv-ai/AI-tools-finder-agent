#!/bin/bash
# test-e2e.sh — End-to-end test of the Hermes CLI pipeline
#
# Prerequisites:
#   1. PostgreSQL running (docker compose up -d postgres)
#   2. DATABASE_URL set in .env
#   3. ZEN_API_KEY set in .env
#
# Usage:
#   cd app && bash scripts/hermes/test-e2e.sh

set -euo pipefail
cd "$(dirname "$0")/../.."

echo "╔══════════════════════════════════════════════════════╗"
echo "║   Hermes CLI E2E Test — Ralph Loop Smoke Test      ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0

pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; PASS=$((PASS + 1)); }
fail() { echo -e "${RED}✗ FAIL${NC}: $1"; FAIL=$((FAIL + 1)); }
info() { echo -e "${YELLOW}→${NC} $1"; }

# ─── Test 1: Check env vars ──────────────────────────────────────────────────
info "Test 1: Checking environment variables..."
if [ -n "${DATABASE_URL:-}" ]; then
  pass "DATABASE_URL is set"
else
  fail "DATABASE_URL is not set"
  echo "  Set it in app/.env or export DATABASE_URL=postgresql://..."
  exit 1
fi

if [ -n "${ZEN_API_KEY:-}" ]; then
  pass "ZEN_API_KEY is set"
else
  fail "ZEN_API_KEY is not set"
  echo "  Set it in app/.env or export ZEN_API_KEY=..."
  exit 1
fi

# ─── Test 2: DB connection ────────────────────────────────────────────────────
info "Test 2: Testing database connection..."
DB_TEST_OUTPUT=$(npx tsx -e "import { getDb } from './api/queries/connection'; const db = getDb(); console.log('connected')" 2>&1) || true
if echo "$DB_TEST_OUTPUT" | grep -q "connected"; then
  pass "Database connection OK"
else
  fail "Cannot connect to database"
  exit 1
fi

# ─── Test 3: Insert test article ──────────────────────────────────────────────
info "Test 3: Inserting test article..."
TEST_URL="https://arxiv.org/abs/2601.02780"
TEST_TITLE="MiMo-V2-Flash Technical Report"
TEST_SOURCE="arxiv"

# Check if article already exists
EXISTING=$(npx tsx -e "
import { getDb } from './api/queries/connection';
import { news } from '@db/schema';
import { eq } from 'drizzle-orm';
(async () => {
const db = getDb();
const r = await db.select({id: news.id}).from(news).where(eq(news.originalUrl, '$TEST_URL')).limit(1);
console.log(r.length > 0 ? r[0].id : '');
process.exit(0);
})();
" 2>/dev/null)

if [ -n "$EXISTING" ]; then
  ARTICLE_ID=$EXISTING
  info "Test article already exists (ID=$ARTICLE_ID)"
else
  ARTICLE_ID=$(npx tsx -e "
import { getDb } from './api/queries/connection';
import { news } from '@db/schema';
(async () => {
const db = getDb();
const r = await db.insert(news).values({
  title: '$TEST_TITLE',
  summary: 'Test article for E2E pipeline validation',
  originalUrl: '$TEST_URL',
  source: '$TEST_SOURCE',
  publishedAt: new Date(),
  language: 'en',
  status: 'pending',
}).returning({ id: news.id });
console.log(r[0].id);
process.exit(0);
})();
" 2>/dev/null)
  info "Inserted test article (ID=$ARTICLE_ID)"
fi
pass "Test article ready (ID=$ARTICLE_ID)"

# ─── Test 4: fetch-article.ts ─────────────────────────────────────────────────
info "Test 4: Testing fetch-article.ts..."
FETCH_OUTPUT=$(npx tsx scripts/hermes/fetch-article.ts --url "$TEST_URL" 2>/dev/null)
FETCH_LEN=${#FETCH_OUTPUT}
if [ "$FETCH_LEN" -gt 100 ]; then
  pass "fetch-article.ts: fetched $FETCH_LEN chars"
else
  fail "fetch-article.ts: too short ($FETCH_LEN chars)"
fi

# ─── Test 5: manifest-gen.ts ──────────────────────────────────────────────────
info "Test 5: Testing manifest-gen.ts..."
MANIFEST="/tmp/hermes-e2e-manifest.json"
npx tsx scripts/hermes/manifest-gen.ts --output "$MANIFEST" --limit 5 2>/dev/null
if [ -f "$MANIFEST" ]; then
  COUNT=$(python3 -c "import json; m=json.load(open('$MANIFEST')); print(len(m['articles']))" 2>/dev/null || echo "?")
  pass "manifest-gen.ts: created manifest with $COUNT articles"
else
  fail "manifest-gen.ts: manifest not created"
fi

# ─── Test 6: save-summary.ts (--auto) ─────────────────────────────────────────
info "Test 6: Testing save-summary.ts --auto..."
SUMMARY_RESULT=$(npx tsx scripts/hermes/save-summary.ts --id "$ARTICLE_ID" --auto 2>/dev/null) || true
if echo "$SUMMARY_RESULT" | grep -q '"status":"ok"'; then
  pass "save-summary.ts: summarized successfully"
else
  fail "save-summary.ts: failed (output: $SUMMARY_RESULT)"
fi

# ─── Test 7: translate-title.ts (--auto) ──────────────────────────────────────
info "Test 7: Testing translate-title.ts --auto..."
TRANSLATE_RESULT=$(npx tsx scripts/hermes/translate-title.ts --id "$ARTICLE_ID" --auto 2>/dev/null) || true
if echo "$TRANSLATE_RESULT" | grep -q '"status":"ok"'; then
  pass "translate-title.ts: translated successfully"
else
  fail "translate-title.ts: failed (output: $TRANSLATE_RESULT)"
fi

# ─── Test 8: deploy-ready.ts ──────────────────────────────────────────────────
info "Test 8: Testing deploy-ready.ts..."
DEPLOY_OUTPUT=$(npx tsx scripts/hermes/deploy-ready.ts --batch-size 1 2>/dev/null) || true
if echo "$DEPLOY_OUTPUT" | grep -q "Deployed"; then
  pass "deploy-ready.ts: deployed successfully"
else
  fail "deploy-ready.ts: failed (output: $DEPLOY_OUTPUT)"
fi

# ─── Test 9: Verify final status ──────────────────────────────────────────────
info "Test 9: Verifying final article status..."
FINAL_STATUS=$(npx tsx -e "
import { getDb } from './api/queries/connection';
import { news } from '@db/schema';
import { eq } from 'drizzle-orm';
(async () => {
const db = getDb();
const r = await db.select({status: news.status}).from(news).where(eq(news.id, $ARTICLE_ID)).limit(1);
console.log(r[0]?.status || 'unknown');
process.exit(0);
})();
" 2>/dev/null)

if [ "$FINAL_STATUS" = "published" ]; then
  pass "Article #$ARTICLE_ID is now 'published'"
else
  fail "Article #$ARTICLE_ID status is '$FINAL_STATUS' (expected 'published')"
fi

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   Results: $PASS passed, $FAIL failed                  ║"
echo "╚══════════════════════════════════════════════════════╝"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

echo ""
echo "All tests passed! The Hermes CLI pipeline is fully functional."
