#!/usr/bin/env bash
# VPSManagerPRO panel helper - install/update dnstt-server (DNS tunneling)
# from bundled binaries; generate keys and write the service + info conf.
#
# usage: install-dnstt.sh [--domain TUNNEL_DOMAIN] [--forward 127.0.0.1:22] [--mtu 1350]
set -euo pipefail

BIN_DIR="/opt/vpsmanagerpro-panel/binaries"
INSTALL_DIR="/usr/local/bin"
SERVICE="dnstt"
SERVICE_FILE="/etc/systemd/system/${SERVICE}.service"
KEYS_DIR="/etc/vpsmanagerpro/dnstt"
INFO_FILE="/etc/vpsmanagerpro/dnstt_info.conf"

DOMAIN=""; FORWARD="127.0.0.1:22"; MTU=1350
while [ "$#" -gt 0 ]; do
  case "$1" in
    --domain=*) DOMAIN="${1#--domain=}" ;;
    --forward=*) FORWARD="${1#--forward=}" ;;
    --mtu=*) MTU="${1#--mtu=}" ;;
    *) echo "unknown option: $1" >&2; exit 64 ;;
  esac
  shift
done
[ -n "$DOMAIN" ] || { echo "--domain required" >&2; exit 64; }

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) SRC="dnstt-server-linux-amd64" ;;
  aarch64|arm64) SRC="dnstt-server-linux-arm64" ;;
  *) echo "unsupported arch: $ARCH" >&2; exit 65 ;;
esac

if [ ! -f "$BIN_DIR/$SRC" ]; then
  echo "bundled dnstt-server not found: $BIN_DIR/$SRC" >&2
  exit 70
fi
install -m 0755 "$BIN_DIR/$SRC" "${INSTALL_DIR}/${SERVICE}"

mkdir -p "$KEYS_DIR"
KEY="$KEYS_DIR/server.key"
PUB="$KEYS_DIR/server.pub"
if [ ! -f "$KEY" ] || [ ! -f "$PUB" ]; then
  "${INSTALL_DIR}/${SERVICE}" -gen-key -privkey-file "$KEY" -pubkey-file "$PUB" >/dev/null 2>&1 \
    || { echo "dnstt key generation failed" >&2; exit 71; }
fi

MTU_STR=""
[ -n "$MTU" ] && [ "$MTU" != "0" ] && MTU_STR=",${MTU}"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=DNSTT (DNS Tunnel) Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/${SERVICE} -udp :53${MTU_STR} -privkey-file ${KEY} ${DOMAIN} ${FORWARD}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

PUBKEY="$(cat "$PUB" 2>/dev/null || true)"
cat > "$INFO_FILE" <<EOF
tunnel_domain=${DOMAIN}
forward_target=${FORWARD}
mtu=${MTU}
public_key=${PUBKEY}
EOF

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1 || true
systemctl restart "$SERVICE" || { echo "dnstt failed to start" >&2; exit 72; }
echo "ok: dnstt installed with domain $DOMAIN"
exit 0