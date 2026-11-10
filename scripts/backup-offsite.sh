#!/usr/bin/env bash
# backup-offsite.sh — PostgreSQL dump that leaves the server, and the same
# storage used to get it back.
#
# Why this exists: on the previous server the database died together with the
# host, because the only copy of the backup lived on that same host. A backup
# is only a backup when it is stored somewhere else (R03). This script dumps
# the database, uploads the dump to an S3-compatible bucket with rclone and
# then verifies that the object in the bucket has the same size as the local
# file. It refuses to report success when the storage is not configured: the
# old script printed "Backup saved" and wrote a file nobody would ever find.
#
# Modes:
#   (default)            dump + upload + verify        → cron, 03:30 UTC
#   --dry-run            check configuration, print the target, do nothing
#   --list               list objects in the storage (what can be restored)
#   --fetch <file>       download one object to --dest (default /srv/restore)
#
# Configuration (app/.env or the environment):
#   DATABASE_URL                   required for a dump
#   BACKUP_S3_ENDPOINT             required for every mode
#   BACKUP_S3_BUCKET               required
#   BACKUP_S3_ACCESS_KEY_ID        required — credential NAME in the example;
#   BACKUP_S3_SECRET_ACCESS_KEY    required   the value lives only in app/.env
#   BACKUP_S3_REGION               optional
#   BACKUP_S3_PREFIX               optional — key prefix, default news-agent
#   BACKUP_STATUS_FILE             optional — default $HOME/.news-agent/last-backup.json
#   BACKUP_TMP_DIR                 optional — where the dump is written first
#   BACKUP_RESTORE_DIR             optional — where --fetch downloads, default /srv/restore
#   ENV_FILE                       optional — default <repo>/app/.env
#
# Nothing read from the environment is printed: no secrets, no connection
# string. rclone gets the credentials through its env configuration, so they do
# not appear in `ps` either.
#
# Restore (procedure: docs/DEPLOY.md §9):
#   bash scripts/backup-offsite.sh --list
#   sudo bash scripts/backup-offsite.sh --fetch science-agent-20261110T033000Z.sql.gz
#   gunzip -t /srv/restore/<file>
#   createdb news_agent_restore_check
#   gunzip -c /srv/restore/<file> | psql postgresql://…/news_agent_restore_check
#
# Exit codes: 0 — done and verified; 1 — dump failed; 2 — upload/download or
# verification failed; 64 — bad argument; 69 — a required tool is missing;
# 78 — configuration is incomplete (the documented "not a success" path).
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_NAME="offsite"
MIN_DUMP_BYTES=1024

say() { printf '[backup-offsite] %s\n' "$*" >&2; }

usage() {
  cat >&2 <<'EOF'
usage: scripts/backup-offsite.sh [mode]

  (default)            dump the database, upload it, verify the object size
  --dry-run            validate the configuration and print the target
  --list               list the objects stored offsite
  --fetch <file>       download one object to --dest (default /srv/restore)
  --dest <dir>         destination for --fetch (default /srv/restore)
  --help               this text

Required for a dump: DATABASE_URL and BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET,
BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY.
See app/.env.example and docs/DEPLOY.md §9.
EOF
}

MODE="backup"
FETCH_NAME=""
DEST=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) MODE="dry-run" ;;
    --list) MODE="list" ;;
    --fetch)
      MODE="fetch"
      FETCH_NAME="${2:-}"
      [ -n "$FETCH_NAME" ] || { usage; say "--fetch needs a file name"; exit 64; }
      shift
      ;;
    --dest)
      DEST="${2:-}"
      [ -n "$DEST" ] || { usage; say "--dest needs a directory"; exit 64; }
      shift
      ;;
    --help|-h) usage; exit 0 ;;
    *) usage; say "unknown argument: $1"; exit 64 ;;
  esac
  shift
done

ENV_FILE="${ENV_FILE:-${REPO_ROOT}/app/.env}"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a
  # An env file is assignments only; sourcing is how the pipeline loop reads it.
  . "$ENV_FILE"
  set +a
fi

# $HOME is not reliable under `sudo -u`: use the target account's home so a
# by-hand run and the cron job write the same status file.
status_home="$(getent passwd "$(id -un)" | cut -d: -f6 2>/dev/null || true)"
[ -n "$status_home" ] || status_home="${HOME:-/tmp}"
status_file="${BACKUP_STATUS_FILE:-${status_home}/.news-agent/last-backup.json}"
PREFIX="${BACKUP_S3_PREFIX:-news-agent}"
PREFIX="${PREFIX#/}"; PREFIX="${PREFIX%/}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILENAME="science-agent-${TIMESTAMP}.sql.gz"
if [ -n "$PREFIX" ]; then
  REMOTE_DIR="${REMOTE_NAME}:${BACKUP_S3_BUCKET:-}/${PREFIX}"
