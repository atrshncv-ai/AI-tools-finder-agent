#!/usr/bin/env bash
# gigachat-certs.sh — install the Russian Trusted Root/Sub CA on the host.
#
# GigaChat's endpoints (gigachat.devices.sberbank.ru, ngw.devices.sberbank.ru)
# are issued by the Russian Trusted Sub CA. A server with only the Mozilla
# bundle cannot verify them, so the call fails before any credential is used
# (R12.2). Two trust stores have to learn about the CA:
#
#   * the system store — used by curl, openssl and the backup tooling;
#   * the Node runtime — Node ships its own store and ignores the system one
#     unless NODE_EXTRA_CA_CERTS points at a PEM bundle.
#
# The script therefore installs the certificates into the system store, builds
# one PEM bundle at /etc/ssl/certs/news-agent-russian-trusted.pem and prints the
# NODE_EXTRA_CA_CERTS value app/.env must contain. It does not edit app/.env
# itself: scripts/deploy/install.sh does that, and a by-hand run should stay
# explicit.
#
# Sources are the official distribution files. If the vendor moves them, pass
# the new URLs with GIGACHAT_ROOT_CA_URL / GIGACHAT_SUB_CA_URL.
#
# Usage:
#   sudo bash scripts/deploy/gigachat-certs.sh
#   sudo bash scripts/deploy/gigachat-certs.sh --check   # verify what is installed
#
# Exit codes: 0 — installed/verified; 1 — download or verification failed;
# 77 — not root; 78 — the download did not produce a certificate.
set -euo pipefail

ROOT_CA_URL="${GIGACHAT_ROOT_CA_URL:-https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt}"
SUB_CA_URL="${GIGACHAT_SUB_CA_URL:-https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt}"
SYSTEM_DIR="/usr/local/share/ca-certificates"
ROOT_CERT="${SYSTEM_DIR}/russian_trusted_root_ca.crt"
SUB_CERT="${SYSTEM_DIR}/russian_trusted_sub_ca.crt"
BUNDLE="/etc/ssl/certs/news-agent-russian-trusted.pem"
GIGACHAT_HOST="gigachat.devices.sberbank.ru"

step() { printf '\n=== %s ===\n' "$*"; }
ok() { printf '  ok: %s\n' "$*"; }
die() { printf '  ERROR: %s\n' "$*" >&2; exit 1; }

CHECK_ONLY=0
case "${1:-}" in
  --check) CHECK_ONLY=1 ;;
  "" ) ;;
  --help|-h) sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) printf 'unknown argument: %s\n' "$1" >&2; exit 64 ;;
esac

if [ "$(id -u)" -ne 0 ]; then
  printf 'gigachat-certs.sh must run as root: sudo bash scripts/deploy/gigachat-certs.sh\n' >&2
  exit 77
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  step "installed certificates"
  for file in "$ROOT_CERT" "$SUB_CERT" "$BUNDLE"; do
    if [ -s "$file" ]; then
      ok "$file ($(grep -c 'BEGIN CERTIFICATE' "$file") certificate(s))"
    else
      printf '  missing: %s\n' "$file" >&2
    fi
  done
  if [ -s "$BUNDLE" ]; then
    if openssl s_client -connect "${GIGACHAT_HOST}:443" -servername "$GIGACHAT_HOST" \
        -verify_hostname "$GIGACHAT_HOST" -CAfile "$BUNDLE" </dev/null 2>/dev/null \
        | grep -q 'Verify return code: 0'; then
      ok "TLS to ${GIGACHAT_HOST}:443 verifies against the Russian bundle"
      exit 0
    fi
    printf '  TLS verification against %s failed\n' "$GIGACHAT_HOST" >&2
    exit 1
  fi
  exit 1
fi

step "1/4 download"
command -v curl >/dev/null 2>&1 || die "curl is required"
command -v openssl >/dev/null 2>&1 || die "openssl is required"
install -d -m 0755 "$SYSTEM_DIR"
tmp_root="$(mktemp)"; tmp_sub="$(mktemp)"
trap 'rm -f "$tmp_root" "$tmp_sub"' EXIT

curl --fail --silent --show-error --location --max-time 60 -o "$tmp_root" "$ROOT_CA_URL" \
  || die "cannot download the root CA from ${ROOT_CA_URL}"
curl --fail --silent --show-error --location --max-time 60 -o "$tmp_sub" "$SUB_CA_URL" \
  || die "cannot download the sub CA from ${SUB_CA_URL}"
grep -q 'BEGIN CERTIFICATE' "$tmp_root" || die "the downloaded root CA is not a PEM certificate (URL moved?)"
grep -q 'BEGIN CERTIFICATE' "$tmp_sub" || die "the downloaded sub CA is not a PEM certificate (URL moved?)"
ok "downloaded both certificates"

step "2/4 system trust store"
install -m 0644 "$tmp_root" "$ROOT_CERT"
install -m 0644 "$tmp_sub" "$SUB_CERT"
update-ca-certificates >/dev/null
ok "system store updated (update-ca-certificates)"

step "3/4 Node bundle"
cat "$ROOT_CERT" "$SUB_CERT" > "$BUNDLE"
chmod 0644 "$BUNDLE"
ok "bundle: $BUNDLE"

step "4/4 verification"
if openssl s_client -connect "${GIGACHAT_HOST}:443" -servername "$GIGACHAT_HOST" \
    -verify_hostname "$GIGACHAT_HOST" -CAfile "$BUNDLE" </dev/null 2>/dev/null \
    | grep -q 'Verify return code: 0'; then
  ok "TLS to ${GIGACHAT_HOST}:443 verifies against the Russian bundle"
else
  die "TLS verification failed; the endpoint may be unreachable from this host (a Russian IP is required)"
fi

printf '\nAdd this line to app/.env so Node trusts the same anchors:\n\n'
printf 'NODE_EXTRA_CA_CERTS=%s\n\n' "$BUNDLE"
printf 'Then reload the processes that read GigaChat:\n  pm2 restart news-agent-web --update-env\n'
