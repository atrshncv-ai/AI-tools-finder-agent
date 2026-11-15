#!/usr/bin/env bash
# install-whisper.sh — install the free offline transcription fallback.
#
# A server without WHISPER_API_KEY/GROQ_API_KEY/OPENAI_API_KEY used to reject
# every video without captions. This script installs faster-whisper
# (CTranslate2) into a dedicated venv and pre-downloads the `small` int8 model
# (~500 MB, about 1 GB peak RAM in int8) so the pipeline can transcribe audio
# locally: 2 CPU cores are enough, no key and no per-request quota.
#
# Idempotent: an existing venv is reused, an installed faster-whisper is not
# reinstalled, and a cached model is not downloaded again.
#
# Usage:
#   sudo bash scripts/deploy/install-whisper.sh
#   sudo WHISPER_MODEL=base bash scripts/deploy/install-whisper.sh
#
# Configuration (environment, all optional):
#   WHISPER_VENV   venv directory                 (default /opt/whisper-venv)
#   WHISPER_MODEL  faster-whisper model to cache  (default small)
#   WHISPER_CACHE  shared model cache             (default /opt/whisper-models)
#   WHISPER_USER   user that owns the model cache (default deploy)
#
# Exit codes: 0 — installed and the model is cached; 1 — a step failed;
# 69 — a required tool is missing; 77 — not root.
set -euo pipefail

VENV_DIR="${WHISPER_VENV:-/opt/whisper-venv}"
MODEL="${WHISPER_MODEL:-small}"
CACHE_DIR="${WHISPER_CACHE:-/opt/whisper-models}"
OWNER="${WHISPER_USER:-deploy}"
PYTHON="${VENV_DIR}/bin/python"

step() { printf '\n=== %s ===\n' "$*"; }
ok() { printf '  ok: %s\n' "$*"; }
warn() { printf '  WARN: %s\n' "$*" >&2; }
die() { printf '  ERROR: %s\n' "$*" >&2; exit 1; }

case "${1:-}" in
  --help|-h) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  "" ) ;;
  *) printf 'unknown argument: %s\n' "$1" >&2; exit 64 ;;
esac

if [ "$(id -u)" -ne 0 ]; then
  printf 'install-whisper.sh must run as root: sudo bash scripts/deploy/install-whisper.sh\n' >&2
  exit 77
fi

case "$VENV_DIR" in /*) ;; *) die "WHISPER_VENV must be an absolute path: $VENV_DIR" ;; esac
case "$CACHE_DIR" in /*) ;; *) die "WHISPER_CACHE must be an absolute path: $CACHE_DIR" ;; esac
case "$MODEL" in
  ""|*[!A-Za-z0-9._-]*) die "WHISPER_MODEL must match [A-Za-z0-9._-]+: $MODEL" ;;
esac

for tool in python3 ffmpeg; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf '  ERROR: required tool is missing: %s\n' "$tool" >&2
    printf '  install it first: apt-get install -y python3 python3-venv ffmpeg\n' >&2
    exit 69
  fi
done

AVAILABLE_KB="$(df -Pk "$(dirname "$VENV_DIR")" | awk 'NR==2 {print $4}')"
if [ -n "$AVAILABLE_KB" ] && [ "$AVAILABLE_KB" -lt 2097152 ]; then
  warn "less than 2 GB free on $(dirname "$VENV_DIR"); venv + model may not fit"
fi

# ─── 1. venv ─────────────────────────────────────────────────────────────────
step "1/3 venv (${VENV_DIR})"
if [ -x "$PYTHON" ]; then
  ok "venv already exists"
else
  if ! python3 -m venv "$VENV_DIR"; then
    printf '  ERROR: python3 -m venv failed; install the venv package:\n' >&2
    printf '    apt-get install -y python3-venv\n' >&2
    exit 1
  fi
  ok "created venv"
fi

# ─── 2. faster-whisper ───────────────────────────────────────────────────────
step "2/3 faster-whisper"
if "$PYTHON" -c "import faster_whisper" >/dev/null 2>&1; then
  ok "faster-whisper already installed"
else
  "$PYTHON" -m pip install --quiet --upgrade pip wheel
  if ! "$PYTHON" -m pip install --quiet "faster-whisper"; then
    die "pip install faster-whisper failed (check network access to PyPI)"
  fi
  ok "faster-whisper installed"
fi
VERSION="$("$PYTHON" -c 'from importlib.metadata import version; print(version("faster-whisper"))' 2>/dev/null || printf 'unknown')"
ok "version: ${VERSION}"

# ─── 3. model ────────────────────────────────────────────────────────────────
step "3/3 model (${MODEL} → ${CACHE_DIR})"
mkdir -p "$CACHE_DIR"
# Download as root, then hand the cache to the pipeline user: huggingface keeps
# lock files and metadata there and must be able to write on later runs. The
# pre-download chown also keeps a failed download recoverable at runtime.
if id "$OWNER" >/dev/null 2>&1; then
  chown -R "$OWNER" "$CACHE_DIR"
fi
HF_HOME="$CACHE_DIR" "$PYTHON" - "$MODEL" "$CACHE_DIR" <<'PY'
import sys
from faster_whisper import WhisperModel

model_name, cache_dir = sys.argv[1], sys.argv[2]
# Constructing the model both downloads (first run) and validates the cache
# (later runs). int8/cpu matches what transcribe_local.py uses at runtime.
WhisperModel(model_name, device="cpu", compute_type="int8", download_root=cache_dir)
print(f"  ok: model {model_name} cached in {cache_dir}", file=sys.stderr)
PY

if id "$OWNER" >/dev/null 2>&1; then
  chown -R "$OWNER" "$CACHE_DIR"
  ok "cache owner: ${OWNER}"
else
  warn "user ${OWNER} not found; cache stays root-owned (set WHISPER_USER)"
fi

# ─── summary ─────────────────────────────────────────────────────────────────
printf '\nLocal transcription is ready:\n'
printf '  python: %s\n' "$PYTHON"
printf '  model:  %s (cache: %s, int8/cpu)\n' "$MODEL" "$CACHE_DIR"
printf '  check:  %s %s --help\n' "$PYTHON" "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/app/scripts/hermes/transcribe_local.py"
printf '  env:    TRANSCRIBE_LOCAL_ENABLED=0 disables it; TRANSCRIBE_LOCAL_MODEL overrides the model\n'
