#!/usr/bin/env bash
# VPSManagerPRO panel helper - install/update ZiVPN (UDP game VPN) from the
# bundled binary (asset zahidbd2/udp-zivpn 1.4.9). Config from the bundle.
# usage: install-zivpn.sh
set -euo pipefail

BIN_SRC="/opt/vpsmanagerpro-panel/binaries/zivpn"
INSTALL_DIR="/usr/local/bin"
SERVICE="zivpn"
SERVICE_FILE="/etc/systemd/system/${SERVICE}.service"
CONFIG_FILE="/etc/vpsmanagerpro/zivpn/config.json"

[ -x "$BIN_SRC" ] || { echo "bundled zivpn binary not found" >&2; exit 70; }
install -m 0755 "$BIN_SRC" "${INSTALL_DIR}/${SERVICE}"

mkdir -p "$(dirname "$CONFIG_FILE")"
if [ ! -f "$CONFIG_FILE" ]; then
  cat > "$CONFIG_FILE" <<'EOF'
{
  "server": {
    "address": "0.0.0.0",
    "port": 443,
    "mode": "udp"
  }
}
EOF
fi

if [ ! -f "$SERVICE_FILE" ]; then
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=ZiVPN UDP Game VPN Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/${SERVICE} server -c ${CONFIG_FILE}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
fi

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1 || true
systemctl restart "$SERVICE" || { echo "zivpn failed to start" >&2; exit 71; }
echo "ok: zivpn installed and started"
exit 0