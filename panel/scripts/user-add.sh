#!/usr/bin/env bash
# VPSManagerPRO panel helper - create a user account + register in users.db.
# Invoked by the panel service via `sudo`. All inputs validated before any
# privileged action. Safe for arbitrary untrusted panel->task input.
set -euo pipefail

DB="/etc/vpsmanagerpro/users.db"
GROUP="vmpusers"
SHELL="/usr/sbin/nologin"

if [ "$#" -ne 6 ]; then
  echo "usage: user-add.sh USER PASS EXPIRY MAXLOGINS BANDWIDTH_GB TYPE" >&2
  exit 64
fi
USER="$1"; PASS="$2"; EXPIRY="$3"; MAXLOGINS="$4"; BW="$5"; TYPE="$6"

# ---- validation -----------------------------------------------------------
case "$USER" in
  ""|*[!A-Za-z0-9_.-]*|root|nobody|systemd-*) echo "invalid username" >&2; exit 65 ;;
esac
[ "$USER" != "${USER// /}" ] && { echo "invalid username" >&2; exit 65; }

[ -n "$PASS" ] || { echo "password may not be empty" >&2; exit 65; }
[ ${#PASS} -ge 6 ] || { echo "password too short (min 6)" >&2; exit 65; }

case "$EXPIRY" in
  never|"") EXPIRY="never" ;;
  [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9])
    if ! date -d "$EXPIRY" >/dev/null 2>&1; then echo "invalid expiry date" >&2; exit 65; fi ;;
  *) echo "invalid expiry (use YYYY-MM-DD or 'never')" >&2; exit 65 ;;
esac

case "$MAXLOGINS" in
  ''|*[!0-9]*) echo "invalid maxlogins (integer)" >&2; exit 65 ;;
esac
[ "$MAXLOGINS" -ge 1 ] || { echo "maxlogins must be >= 1" >&2; exit 65; }

case "$BW" in
  ''|*[!0-9.]*) echo "invalid bandwidth (number)" >&2; exit 65 ;;
esac

case "$TYPE" in
  user|trial) ;;
  *) echo "invalid type (user|trial)" >&2; exit 65 ;;
esac

getent passwd "$USER" >/dev/null 2>&1 && { echo "system user $USER already exists" >&2; exit 66; }

# ---- create system user ---------------------------------------------------
useradd -m -s "$SHELL" "$USER"
usermod -aG "$GROUP" "$USER"
echo "$USER:$PASS" | chpasswd
case "$EXPIRY" in
  never) chage -E -1 "$USER" ;;
  *)     chage -E "$EXPIRY" "$USER" ;;
esac

# ---- register in users.db -------------------------------------------------
mkdir -p "$(dirname "$DB")"
if [ -f "$DB" ]; then
  if awk -F: -v t="$USER" '$1==t{found=1} END{exit(found?0:1)}' "$DB"; then
    userdel -r "$USER" >/dev/null 2>&1 || true
    echo "username already registered in users.db" >&2
    exit 66
  fi
fi
printf '%s:%s:%s:%s:%s:%s\n' "$USER" "$PASS" "$EXPIRY" "$MAXLOGINS" "$BW" "$TYPE" >> "$DB"

# reset bandwidth usage slot so the panel reports from 0
mkdir -p "/etc/vpsmanagerpro/bandwidth"
: > "/etc/vpsmanagerpro/bandwidth/${USER}.usage"
chown root:"$GROUP" "/etc/vpsmanagerpro/bandwidth/${USER}.usage" 2>/dev/null || true
chmod 640 "/etc/vpsmanagerpro/bandwidth/${USER}.usage" 2>/dev/null || true

echo "ok: user $USER created"
exit 0