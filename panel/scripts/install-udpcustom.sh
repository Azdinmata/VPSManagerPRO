#!/usr/bin/env bash
# VPSManagerPRO panel helper - install/update udp-custom (SlowDNS refit) from
# the bundled binary only (no re-download: the upstream GitHub is unreliable).
# usage: install-udpcustom.sh
set -euo pipefail

BIN_SRC="/opt/vpsmanagerpro-panel/binaries/udp-custom"
INSTALL_DIR="/usr/local/bin"
SERVICE="udp-custom"
SERVICE_FILE="/etc/systemd/system/${SERVICE}.service"
CONFIG_DIR="/etc/vpsmanagerpro"

[ -x "$BIN_SRC" ] || BIN_SRC="${BIN_SRC}.bin"
if [ ! -f "$BIN_SRC" ]; then
  echo "bundled udp-custom binary not found: $BIN_SRC" >&2
  exit 70
fi

install -m 0755 "$BIN_SRC" "${INSTALL_DIR}/${SERVICE}"

# Config is provided by the bundle; create a default if missing.
if [ ! -f "$CONFIG_DIR/udp-custom.json" ]; then
  mkdir -p "$CONFIG_DIR"
  cat > "$CONFIG_DIR/udp-custom.json" <<'EOF'
{
  "listen": ":36712",
  "mtu": 1400,
  "receive_buffer_size": 20480,
  "sender": false
}
EOF
fi

if [ ! -f "$SERVICE_FILE" ]; then
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=UDP Custom (SlowDNS) Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/${SERVICE} -config ${CONFIG_DIR}/udp-custom.json
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
fi

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1 || true
systemctl restart "$SERVICE" || { echo "udp-custom failed to start" >&2; exit 71; }
echo "ok: udp-custom installed and started"
exit 0