else
  REMOTE_DIR="${REMOTE_NAME}:${BACKUP_S3_BUCKET:-}"
fi
REMOTE_TARGET="${REMOTE_DIR}/${FILENAME}"

# ─── configuration ────────────────────────────────────────────────────────────
REQUIRED="BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY"
if [ "$MODE" = "backup" ] || [ "$MODE" = "dry-run" ]; then
  REQUIRED="DATABASE_URL ${REQUIRED}"
fi

MISSING=""
for name in $REQUIRED; do
  if [ -z "${!name:-}" ]; then
    MISSING="${MISSING:+${MISSING} }${name}"
  fi
done

# rclone reads the S3 remote from these variables: credentials never reach the
# command line (and therefore never reach `ps` or the shell history).
configure_remote() {
  export RCLONE_CONFIG_OFFSITE_TYPE=s3
  export RCLONE_CONFIG_OFFSITE_PROVIDER=Other
  export RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
  export RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
  export RCLONE_CONFIG_OFFSITE_ENDPOINT="$BACKUP_S3_ENDPOINT"
  export RCLONE_CONFIG_OFFSITE_FORCE_PATH_STYLE=true
  if [ -n "${BACKUP_S3_REGION:-}" ]; then
    export RCLONE_CONFIG_OFFSITE_REGION="$BACKUP_S3_REGION"
  fi
}

