#!/usr/bin/env bash
# VPSManagerPRO panel - one-shot installer (VPS-bound, explicitly no auto-rerun).
# Builds/installs the Next.js panel, helper scripts, and systemd service.
# The panel source tree (src/, package.json, scripts/, systemd/, config/) must
# sit alongside this script. Requires node 18+ / npm.
#
# usage: sudo bash install-panel.sh [--hostname panel.example.com] [--no-nginx]
set -euo pipefail

HOSTNAME_ARG=""
SKIP_NGINX=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --hostname) HOSTNAME_ARG="$2"; shift 2 ;;
    --no-nginx) SKIP_NGINX=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 64 ;;
  esac
done

PREFIX="/opt/vpsmanagerpro-panel"
SRC="$(cd "$(dirname "$0")" && pwd)"
PANEL_DIR="$PREFIX/panel"
SCRIPTS_DIR="$PREFIX/scripts"
BIN_DIR="$PREFIX/binaries"

command -v node >/dev/null 2>&1 || { echo "node not found - install Node 18+ first" >&2; exit 70; }
command -v npm  >/dev/null 2>&1 || { echo "npm not found" >&2; exit 70; }

echo "==> Installing VPSManagerPRO panel"

# ---- copy source tree ------------------------------------------------------
install -d -m 0755 "$PANEL_DIR" "$SCRIPTS_DIR" "$BIN_DIR"
[ -d "$SRC/src" ] && [ -f "$SRC/package.json" ] && [ -f "$SRC/next.config.mjs" ] || {
  echo "panel source tree not found (expecting src/ + package.json next to installer)" >&2
  exit 70
}
cp -r "$SRC/src" "$PANEL_DIR/"
cp "$SRC/package.json" "$SRC/tsconfig.json" "$SRC/next.config.mjs" "$PANEL_DIR/"
[ -f "$SRC/package-lock.json" ] && cp "$SRC/package-lock.json" "$PANEL_DIR/"
cp -r "$SRC/systemd" "$SRC/config" "$PANEL_DIR/" 2>/dev/null || true

# ---- install helper scripts + daemon binaries ------------------------------
for s in user-add.sh user-del.sh user-update.sh desec-record.sh \
         install-dnstt.sh install-udpcustom.sh install-falconproxy.sh \
         install-zivpn.sh install-v2ray.sh service-ctl.sh; do
  [ -f "$SRC/scripts/$s" ] || { echo "missing helper script: $s" >&2; exit 70; }
  install -m 0755 "$SRC/scripts/$s" "$SCRIPTS_DIR/$s"
done

# Seed bundled binaries if the bundle provided them (bundle's daemons/ dir is
# a sibling of the panel folder in the VPSManagerPRO live bundle).
DAEMONS_DIR=""
[ -d "$SRC/daemons" ] && DAEMONS_DIR="$SRC/daemons"
[ -z "$DAEMONS_DIR" ] && [ -d "$(dirname "$SRC")/daemons" ] && DAEMONS_DIR="$(dirname "$SRC")/daemons"
if [ -n "$DAEMONS_DIR" ]; then
  for f in falconproxy udp-custom dnstt-server-linux-amd64 dnstt-server-linux-arm64 zivpn; do
    [ -f "$DAEMONS_DIR/$f" ] && install -m 0755 "$DAEMONS_DIR/$f" "$BIN_DIR/$f"
  done
fi

# Seed the Xray core matching this machine's CPU arch for the panel's
# /api/v2ray installer (install-v2ray.sh looks in $BIN_DIR).
case "$(uname -m)" in
  x86_64)        XRAY_SRC="$SRC/bin/xray-linux-amd64" ;;
  aarch64|arm64) XRAY_SRC="$SRC/bin/xray-linux-arm64" ;;
  *)             XRAY_SRC="" ;;
esac
if [ -n "$XRAY_SRC" ] && [ -f "$XRAY_SRC" ]; then
  install -m 0755 "$XRAY_SRC" "$BIN_DIR/$(basename "$XRAY_SRC")"
  echo "seeded $(basename "$XRAY_SRC") for $(uname -m)"
fi

# ---- build the panel ---------------------------------------------------------
(
  cd "$PANEL_DIR"
  rm -rf .next
  npm install --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund
  npm run build
)
NEXT_STANDALONE="$PANEL_DIR/.next/standalone"
mkdir -p "$NEXT_STANDALONE/.next"
[ -d "$PANEL_DIR/.next/static" ] && cp -r "$PANEL_DIR/.next/static" "$NEXT_STANDALONE/.next/static"
[ -d "$PANEL_DIR/public" ] && cp -r "$PANEL_DIR/public" "$NEXT_STANDALONE/public"

# ---- systemd -----------------------------------------------------------------
install -m 0644 "$PANEL_DIR"/systemd/vpsmanagerpro-panel.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable vpsmanagerpro-panel >/dev/null
systemctl restart vpsmanagerpro-panel || {
  echo "panel failed to start - check: journalctl -u vpsmanagerpro-panel" >&2
  exit 71
}

# ---- optional nginx TLS vhost -------------------------------------------------
if [ "$SKIP_NGINX" -eq 0 ] && [ -n "$HOSTNAME_ARG" ] && command -v nginx >/dev/null 2>&1; then
  cp "$PANEL_DIR"/config/nginx/panel.conf.example "/etc/nginx/sites-available/panel.conf"
  sed -i "s/panel\.example\.com/${HOSTNAME_ARG}/g" "/etc/nginx/sites-available/panel.conf"
  ln -sf "/etc/nginx/sites-available/panel.conf" "/etc/nginx/sites-enabled/panel.conf"
  if nginx -t && systemctl reload nginx; then
    echo "==> nginx vhost staged for ${HOSTNAME_ARG}"
    echo "    Obtain TLS: certbot --nginx -d ${HOSTNAME_ARG}"
  else
    echo "!! nginx config test failed - fix manually"
  fi
fi

echo ""
echo "==> Done. Panel running on 0.0.0.0:3100"
echo "    First login: username admin, any password >= 8 chars (used to set the"
echo "    admin password on first use), then enroll a TOTP authenticator."
echo "    For real use front with nginx TLS: see config/nginx/panel.conf.example"
exit 0