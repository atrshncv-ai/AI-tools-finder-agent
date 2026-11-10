#!/usr/bin/env bash
# harden.sh — close the server the way it should have been closed before.
#
# What the previous server lacked (R03.1): SSH password login, an open root
# account and no firewall. This script does exactly five things and refuses to
# do the dangerous one when it would lock the owner out:
#
#   1. SSH: key-only authentication, no root login with a password;
#   2. ufw: deny incoming, allow SSH + HTTP + HTTPS;
#   3. fail2ban: ban an address after five failed SSH logins;
#   4. root password: locked, so an SSH password attempt cannot succeed;
#   5. unattended-upgrades: security updates without a human.
#
# Safety rule: the drop-in that disables password authentication is written
# ONLY when the chosen sudo user already has a non-empty authorized_keys. An
# invalid sshd config is removed before it can be reloaded.
#
# Usage:
#   sudo bash scripts/deploy/harden.sh
#   sudo bash scripts/deploy/harden.sh --user deploy --ssh-port 2222
#   sudo bash scripts/deploy/harden.sh --check
#
# Exit codes: 0 — applied (or --check passed); 64 — bad argument; 77 — not
# root; 78 — a precondition is missing (no key for the sudo user).
set -euo pipefail

SSH_PORT="${SSH_PORT:-22}"
TARGET_USER="${TARGET_USER:-}"
CHECK_ONLY=0
SSHD_DROP_IN="/etc/ssh/sshd_config.d/99-news-agent-hardening.conf"
FAIL2BAN_JAIL="/etc/fail2ban/jail.d/news-agent.local"

step() { printf '\n=== %s ===\n' "$*"; }
ok() { printf '  ok: %s\n' "$*"; }
warn() { printf '  WARN: %s\n' "$*" >&2; }
die() { printf '  ERROR: %s\n' "$*" >&2; exit 1; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --user) TARGET_USER="${2:-}"; shift 2 ;;
    --ssh-port) SSH_PORT="${2:-}"; shift 2 ;;
    --check) CHECK_ONLY=1; shift ;;
    --help|-h) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; exit 64 ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  printf 'harden.sh must run as root: sudo bash scripts/deploy/harden.sh\n' >&2
  exit 77
fi

if [ -z "$TARGET_USER" ]; then
  TARGET_USER="${SUDO_USER:-}"
fi
if [ -z "$TARGET_USER" ] || [ "$TARGET_USER" = "root" ]; then
  die "--user is required (the sudo account that keeps key access); refusing to lock root without one"
fi
if ! id "$TARGET_USER" >/dev/null 2>&1; then
  die "user $TARGET_USER does not exist"
fi
if ! id -nG "$TARGET_USER" | tr ' ' '\n' | grep -qx sudo; then
  die "user $TARGET_USER is not in the sudo group; add it before hardening: usermod -aG sudo $TARGET_USER"
fi

USER_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
AUTHORIZED_KEYS="${USER_HOME}/.ssh/authorized_keys"
if [ ! -s "$AUTHORIZED_KEYS" ]; then
  die "no SSH key in ${AUTHORIZED_KEYS}; password login would be disabled with no way back in.
       Copy your public key first:  ssh-copy-id -p ${SSH_PORT} ${TARGET_USER}@<server>"
fi
ok "key access for $TARGET_USER is present"

if [ "$CHECK_ONLY" -eq 1 ]; then
  step "current state"
  printf '  sshd drop-in:  %s\n' "$( [ -f "$SSHD_DROP_IN" ] && echo present || echo absent )"
  printf '  ssh port:      %s\n' "$SSH_PORT"
  printf '  root password: %s\n' "$(passwd -S root 2>/dev/null | awk '{print $2}' | sed 's/^L$/locked/; s/^P$/set/')"
  printf '  ufw:           %s\n' "$(ufw status 2>/dev/null | head -1 || echo unavailable)"
  printf '  fail2ban sshd: %s\n' "$(fail2ban-client status sshd 2>/dev/null | head -1 || echo unavailable)"
  exit 0
fi

# ─── 1. SSH ──────────────────────────────────────────────────────────────────
step "1/5 SSH: key-only, no password login"
install -d -m 0755 /etc/ssh/sshd_config.d
cat > "$SSHD_DROP_IN" <<EOF
# Managed by scripts/deploy/harden.sh — docs/DEPLOY.md §10.
# Password authentication is off: the previous server was breached through it.
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
MaxAuthTries 3
ClientAliveInterval 300
ClientAliveCountMax 3
EOF

if ! sshd -t 2>/tmp/sshd-test.err; then
  rm -f "$SSHD_DROP_IN"
  cat /tmp/sshd-test.err >&2 || true
  die "sshd rejected the hardening drop-in; it was removed and SSH was not touched"
fi
rm -f /tmp/sshd-test.err
systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || warn "cannot reload sshd; reload it by hand"
ok "sshd reloaded: PasswordAuthentication no, PermitRootLogin prohibit-password"

# ─── 2. ufw ──────────────────────────────────────────────────────────────────
step "2/5 ufw"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow "${SSH_PORT}/tcp" >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ok "incoming: ${SSH_PORT}/tcp, 80/tcp, 443/tcp; everything else denied"

# ─── 3. fail2ban ─────────────────────────────────────────────────────────────
step "3/5 fail2ban"
if [ -d /etc/fail2ban ]; then
  cat > "$FAIL2BAN_JAIL" <<EOF
# Managed by scripts/deploy/harden.sh — docs/DEPLOY.md §10.
[sshd]
enabled = true
port = ${SSH_PORT}
maxretry = 5
findtime = 10m
bantime = 1h
EOF
  systemctl enable --now fail2ban >/dev/null 2>&1 || warn "fail2ban service did not start"
  systemctl restart fail2ban >/dev/null 2>&1 || true
  if fail2ban-client status sshd >/dev/null 2>&1; then
    ok "jail sshd active (5 failed attempts in 10 min = 1 h ban)"
  else
    warn "fail2ban is installed but the sshd jail is not reporting yet"
  fi
else
  warn "fail2ban is not installed (apt install fail2ban) — the jail was not configured"
fi

# ─── 4. root account ─────────────────────────────────────────────────────────
step "4/5 root password"
passwd -l root >/dev/null
ok "root password locked (sudo still works for $TARGET_USER)"

# ─── 5. unattended upgrades ──────────────────────────────────────────────────
step "5/5 unattended upgrades"
if command -v unattended-upgrade >/dev/null 2>&1 || dpkg -s unattended-upgrades >/dev/null 2>&1; then
  systemctl enable --now unattended-upgrades >/dev/null 2>&1 || warn "unattended-upgrades service did not start"
  ok "security updates are installed automatically"
else
  warn "unattended-upgrades is not installed; run: apt install unattended-upgrades"
fi

cat >&2 <<'EOF'

Hardening applied. Verify from ANOTHER terminal before closing the current one:
  ssh -p <port> deploy@<server>            # key login works
  ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no deploy@<server>   # must fail
  ufw status verbose
  fail2ban-client status sshd
  passwd -S root                           # must be L (locked)
EOF
