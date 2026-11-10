#!/usr/bin/env bash
# cron.sh — install the two jobs the server must run without a human.
#
#   06:00 UTC  daily-digest.ts  — the release goes to the client and the owner
#   03:30 UTC  backup-offsite.sh — the database dump leaves the server
#
# Both are plain cron entries under /etc/cron.d/news-agent, so they survive a
# reboot and do not depend on PM2 being up. PM2 owns the web process and the
# pipeline loop; cron owns the clock (docs/DEPLOY.md §8).
#
# The host timezone is set to UTC by scripts/deploy/install.sh, so "06:00" here
# is 06:00 UTC = 09:00 Moscow. Change the timezone and the schedule moves with
# it — the runbook says so.
#
# Usage:
#   sudo bash scripts/deploy/cron.sh
#   sudo bash scripts/deploy/cron.sh --remove
#
# Exit codes: 0 — installed/removed; 64 — bad argument; 77 — not root;
# 78 — the checkout is not where it was told to look.
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/news-agent}"
APP_USER="${APP_USER:-deploy}"
CRON_FILE="/etc/cron.d/news-agent"
LOG_DIR="/var/log/news-agent"

REMOVE=0
case "${1:-}" in
  --remove) REMOVE=1 ;;
  "" ) ;;
  --help|-h) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) printf 'unknown argument: %s\n' "$1" >&2; exit 64 ;;
esac

if [ "$(id -u)" -ne 0 ]; then
  printf 'cron.sh must run as root: sudo bash scripts/deploy/cron.sh\n' >&2
  exit 77
fi

if [ "$REMOVE" -eq 1 ]; then
  rm -f "$CRON_FILE"
  printf 'removed %s\n' "$CRON_FILE"
  exit 0
fi

if [ ! -f "${APP_DIR}/app/package.json" ]; then
  printf 'ERROR: no checkout at %s (expected %s/app/package.json)\n' "$APP_DIR" "$APP_DIR" >&2
  exit 78
fi
if ! id "$APP_USER" >/dev/null 2>&1; then
  printf 'ERROR: user %s does not exist (created by scripts/deploy/install.sh)\n' "$APP_USER" >&2
  exit 78
fi

NPX="$(command -v npx || true)"
if [ -z "$NPX" ]; then
  printf 'ERROR: npx is not on PATH; install Node.js 20 first (scripts/deploy/install.sh)\n' >&2
  exit 69
fi

install -d -o "$APP_USER" -g "$APP_USER" -m 0755 "$LOG_DIR"

# A cron job has no .env in its environment; both commands load app/.env
# themselves (dotenv in the digest, sourcing in the backup script), so the
# working directory is the only thing cron has to get right.
cat > "$CRON_FILE" <<EOF
# Managed by scripts/deploy/cron.sh — do not edit by hand.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAILTO=""
EOF

# Node ignores the system trust store; the digest talks to GigaChat, so the
# cron environment needs the extra anchors that gigachat-certs.sh installs.
if [ -f /etc/ssl/certs/news-agent-russian-trusted.pem ]; then
  printf 'NODE_EXTRA_CA_CERTS=/etc/ssl/certs/news-agent-russian-trusted.pem\n' >> "$CRON_FILE"
fi

cat >> "$CRON_FILE" <<EOF

# Morning digest: client copy + owner copy + service report (docs/DEPLOY.md §8).
0 6 * * * ${APP_USER} cd "${APP_DIR}/app" && "${NPX}" tsx scripts/hermes/daily-digest.ts >> "${LOG_DIR}/digest.log" 2>&1

# Offsite database dump: fails loudly when the storage is not configured.
30 3 * * * ${APP_USER} bash "${APP_DIR}/scripts/backup-offsite.sh" >> "${LOG_DIR}/backup.log" 2>&1
EOF

chown root:root "$CRON_FILE"
chmod 0644 "$CRON_FILE"

if command -v crontab >/dev/null 2>&1; then
  printf 'installed %s:\n' "$CRON_FILE"
else
  printf 'WARN: cron is not installed (apt install cron); the file was written anyway\n' >&2
fi
sed -n '5,20p' "$CRON_FILE"
