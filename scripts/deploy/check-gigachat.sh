#!/usr/bin/env bash
# check-gigachat.sh — prove that GigaChat answers from THIS server.
#
# The acceptance for R12.2 is not "the certificates are installed", it is "the
# call to /chat/completions returns 200 from the server". This script performs
# the same two requests the provider does:
#
#   1. OAuth: POST <auth-url> with client_credentials → access token;
#   2. chat:  POST <api-url> with the token and one short message.
#
# Only the HTTP status and the model name are printed. Neither the token nor a
# response body is echoed: an error body from a gateway may contain credentials
# or request identifiers, so the body is discarded on purpose.
#
# Usage:
#   bash scripts/deploy/check-gigachat.sh
#   ENV_FILE=/srv/news-agent/app/.env bash scripts/deploy/check-gigachat.sh
#
# Exit codes: 0 — 200 on /chat/completions; 1 — the call failed; 69 — a tool is
# missing; 78 — the GigaChat credentials are not configured.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-${REPO_ROOT}/app/.env}"

say() { printf '[check-gigachat] %s\n' "$*" >&2; }

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

missing=""
for name in GIGACHAT_CLIENT_ID GIGACHAT_CLIENT_SECRET; do
  if [ -z "${!name:-}" ]; then
    missing="${missing:+${missing} }${name}"
  fi
done
if [ -n "$missing" ]; then
  say "ERROR: GigaChat credentials are not configured: ${missing}"
  say "Set them in ${ENV_FILE} (names in app/.env.example) and run this script again."
  exit 78
fi

for tool in curl python3 openssl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    say "ERROR: required tool is missing: ${tool}"
    exit 69
  fi
done

AUTH_URL="${GIGACHAT_AUTH_URL:-https://ngw.devices.sberbank.ru:9443/api/v2/oauth}"
API_URL="${GIGACHAT_API_URL:-https://gigachat.devices.sberbank.ru/api/v1/chat/completions}"
SCOPE="${GIGACHAT_SCOPE:-GIGACHAT_API_PERS}"
MODEL="${GIGACHAT_MODEL:-GigaChat}"
BODY_FILE="$(mktemp)"
TOKEN_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE" "$TOKEN_FILE"' EXIT

# Use the extra trust anchors when a Russian bundle was installed, otherwise the
# system store (curl's own default).
CACERT="${NODE_EXTRA_CA_CERTS:-}"
curl_api() {
  if [ -n "$CACERT" ] && [ -f "$CACERT" ]; then
    curl --cacert "$CACERT" "$@"
  else
    curl "$@"
  fi
}
if [ -n "$CACERT" ] && [ -f "$CACERT" ]; then
  say "trust anchors: ${CACERT}"
fi

# ─── 1. OAuth ────────────────────────────────────────────────────────────────
AUTH_STATUS="$(curl_api -sS --max-time 30 \
  -o "$TOKEN_FILE" -w '%{http_code}' \
  -X POST "$AUTH_URL" \
  -H 'Accept: application/json' \
  -H 'RqUID: 00000000-0000-4000-8000-000000000000' \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "${GIGACHAT_CLIENT_ID}:${GIGACHAT_CLIENT_SECRET}" \
  --data-urlencode "scope=${SCOPE}" 2>/dev/null || echo "000")"

if [ "$AUTH_STATUS" != "200" ]; then
  say "ERROR: OAuth failed with HTTP ${AUTH_STATUS} (credentials or the client's scope)"
  say "Check GIGACHAT_CLIENT_ID/GIGACHAT_CLIENT_SECRET and that the app uses scope ${SCOPE}."
  exit 1
fi

TOKEN="$(python3 - "$TOKEN_FILE" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        print(json.load(handle).get("access_token", ""))
except Exception:
    print("")
PY
)"
if [ -z "$TOKEN" ]; then
  say "ERROR: OAuth answered 200 but no access_token was returned"
  exit 1
fi
say "OAuth OK (HTTP 200, token received)"

# ─── 2. chat completions ─────────────────────────────────────────────────────
CHAT_STATUS="$(curl_api -sS --max-time 60 \
  -o "$BODY_FILE" -w '%{http_code}' \
  -X POST "$API_URL" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  --data "$(python3 - "$MODEL" <<'PY'
import json, sys
print(json.dumps({
    "model": sys.argv[1],
    "messages": [{"role": "user", "content": "Ответь одним словом: ok"}],
    "max_tokens": 16,
    "temperature": 0,
}, ensure_ascii=False))
PY
)" 2>/dev/null || echo "000")"

if [ "$CHAT_STATUS" != "200" ]; then
  case "$CHAT_STATUS" in
    401|403) say "ERROR: /chat/completions answered HTTP ${CHAT_STATUS} — configuration error, not quota. Fix the key/scope; a fallback provider would hide the cause." ;;
    402|429) say "ERROR: /chat/completions answered HTTP ${CHAT_STATUS} — quota/rate limit. The free tier is exhausted or the limit is reached." ;;
    *) say "ERROR: /chat/completions answered HTTP ${CHAT_STATUS}" ;;
  esac
  exit 1
fi

ANSWER_OK="$(python3 - "$BODY_FILE" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        data = json.load(handle)
    print("yes" if data.get("choices") else "no")
except Exception:
    print("no")
PY
)"
if [ "$ANSWER_OK" != "yes" ]; then
  say "ERROR: /chat/completions answered 200 but the body has no choices"
  exit 1
fi

say "GigaChat OK: HTTP 200 on /chat/completions (model ${MODEL})"
