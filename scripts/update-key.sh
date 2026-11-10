#!/usr/bin/env bash
# update-key.sh — replace one secret in the env file without restarting the loop.
#
# Usage:
#   scripts/update-key.sh ZEN_GO_API_KEY            # value from stdin (preferred)
#   scripts/update-key.sh ZEN_GO_API_KEY < secret.txt
#   scripts/update-key.sh ZEN_GO_API_KEY 'value'    # value as an argument: stays in shell history
#
# ENV_FILE overrides the file to edit (default: <repo>/app/.env).
# The value is never printed, duplicated or written anywhere except the env file.
# The write is atomic, other lines are preserved and the file is made owner-only.
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: scripts/update-key.sh VARIABLE_NAME [VALUE]
  VARIABLE_NAME  env variable to set, e.g. ZEN_GO_API_KEY or GIGACHAT_CLIENT_SECRET
  VALUE          optional; when omitted the value is read from stdin (not echoed)
  ENV_FILE       env file to edit (default: <repo>/app/.env)
EOF
}

name="${1:-}"
if [ -z "$name" ]; then
  usage
  exit 64
fi
if ! [[ "$name" =~ ^[A-Z_][A-Z0-9_]*$ ]]; then
  echo "update-key: invalid variable name '$name' (expected A-Z, 0-9 and _)" >&2
  exit 64
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
env_file="${ENV_FILE:-${script_dir}/../app/.env}"
if [ ! -f "$env_file" ]; then
  echo "update-key: env file not found: $env_file" >&2
  echo "create it from app/.env.example first, then run this script again" >&2
  exit 66
fi

value="${2-}"
if [ -z "$value" ]; then
  if [ -t 0 ]; then
    read -r -s -p "Value for ${name}: " value
    echo >&2
  else
    value="$(cat)"
  fi
fi
# Normalise line endings; a secret is exactly one line.
while [[ "$value" == *$'\n' ]]; do value="${value%$'\n'}"; done
value="${value%$'\r'}"
if [ -z "$value" ]; then
  echo "update-key: refusing to set an empty value for $name" >&2
  exit 65
fi
if [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
  echo "update-key: the value must be a single line" >&2
  exit 65
fi

tmp="$(mktemp "${env_file}.update.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

found=0
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    "${name}="* | "export ${name}="*)
      # First definition wins; later duplicates of the same name are dropped so
      # no stale value survives in the file.
      if [ "$found" -eq 0 ]; then
        printf '%s=%s\n' "$name" "$value"
        found=1
      fi
      ;;
    *)
      printf '%s\n' "$line"
      ;;
  esac
done < "$env_file" > "$tmp"

if [ "$found" -eq 0 ]; then
  printf '%s=%s\n' "$name" "$value" >> "$tmp"
fi

chmod 600 "$tmp"
mv "$tmp" "$env_file"
trap - EXIT

printf 'updated %s in %s (value hidden)\n' "$name" "$env_file"
