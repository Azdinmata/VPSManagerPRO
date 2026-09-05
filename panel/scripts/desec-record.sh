#!/usr/bin/env bash
# VPSManagerPRO panel helper - create/delete a DNS record via deSEC API.
# Mirrors the exact request the interactive menu makes (menu:1050).
#
# usage:
#   desec-record.sh 'create' '<payload json>'
#   desec-record.sh 'delete' '<subname>'
set -euo pipefail

CONF="/etc/vpsmanagerpro/desec.conf"

if [ "$#" -lt 1 ]; then
  echo "usage: desec-record.sh create '<rrset json array>' | delete '<subname>'" >&2
  exit 64
fi
ACTION="$1"; shift

TOKEN=""; DOMAIN=""
if [ -f "$CONF" ]; then
  # shellcheck disable=SC1090
  . "$CONF" 2>/dev/null || true
fi
TOKEN="${TOKEN:-${DESEC_TOKEN:-}}"
DOMAIN="${DOMAIN:-${DNS_DOMAIN:-${DESEC_DOMAIN:-}}}"

[ -n "$TOKEN" ] || { echo "deSEC token missing in $CONF" >&2; exit 66; }
[ -n "$DOMAIN" ] || { echo "deSEC domain missing in $CONF" >&2; exit 66; }

URL="https://desec.io/api/v1/domains/${DOMAIN}/rrsets/"

case "$ACTION" in
  create)
    [ "$#" -ge 1 ] || { echo "missing payload" >&2; exit 64; }
    PAYLOAD="$1"
    # Guard: must be a JSON array of rrset objects containing "subname".
    echo "$PAYLOAD" | grep -q '"subname"' || { echo "invalid rrset payload" >&2; exit 65; }
    curl -fsS --max-time 25 \
      -X POST "$URL" \
      -H "Authorization: Token $TOKEN" \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD"
    echo
    ;;
  delete)
    [ "$#" -ge 1 ] || { echo "missing subname" >&2; exit 64; }
    SUB="$1"
    case "$SUB" in
      ""|*[!A-Za-z0-9-]*) echo "invalid subname" >&2; exit 65 ;;
    esac
    curl -fsS --max-time 25 \
      -X DELETE "$URL" \
      -H "Authorization: Token $TOKEN" \
      -H "Content-Type: application/json" \
      -d "[{\"subname\":\"$SUB\"}]"
    echo
    ;;
  *)
    echo "unknown action: $ACTION" >&2
    exit 64
    ;;
esac
exit 0