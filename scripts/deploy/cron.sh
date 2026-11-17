#!/usr/bin/env bash
# cron.sh — install the jobs the server must run without a human.
#
# Every time below is Moscow local time: the server lives in Europe/Moscow and
# cron fires by the system clock, so an entry means exactly what a clock in
# Moscow shows. There is no UTC offset to apply here.
#
#   08:00           daily-digest.ts --preview — the owner sees the release early
#   09:00           daily-digest.ts        — the Telegram digest to client and owner
#   every 5 minutes telegram-subscribe.ts  — a new /start gets today's cards at once
#   03:30           backup-offsite.sh      — the database dump leaves the server
#
# All are plain cron entries under /etc/cron.d/news-agent, so they survive a
# reboot and do not depend on PM2 being up. PM2 owns the web process and the
# pipeline loop; cron owns the clock (docs/DEPLOY.md §8). Cards themselves are
# published by the loop as soon as they are summarized — the digest is the only
# daily Telegram job.
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
  --help|-h) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

# The entries below are written in Moscow time, so a host in another zone would
# fire them at some other moment. One warning line, never a failure: the box may
# legitimately be somewhere else and the operator decides what to do.
HOST_TZ="$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || true)"
if [ "${HOST_TZ:-}" != "Europe/Moscow" ]; then
  printf 'WARN: system timezone is %s, not Europe/Moscow — the 08:00/09:00 digest entries follow the host clock\n' \
    "${HOST_TZ:-unknown}" >&2
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

# Morning digest (docs/DEPLOY.md §8), Moscow local time. At 08:00 the owner
# checks the very same client text (`--preview`); at 09:00 it goes to the client
# and the owner gets the copy plus the service report.
0 8 * * * ${APP_USER} cd "${APP_DIR}/app" && "${NPX}" tsx scripts/hermes/daily-digest.ts --preview >> "${LOG_DIR}/digest.log" 2>&1
0 9 * * * ${APP_USER} cd "${APP_DIR}/app" && "${NPX}" tsx scripts/hermes/daily-digest.ts >> "${LOG_DIR}/digest.log" 2>&1

# New subscriber intake: polls getUpdates (timeout=0) and welcomes a /start
# within five minutes instead of waiting for the 09:00 digest.
*/5 * * * * ${APP_USER} cd "${APP_DIR}/app" && "${NPX}" tsx scripts/hermes/telegram-subscribe.ts >> "${LOG_DIR}/subscribe.log" 2>&1

# Offsite database dump at 03:30 Moscow time: fails loudly when the storage is
# not configured.
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
