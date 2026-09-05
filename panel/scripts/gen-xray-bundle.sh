#!/usr/bin/env bash
# VPSManagerPRO - CLI entrypoint for the V2Ray bundle generator.
# Wraps xray-bundle.js (a port of the panel's src/lib/xray.ts) and then validates
# the config with the real xray binary and restarts the service.
#
# usage: gen-xray-bundle.sh [--name NAME] [--print-links] [--dry-run]
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JS="$DIR/xray-bundle.js"
XRAY_BIN="${VMP_XRAY_BIN:-/usr/local/bin/xray}"
CONFIG_FILE="${VMP_XRAY_CONFIG_FILE:-/etc/vpsmanagerpro/xray/config.json}"

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required (apt install nodejs, or the web panel installs it)" >&2
  exit 3
fi
if [[ ! -f "$JS" ]]; then
  echo "error: $JS not found" >&2
  exit 4
fi

node "$JS" "$@"

is_dry_run=0
for a in "$@"; do [[ "$a" == "--dry-run" ]] && is_dry_run=1; done
if [[ $is_dry_run -eq 1 ]]; then
  exit 0
fi

if [[ -x "$XRAY_BIN" && -f "$CONFIG_FILE" ]]; then
  if "$XRAY_BIN" run -test -c "$CONFIG_FILE" >/dev/null 2>&1; then
    if systemctl restart vpsmanagerpro-xray >/dev/null 2>&1; then
      echo "restarted vpsmanagerpro-xray"
    else
      echo "notice: vpsmanagerpro-xray not present; config written for manual start"
    fi
  else
    echo "WARNING: config failed xray -test; service NOT restarted (old config kept running)" >&2
  fi
fi