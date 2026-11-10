#!/usr/bin/env bash
# install.sh — bring a clean Ubuntu 24.04 server to a running release.
#
# The script follows docs/DEPLOY.md §2–§7 and does not replace it: the runbook
# explains each step and the manual fallback, this script performs the steps in
# the same order. It is written to be re-runnable: packages are installed only
# when missing, the database role and database are created only when absent,
# and an existing app/.env is never overwritten.
#
# Usage (as root, after the repository is cloned to APP_DIR):
#   sudo bash scripts/deploy/install.sh
#   sudo env DOMAIN=news.example.com TLS_EMAIL=admin@example.com bash scripts/deploy/install.sh
#
# Configuration (environment, all optional except APP_DIR having the repo):
#   APP_DIR     directory of the checkout           (default /srv/news-agent)
#   APP_USER    Linux user that owns the processes  (default deploy)
#   DOMAIN      public dashboard domain; TLS is skipped when empty
#   TLS_EMAIL   Let's Encrypt account email; TLS is skipped when empty
#   DB_NAME     database name                       (default science_agent)
#   DB_USER     database role                       (default science_agent)
#   DB_PASSWORD role password; generated when empty (hex, written to app/.env)
#
# The script does not print secrets: a generated database password is written to
# app/.env (chmod 600) and reported as "written", never echoed.
#
# Exit codes: 1 — a step failed; 69 — a required tool is missing; 77 — not root;
# 78 — the checkout is not where it was told to look.
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/news-agent}"
APP_USER="${APP_USER:-deploy}"
DOMAIN="${DOMAIN:-}"
TLS_EMAIL="${TLS_EMAIL:-}"
DB_NAME="${DB_NAME:-science_agent}"
DB_USER="${DB_USER:-science_agent}"
DB_PASSWORD="${DB_PASSWORD:-}"
LOG_DIR="/var/log/news-agent"
PROXY_PORT="${PORT:-3000}"

step() { printf '\n=== %s ===\n' "$*"; }
ok() { printf '  ok: %s\n' "$*"; }
warn() { printf '  WARN: %s\n' "$*" >&2; }
die() { printf '  ERROR: %s\n' "$*" >&2; exit 1; }

if [ "$#" -gt 0 ]; then
  case "$1" in
    --help|-h)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; exit 64 ;;
  esac
fi

if [ "$(id -u)" -ne 0 ]; then
  printf 'install.sh must run as root: sudo bash scripts/deploy/install.sh\n' >&2
  exit 77
fi

case "$APP_DIR" in
  ""|"/") printf 'ERROR: APP_DIR must be a directory, not "%s"\n' "$APP_DIR" >&2; exit 78 ;;
esac
case "$APP_USER" in
  ""|[!a-z]*|*[!a-z0-9_-]*) printf 'ERROR: APP_USER must match [a-z_][a-z0-9_-]*\n' >&2; exit 78 ;;
esac
case "$DB_USER" in
  ""|[!a-z_]*|*[!a-z0-9_]*) printf 'ERROR: DB_USER must match [a-z_][a-z0-9_]*\n' >&2; exit 78 ;;
esac
case "$DB_NAME" in
  ""|[!a-z_]*|*[!a-z0-9_]*) printf 'ERROR: DB_NAME must match [a-z_][a-z0-9_]*\n' >&2; exit 78 ;;
esac

if [ ! -f "${APP_DIR}/app/package.json" ]; then
  printf 'ERROR: no checkout at %s (expected %s/app/package.json)\n' "$APP_DIR" "$APP_DIR" >&2
  printf 'Clone the repository there first, then run this script again:\n' >&2
  printf '  git clone <your-remote> %s\n' "$APP_DIR" >&2
  exit 78
fi

# ─── 1. base packages ────────────────────────────────────────────────────────
step "1/12 base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  ca-certificates curl gnupg git build-essential python3 \
  postgresql postgresql-contrib \
  nginx certbot python3-certbot-nginx \
  ffmpeg fail2ban ufw rclone unzip openssl sudo gettext-base cron
ok "packages installed"

# The digest and the backup are scheduled in UTC; keep the host on UTC so the
# runbook and the cron table mean the same thing.
timedatectl set-timezone UTC 2>/dev/null || warn "cannot set the timezone to UTC (systemd not running?)"
ok "timezone: $(timedatectl show -p Timezone --value 2>/dev/null || echo unknown)"

# ─── 2. Node.js 20 ───────────────────────────────────────────────────────────
step "2/12 Node.js 20"
node_major="$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/' || true)"
if [ "${node_major:-0}" != "20" ]; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  printf 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main\n' \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs
fi
node_major="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
[ "$node_major" = "20" ] || die "expected Node.js 20, got $(node -v)"
ok "node $(node -v), npm $(npm -v)"

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2 >/dev/null
fi
ok "pm2 $(pm2 -v 2>/dev/null | tail -1)"

# ─── 3. application user ─────────────────────────────────────────────────────
step "3/12 application user"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$APP_USER"
  ok "created user $APP_USER"
else
  ok "user $APP_USER already exists"
