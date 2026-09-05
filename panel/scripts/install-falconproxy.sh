#!/usr/bin/env bash
# VPSManagerPRO panel helper - install/update the falconproxy (SSH tunneling
# proxy listening on 8080/8880) from the bundled binary. Uses the same runtime
# flags as the shipped systemd unit (-p "8080,8888" duplicating 8080 for the
# nginx port-80 front is handled at the nginx layer, not here).
#
# usage: install-falconproxy.sh
set -euo pipefail

BIN_SRC="/opt/vpsmanagerpro-panel/binaries/falconproxy"
INSTALL_DIR="/usr/local/bin"
SERVICE="falconproxy"
SERVICE_FILE="/etc/systemd/system/${SERVICE}.service"
LOG_DIR="/var/log/vpsmanagerpro"

[ -x "$BIN_SRC" ] || { echo "bundled falconproxy binary not found" >&2; exit 70; }
install -m 0755 "$BIN_SRC" "${INSTALL_DIR}/${SERVICE}"

mkdir -p "$LOG_DIR"

if [ ! -f "$SERVICE_FILE" ]; then
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=VPSManagerPRO SSH Proxy
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/${SERVICE} -p "8080,8888"
StandardOutput=append:${LOG_DIR}/falconproxy.log
StandardError=append:${LOG_DIR}/falconproxy.log
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
fi

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1 || true
systemctl restart "$SERVICE" || { echo "falconproxy failed to start" >&2; exit 71; }
echo "ok: falconproxy installed and started"
exit 0