write_status() {
  local state="$1" code="$2" message="$3" file="${4:-}" bytes="${5:-0}" sha="${6:-}" remote="${7:-}"
  mkdir -p "$(dirname "$status_file")" 2>/dev/null || true
  python3 - "$status_file" "$state" "$code" "$message" "$file" "$bytes" "$sha" "$remote" <<'PY' || true
import json, os, sys, tempfile, datetime
path, state, code, message, file_name, size, sha, remote = sys.argv[1:9]
payload = {
    "status": state,
    "exitCode": int(code),
    "message": message,
    "file": file_name or None,
    "bytes": int(size or 0),
    "sha256": sha or None,
    "remote": remote or None,
    "finishedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}
directory = os.path.dirname(path) or "."
os.makedirs(directory, exist_ok=True)
fd, tmp = tempfile.mkstemp(dir=directory, prefix=".last-backup.")
with os.fdopen(fd, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, ensure_ascii=False)
    handle.write("\n")
os.chmod(tmp, 0o600)
os.replace(tmp, path)
PY
}

die() {
  local code="$1"; shift
  local message="$*"
  say "ERROR: $message"
  if [ "$MODE" = "backup" ]; then
    write_status "failed" "$code" "$message"
  fi
  exit "$code"
}

if [ -n "$MISSING" ]; then
  say "ERROR: offsite storage is not configured — no backup was made."
  say "Missing variables: ${MISSING}"
  say "Set them in ${ENV_FILE} (names in app/.env.example), then run this script again."
  say "A backup that stays on this server dies with this server: refusing to report success."
  if [ "$MODE" = "backup" ]; then
    write_status "failed" 78 "offsite storage is not configured: ${MISSING}"
  fi
  exit 78
fi

# ─── list / fetch: the same storage, no database needed ──────────────────────
configure_remote

if [ "$MODE" = "list" ]; then
  command -v rclone >/dev/null 2>&1 || die 69 "required tool is missing: rclone (docs/DEPLOY.md §2)"
  command -v python3 >/dev/null 2>&1 || die 69 "required tool is missing: python3 (docs/DEPLOY.md §2)"
  if ! rclone lsjson "$REMOTE_DIR" --files-only --log-level ERROR > /tmp/backup-list.$$ 2>/dev/null; then
    rm -f "/tmp/backup-list.$$"
    die 2 "cannot list ${REMOTE_NAME}:/${BACKUP_S3_BUCKET}/${PREFIX} — check the endpoint, bucket and keys"
  fi
  python3 - "/tmp/backup-list.$$" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    objects = json.load(handle)
if not objects:
    print("no objects stored offsite yet")
else:
    for item in sorted(objects, key=lambda entry: entry.get("Name", "")):
        print(f"{item.get('Name', '?')}\t{item.get('Size', 0)} bytes\t{item.get('ModTime', '')}")
PY
  rm -f "/tmp/backup-list.$$"
  exit 0
fi

if [ "$MODE" = "fetch" ]; then
  case "$FETCH_NAME" in
    */*|*..*) die 64 "the file name must be a plain object name, not a path" ;;
  esac
  command -v rclone >/dev/null 2>&1 || die 69 "required tool is missing: rclone (docs/DEPLOY.md §2)"
  command -v gzip >/dev/null 2>&1 || die 69 "required tool is missing: gzip (docs/DEPLOY.md §2)"
  DEST="${DEST:-${BACKUP_RESTORE_DIR:-/srv/restore}}"
  mkdir -p "$DEST" 2>/dev/null || die 2 "cannot create ${DEST}; run with sudo or pass --dest"
  if ! rclone copyto "${REMOTE_DIR}/${FETCH_NAME}" "${DEST}/${FETCH_NAME}" --log-level ERROR; then
    die 2 "download failed: ${FETCH_NAME} (does it exist? see --list)"
  fi
  gzip -t "${DEST}/${FETCH_NAME}" || die 2 "the downloaded file is not a valid gzip stream"
  BYTES="$(wc -c < "${DEST}/${FETCH_NAME}" | tr -d ' ')"
  say "downloaded ${FETCH_NAME} (${BYTES} bytes) to ${DEST}"
  printf '%s\n' "next: createdb news_agent_restore_check && gunzip -c ${DEST}/${FETCH_NAME} | psql postgresql://…/news_agent_restore_check"
  exit 0
fi

# ─── dry run / dump + upload ─────────────────────────────────────────────────
if [ "$MODE" = "dry-run" ]; then
  say "configuration OK (dry run, nothing was dumped or uploaded)"
  say "target: ${REMOTE_TARGET}"
  say "status file: ${status_file}"
  exit 0
fi

for tool in pg_dump gzip rclone python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    die 69 "required tool is missing: ${tool} (docs/DEPLOY.md §2: sudo bash scripts/deploy/install.sh)"
  fi
done

umask 077
TMP_DIR="${BACKUP_TMP_DIR:-${TMPDIR:-/tmp}}"
mkdir -p "$TMP_DIR" || die 1 "cannot create the temporary directory ${TMP_DIR}"
DUMP_PATH="${TMP_DIR}/${FILENAME}"

cleanup() { rm -f "$DUMP_PATH" "/tmp/backup-list.$$"; }
trap cleanup EXIT

say "dumping the database"
if ! pg_dump --dbname="$DATABASE_URL" --no-owner --no-privileges | gzip -9 > "$DUMP_PATH"; then
  die 1 "pg_dump failed — the dump is incomplete and was not uploaded"
fi

if ! gzip -t "$DUMP_PATH"; then
  die 1 "the dump is not a valid gzip stream — it was not uploaded"
fi

BYTES="$(wc -c < "$DUMP_PATH" | tr -d ' ')"
if [ "${BYTES:-0}" -lt "$MIN_DUMP_BYTES" ]; then
  die 1 "the dump is ${BYTES} bytes, smaller than the ${MIN_DUMP_BYTES}-byte floor — it was not uploaded"
fi

if command -v sha256sum >/dev/null 2>&1; then
  SHA256="$(sha256sum "$DUMP_PATH" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  SHA256="$(shasum -a 256 "$DUMP_PATH" | awk '{print $1}')"
else
  SHA256=""
fi

say "uploading ${FILENAME} (${BYTES} bytes) to ${REMOTE_NAME}:/${BACKUP_S3_BUCKET}/${PREFIX}/"
if ! rclone copyto "$DUMP_PATH" "$REMOTE_TARGET" --log-level ERROR; then
  die 2 "upload failed — the dump exists only on this server, which is not a backup"
fi

REMOTE_BYTES="$(rclone size --json "$REMOTE_TARGET" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("bytes", 0))' 2>/dev/null || echo 0)"
if [ "${REMOTE_BYTES:-0}" != "$BYTES" ]; then
  die 2 "verification failed: local ${BYTES} bytes, object in storage ${REMOTE_BYTES:-0} bytes"
fi

write_status "ok" 0 "uploaded and verified" "$FILENAME" "$BYTES" "$SHA256" "$REMOTE_TARGET"
python3 - "$FILENAME" "$BYTES" "$SHA256" "$REMOTE_TARGET" "$status_file" <<'PY'
import json, sys
file_name, size, sha, remote, status_file = sys.argv[1:6]
print(json.dumps({
    "status": "ok",
    "file": file_name,
    "bytes": int(size),
    "sha256": sha or None,
    "remote": remote,
    "statusFile": status_file,
}, ensure_ascii=False))
PY
say "done: ${FILENAME} is stored outside this server"
