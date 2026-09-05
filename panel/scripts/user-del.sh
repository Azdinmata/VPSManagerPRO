#!/usr/bin/env bash
# VPSManagerPRO panel helper - remove a user account + drop from users.db.
set -euo pipefail

DB="/etc/vpsmanagerpro/users.db"

if [ "$#" -ne 1 ]; then
  echo "usage: user-del.sh USER" >&2
  exit 64
fi
USER="$1"

case "$USER" in
  ""|*[!A-Za-z0-9_.-]*|root|nobody) echo "invalid username" >&2; exit 65 ;;
esac

# Only delete accounts we have registered (never touch system users).
if ! awk -F: -v t="$USER" '$1==t{found=1} END{exit(found?0:1)}' "$DB"; then
  echo "user $USER is not registered in users.db" >&2
  exit 66
fi

# Kill any live sessions (mirrors the limiter's kick behaviour).
if getent passwd "$USER" >/dev/null 2>&1; then
  pkill -u "$USER" 2>/dev/null || true
  sleep 1
  userdel -r "$USER" 2>/dev/null || true
fi

# Remove from db (preserve comments and other lines).
tmp="$(mktemp)"
awk -F: -v t="$USER" '$1!=t || $1==""{print}' "$DB" > "$tmp" && mv "$tmp" "$DB"

# Clean bandwidth + banner artifacts.
rm -f "/etc/vpsmanagerpro/bandwidth/${USER}.usage" 2>/dev/null || true
rm -rf "/etc/vpsmanagerpro/bandwidth/pidtrack/${USER}"__* 2>/dev/null || true
rm -f "/etc/vpsmanagerpro/banners/${USER}.txt" 2>/dev/null || true

echo "ok: user $USER removed"
exit 0