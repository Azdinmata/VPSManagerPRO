#!/usr/bin/env bash
# VPSManagerPRO panel helper - install/update the V2Ray/Xray core (Trojan, VLESS, VMess).
# Installs the bundled xray binary + geo data and a systemd unit. The panel writes
# /etc/vpsmanagerpro/xray/config.json and calls systemctl restart itself.
#
# usage: install-v2ray.sh
set -euo pipefail

BIN_DIR="/opt/vpsmanagerpro-panel/binaries"
INSTALL_DIR="/usr/local/bin"
XRAY="xray"
SERVICE="vpsmanagerpro-xray"
SERVICE_FILE="/etc/systemd/system/${SERVICE}.service"
XRAY_CONFIG_DIR="/etc/vpsmanagerpro/xray"
XRAY_DAT_DIR="/usr/local/share/xray"

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) SRC="xray-linux-amd64" ;;
  aarch64|arm64) SRC="xray-linux-arm64" ;;
  *) echo "unsupported arch: $ARCH" >&2; exit 65 ;;
esac

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

if [ ! -f "$BIN_DIR/$SRC" ]; then
  echo "bundled xray binary not found: $BIN_DIR/$SRC" >&2
  exit 70
fi
install -m 0755 "$BIN_DIR/$SRC" "${INSTALL_DIR}/${XRAY}"
"${INSTALL_DIR}/${XRAY}" version >/dev/null 2>&1 || { echo "xray binary failed sanity check" >&2; exit 71; }

mkdir -p "$XRAY_DAT_DIR"
for dat in geoip.dat geosite.dat geoip_IR.dat geosite_IR.dat geoip_RU.dat geosite_RU.dat; do
  if [ -f "$BIN_DIR/$dat" ]; then
    install -m 0644 "$BIN_DIR/$dat" "$XRAY_DAT_DIR/$dat"
  fi
done

mkdir -p "$XRAY_CONFIG_DIR"
if [ ! -f "$XRAY_CONFIG_DIR/accounts.json" ]; then
  echo '{ "server": "", "tlsCert": "/etc/vpsmanagerpro/ssl/vpsmanagerpro.crt", "tlsKey": "/etc/vpsmanagerpro/ssl/vpsmanagerpro.key", "accounts": [] }' > "$XRAY_CONFIG_DIR/accounts.json"
  chmod 0600 "$XRAY_CONFIG_DIR/accounts.json"
fi

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=V2Ray / Xray (Trojan, VLESS, VMess) - managed by VPSManagerPRO panel
After=network.target
Wants=network.target

[Service]
Type=simple
ExecStart=${INSTALL_DIR}/${XRAY} run -c ${XRAY_CONFIG_DIR}/config.json
Restart=on-failure
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1 || true

if [ ! -f "$XRAY_CONFIG_DIR/config.json" ]; then
  echo '{ "log": { "loglevel": "warning" }, "inbounds": [], "outbounds": [ { "protocol": "freedom", "tag": "direct" } ] }' > "$XRAY_CONFIG_DIR/config.json"
fi

systemctl restart "$SERVICE" >/dev/null 2>&1 || true
echo "ok: xray installed ($("${INSTALL_DIR}/${XRAY}" version | head -1))"
exit 0