fi
if ! id -nG "$APP_USER" | tr ' ' '\n' | grep -qx sudo; then
  usermod -aG sudo "$APP_USER"
  ok "granted sudo to $APP_USER"
fi
install -d -o "$APP_USER" -g "$APP_USER" -m 0755 "$LOG_DIR"
ok "log directory $LOG_DIR"
# A checkout cloned by root is not writable by the application user; npm ci and
# the build run as $APP_USER below.
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
ok "ownership: $APP_DIR belongs to $APP_USER"

# ─── 4. PostgreSQL ───────────────────────────────────────────────────────────
step "4/12 PostgreSQL"
systemctl enable --now postgresql >/dev/null 2>&1 || die "cannot start PostgreSQL"
if [ "$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'")" != "1" ]; then
  if [ -z "$DB_PASSWORD" ]; then
    command -v openssl >/dev/null 2>&1 || die "openssl is required to generate DB_PASSWORD"
    DB_PASSWORD="$(openssl rand -hex 24)"
    DB_PASSWORD_GENERATED=1
  fi
  case "$DB_PASSWORD" in
    *[!A-Za-z0-9_-]*) die "DB_PASSWORD must be URL-safe (letters, digits, - and _) because it lands in DATABASE_URL" ;;
  esac
  sudo -u postgres psql -v ON_ERROR_STOP=1 -qtA \
    -c "CREATE ROLE \"${DB_USER}\" LOGIN PASSWORD '${DB_PASSWORD}'" >/dev/null
  ok "created database role $DB_USER"
else
  ok "database role $DB_USER already exists"
fi
if [ "$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'")" != "1" ]; then
  sudo -u postgres createdb --owner "$DB_USER" "$DB_NAME"
  ok "created database $DB_NAME"
else
  ok "database $DB_NAME already exists"
fi
systemctl enable --now postgresql >/dev/null 2>&1

# ─── 5. environment file ─────────────────────────────────────────────────────
step "5/12 app/.env"
ENV_FILE="${APP_DIR}/app/.env"
if [ ! -f "$ENV_FILE" ]; then
  install -o "$APP_USER" -g "$APP_USER" -m 0600 "${APP_DIR}/app/.env.example" "$ENV_FILE"
  ok "created app/.env from app/.env.example"
else
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ok "app/.env already exists (left as is)"
fi

set_env_value() {
  local file="$1" name="$2" value="$3" tmp
  tmp="$(mktemp "${file}.install.XXXXXX")"
  NAME="$name" VALUE="$value" awk '
    BEGIN { name = ENVIRON["NAME"]; value = ENVIRON["VALUE"]; done = 0 }
    $0 ~ "^" name "=" { print name "=" value; done = 1; next }
    { print }
    END { if (!done) print name "=" value }
  ' "$file" > "$tmp"
  chown "$APP_USER:$APP_USER" "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$file"
}

if [ "${DB_PASSWORD_GENERATED:-0}" = "1" ] || ! grep -qE '^DATABASE_URL=postgresql://[^@]*@localhost' "$ENV_FILE"; then
  if [ -n "${DB_PASSWORD:-}" ]; then
    set_env_value "$ENV_FILE" DATABASE_URL "postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}"
    ok "DATABASE_URL written to app/.env (value hidden)"
  else
    warn "DATABASE_URL was not rewritten; set it by hand in ${ENV_FILE}"
  fi
fi

# The web port the nginx template proxies to comes from the same file the app reads.
file_port="$(grep -E '^PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2 | tr -d '\"' || true)"
if [ -n "${file_port:-}" ]; then
  PROXY_PORT="$file_port"
fi

if [ -n "$DOMAIN" ]; then
  set_env_value "$ENV_FILE" CORS_ORIGIN "https://${DOMAIN}"
  set_env_value "$ENV_FILE" DIGEST_DASHBOARD_URL "https://${DOMAIN}"
  ok "CORS_ORIGIN and DIGEST_DASHBOARD_URL point at https://${DOMAIN}"
fi

# ─── 6. dependencies, type check, build ──────────────────────────────────────
step "6/12 npm ci, type check, build"
as_app() {
  sudo -u "$APP_USER" -H bash -lc "$(printf 'cd %q && %s' "${APP_DIR}/app" "$1")"
}
as_app "npm ci --no-audit --no-fund" || die "npm ci failed"
ok "dependencies installed"
as_app "npm run check" || die "type check failed"
ok "types OK"
as_app "npm run build" || die "build failed"
ok "build finished (dist/boot.js, dist/public)"

# ─── 7. database migrations and seeds ────────────────────────────────────────
step "7/12 migrations and seeds"
as_app "npm run db:migrate" || die "migrations failed"
ok "migrations applied (app/db/migrations, 0000–0011)"
as_app "npm run db:seed" || die "seed failed"
ok "categories and sources seeded"
as_app "npx tsx scripts/seed-ai-science-tools.ts" || die "AI-for-science catalog seed failed"
ok "invention tools catalog seeded"
as_app "npx tsx scripts/seed-invention-tools.ts" || die "invention tools seed failed"
ok "invention tools catalog extended"

