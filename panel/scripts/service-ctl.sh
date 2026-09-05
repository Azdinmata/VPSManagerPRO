#!/usr/bin/env bash
# VPSManagerPRO panel helper - generic service control for the well-known
# VPSManagerPRO services. Whitelisted targets + actions only.
set -euo pipefail

SERVICES=(vpsmanagerpro-limiter falconproxy dnstt udp-custom udpgw zivpn x-ui nginx haproxy)

if [ "$#" -ne 2 ]; then
  echo "usage: service-ctl.sh SERVICE start|stop|restart|enable|disable|status" >&2
  exit 64
fi
SVC="$1"; ACT="$2"

case "$ACT" in
  start|stop|restart|enable|disable|status) ;;
  *) echo "invalid action: $ACT" >&2; exit 65 ;;
esac

found=0
for s in "${SERVICES[@]}"; do
  [ "$s" = "$SVC" ] && found=1 && break
done
[ "$found" -eq 1 ] || { echo "service not whitelisted: $SVC" >&2; exit 66; }

case "$ACT" in
  status)
    systemctl --no-pager --full status "$SVC.service" 2>&1 || true
    ;;
  *)
    systemctl "$ACT" "$SVC.service"
    ;;
esac
exit 0