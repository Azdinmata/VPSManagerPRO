#!/usr/bin/env bash
# VPSManagerPRO panel helper - update attributes of a registered user.
# Only touches fields passed as --flags. Never modifies a system-only user.
set -euo pipefail

DB="/etc/vpsmanagerpro/users.db"
GROUP="vmpusers"

if [ "$#" -lt 1 ]; then
  echo "usage: user-update.sh USER [--password=..] [--expiry=..] [--maxlogins=..] [--bandwidth=..] [--type=..] [--lock|--unlock]" >&2
  exit 64
fi
USER="$1"; shift

case "$USER" in
  ""|*[!A-Za-z0-9_.-]*|root|nobody) echo "invalid username" >&2; exit 65 ;;
esac

if ! awk -F: -v t="$USER" '$1==t{found=1} END{exit(found?0:1)}' "$DB"; then
  echo "user $USER is not registered" >&2
  exit 66
fi

PASS=""; EXPIRY=""; MAXLOGINS=""; BW=""; TYPE=""; LOCK=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --password=*) PASS="${1#--password=}" ;;
    --expiry=*)   EXPIRY="${1#--expiry=}" ;;
    --maxlogins=*) MAXLOGINS="${1#--maxlogins=}" ;;
    --bandwidth=*) BW="${1#--bandwidth=}" ;;
    --type=*)     TYPE="${1#--type=}" ;;
    --lock)   LOCK="lock" ;;
    --unlock) LOCK="unlock" ;;
    *) echo "unknown option: $1" >&2; exit 64 ;;
  esac
  shift
done

[ -z "$PASS" ] || [ ${#PASS} -ge 6 ] || { echo "password too short" >&2; exit 65; }

if [ -n "$EXPIRY" ]; then
  case "$EXPIRY" in
    never) ;;
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) date -d "$EXPIRY" >/dev/null 2>&1 || { echo "bad date" >&2; exit 65; } ;;
    *) echo "bad expiry" >&2; exit 65 ;;
  esac
fi
[ -z "$MAXLOGINS" ] || { case "$MAXLOGINS" in ''|*[!0-9]*) echo "bad maxlogins" >&2; exit 65;; esac; }
[ -z "$BW" ] || { case "$BW" in ''|*[!0-9.]*) echo "bad bandwidth" >&2; exit 65;; esac; }
[ -z "$TYPE" ] || { case "$TYPE" in user|trial) ;; *) echo "bad type" >&2; exit 65;; esac; }

if getent passwd "$USER" >/dev/null 2>&1; then
  [ -z "$PASS" ] || echo "$USER:$PASS" | chpasswd
  if [ -n "$EXPIRY" ]; then
    [ "$EXPIRY" = "never" ] && chage -E -1 "$USER" || chage -E "$EXPIRY" "$USER"
  fi
  case "$LOCK" in
    lock)   usermod -L "$USER" ;;
    unlock) usermod -U "$USER" ;;
  esac
fi

# Rewrite db field(s) while preserving the rest of the row.
tmp="$(mktemp)"
while IFS=: read -r u p e l b t || [ -n "$u" ]; do
  [ -n "$u" ] || continue
  case "$u" in \#*) echo "$u:$p:$e:$l:$b:$t"; continue ;; esac
  if [ "$u" = "$USER" ]; then
    [ -n "$PASS" ] && p="$PASS"
    [ -n "$EXPIRY" ] && e="$EXPIRY"
    [ -n "$MAXLOGINS" ] && l="$MAXLOGINS"
    [ -n "$BW" ] && b="$BW"
    [ -n "$TYPE" ] && t="$TYPE"
    printf '%s:%s:%s:%s:%s:%s\n' "$u" "$p" "$e" "$l" "$b" "$t"
  else
    printf '%s:%s:%s:%s:%s:%s\n' "$u" "$p" "$e" "$l" "$b" "$t"
  fi
done < "$DB" > "$tmp"
mv "$tmp" "$DB"

echo "ok: user $USER updated"
exit 0