# ─── 8. GigaChat trust anchors ───────────────────────────────────────────────
step "8/12 GigaChat TLS anchors"
if bash "${APP_DIR}/scripts/deploy/gigachat-certs.sh" >/dev/null 2>&1; then
  ok "Russian Trusted Root/Sub CA installed"
else
  warn "root certificates were not installed; run sudo bash scripts/deploy/gigachat-certs.sh and follow docs/DEPLOY.md §5"
fi
CA_BUNDLE="/etc/ssl/certs/news-agent-russian-trusted.pem"
if [ -f "$CA_BUNDLE" ] && grep -qE '^NODE_EXTRA_CA_CERTS=' "$ENV_FILE"; then
  set_env_value "$ENV_FILE" NODE_EXTRA_CA_CERTS "$CA_BUNDLE"
  ok "NODE_EXTRA_CA_CERTS written to app/.env"
fi

# ─── 9. PM2 ──────────────────────────────────────────────────────────────────
step "9/12 PM2"
PM2_CMD="$(command -v pm2)"
sudo -u "$APP_USER" -H bash -lc "$(printf 'cd %q && %q startOrReload ecosystem.config.cjs && %q save' "$APP_DIR" "$PM2_CMD" "$PM2_CMD")" \
  || die "pm2 could not start the ecosystem"
ok "processes started: news-agent-web, hermes-ralph-loop"
if ! systemctl is-enabled "pm2-${APP_USER}" >/dev/null 2>&1; then
  env PATH="$PATH" pm2 startup systemd -u "$APP_USER" --hp "/home/${APP_USER}" >/dev/null 2>&1 \
    || warn "pm2 startup was not configured; run 'pm2 startup' and follow the printed command"
fi
systemctl enable "pm2-${APP_USER}" >/dev/null 2>&1 || warn "pm2 systemd unit pm2-${APP_USER} is not enabled"

# ─── 10. cron ────────────────────────────────────────────────────────────────
step "10/12 cron"
APP_DIR="$APP_DIR" APP_USER="$APP_USER" bash "${APP_DIR}/scripts/deploy/cron.sh" \
  || die "cron installation failed"
ok "daily digest (06:00 UTC) and offsite backup (03:30 UTC) scheduled"

# ─── 11. nginx ───────────────────────────────────────────────────────────────
step "11/12 nginx"
if [ -z "$DOMAIN" ]; then
  warn "DOMAIN is empty: nginx site and TLS were not configured (docs/DEPLOY.md §7)"
else
  SITE_FILE="/etc/nginx/sites-available/news-agent"
  install -d -m 0755 /var/www/html
  DOMAIN="$DOMAIN" PROXY_PORT="$PROXY_PORT" \
    envsubst '${DOMAIN} ${PROXY_PORT}' \
    < "${APP_DIR}/scripts/deploy/nginx-site.conf.template" > "$SITE_FILE"
  ln -sfn "$SITE_FILE" /etc/nginx/sites-enabled/news-agent
  rm -f /etc/nginx/sites-enabled/default
  nginx -t >/dev/null 2>&1 || die "nginx rejected the site configuration"
  systemctl reload nginx
  ok "nginx proxies ${DOMAIN} to 127.0.0.1:${PROXY_PORT}"
  if [ -n "$TLS_EMAIL" ]; then
    certbot --nginx --non-interactive --agree-tos --no-eff-email --redirect \
      -m "$TLS_EMAIL" -d "$DOMAIN" >/dev/null || die "certbot failed (docs/DEPLOY.md §7)"
    ok "Let's Encrypt certificate installed, http→https redirect on"
  else
    warn "TLS_EMAIL is empty: HTTPS was not configured; run certbot by hand (docs/DEPLOY.md §7)"
  fi
fi

# ─── 12. health ──────────────────────────────────────────────────────────────
step "12/12 health check"
healthy=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 "http://127.0.0.1:${PROXY_PORT}/health" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 1
done
if [ "$healthy" -ne 1 ]; then
  warn "/health did not answer in 30 s; inspect 'pm2 logs news-agent-web' and docs/DEPLOY.md §11"
  exit 1
fi
ok "/health answers 200 on 127.0.0.1:${PROXY_PORT}"

cat >&2 <<EOF

Installation finished. Remaining manual steps (docs/DEPLOY.md):
  1. Fill the secrets in ${ENV_FILE}: JWT_SECRET, GIGACHAT_CLIENT_ID/
     GIGACHAT_CLIENT_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_CLIENT_CHAT_IDS,
     TELEGRAM_OWNER_CHAT_IDS, BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET,
     BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY.
     The example value of APP_SECRET is a placeholder: set a real secret.
  2. Verify GigaChat from this host: bash scripts/deploy/check-gigachat.sh
  3. Verify the offsite storage:  sudo bash scripts/backup-offsite.sh --dry-run
  4. Close the server:           sudo bash scripts/deploy/harden.sh --user ${APP_USER}
  5. Run one cycle by hand:      cd app && bash scripts/hermes/ralph-loop.sh
EOF
