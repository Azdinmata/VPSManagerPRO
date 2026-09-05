#!/usr/bin/env bash
#
# VPSManagerPRO Live — clean-room installer for a NEW VPS.
#
# This bundle was rebuilt from a snapshot of the original live server and does
# NOT use the upstream (dead / backdoored) curl|bash installer. Everything is
# deployed from local files in this directory; the only outgoing downloads are
# the menu's own installers (nginx/haproxy/certbot and udp-custom via the
# maintained http-custom upstream).
#
# Usage:
#   bash install.sh                                       # interactive (web panel auto-installs too)
#   bash install.sh --panel-hostname panel.example.com    # panel behind an nginx TLS vhost
#   bash install.sh --no-panel                            # skip the web control panel
#   DESEC_TOKEN=... DESEC_DOMAIN=... bash install.sh --yes
#
# After it finishes, run `menu` for the interactive protocol installers
# (DNSTT, udp-custom, ZiVPN, edge/SSL stack, 3X-UI, SSH banners). The access
# link for the web panel is printed at the end of the install.

set -euo pipefail

# ---------------------------------------------------------------- colors ---
C_RESET=$'\e[0m'; C_RED=$'\e[1;31m'; C_GREEN=$'\e[1;32m'; C_YELLOW=$'\e[1;33m'
C_BLUE=$'\e[1;34m'; C_PURPLE=$'\e[1;35m'; C_CYAN=$'\e[1;36m'; C_WHITE=$'\e[1;37m'

BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSUME_YES=0
PANEL_SKIP=0
PANEL_HOSTNAME="${VMP_PANEL_HOSTNAME:-}"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --yes)             ASSUME_YES=1; shift ;;
        --no-panel)        PANEL_SKIP=1; shift ;;
        --panel-hostname)  PANEL_HOSTNAME="${2:-}"; shift 2 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
done

# ------------------------------------------------------------ constants ----
VMP_DIR="/etc/vpsmanagerpro"
VMP_DIRS=(
    "/etc/vpsmanagerpro"
    "/etc/vpsmanagerpro/users"
    "/etc/vpsmanagerpro/bandwidth"
    "/etc/vpsmanagerpro/bandwidth/pidtrack"
    "/etc/vpsmanagerpro/banners"
    "/etc/vpsmanagerpro/ssl"
    "/etc/vpsmanagerpro/dnstt"
    "/usr/local/lib/vpsmanagerpro"
)
DB_FILE="$VMP_DIR/users.db"

log()  { echo -e "${C_BLUE}◆${C_RESET} $*"; }
ok()   { echo -e "${C_GREEN}✔${C_RESET} $*"; }
warn() { echo -e "${C_YELLOW}⚠ ${C_RESET}$*"; }
die()  { echo -e "\n${C_RED}✘ $*${C_RESET}" >&2; exit 1; }

ask_yn() { # ask_yn "question" -> 0 yes / 1 no
    local q="$1" ans
    [[ $ASSUME_YES -eq 1 ]] && return 0
    while true; do
        read -r -p "$q (y/n) [y]: " ans || return 1
        ans=${ans:-y}
        [[ "$ans" =~ ^[yY]$ ]] && return 0
        [[ "$ans" =~ ^[nN]$ ]] && return 1
    done
}

ask_value() { # ask_value "prompt" "default" -> echoes result
    local q="$1" def="$2" val
    if [[ $ASSUME_YES -eq 1 ]]; then echo "$def"; return; fi
    read -r -p "$q [${def:-""}]: " val || echo "$def"
    echo "${val:-$def}"
}

require_root() {
    [[ $EUID -eq 0 ]] || die "Run as root: sudo bash install.sh"
}

verify_bundle() {
    log "Verifying bundle integrity (SHA256SUMS)..."
    sha256sum -c "$BUNDLE_DIR/SHA256SUMS" >/dev/null 2>&1 \
        || warn "Some artifact checksums did NOT match — re-download or rebuild the bundle before a production deploy."
    ok "Bundle verified (non-fatal warnings above)."
}

detect_os() {
    . /etc/os-release 2>/dev/null || die "Unsupported OS (no /etc/os-release)"
    [[ "${ID:-}" =~ ^(debian|ubuntu)$ ]] \
        || die "This bundle targets Debian/Ubuntu only (detected: ${ID:-unknown})."
}

install_deps() {
    log "Installing base dependencies..."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq \
        bc jq curl wget openssl ca-certificates ufw iptables net-tools \
        >/dev/null
    ok "Base dependencies installed."
}

create_state_dirs() {
    log "Creating /etc/vpsmanagerpro state..."
    install -d "${VMP_DIRS[@]}"
    install -m 0600 /dev/null "$DB_FILE"
    touch "$VMP_DIR/falconproxy_config.conf" 2>/dev/null || true
    ok "State directories ready ($DB_FILE left empty)."
}

generate_selfsigned_ssl() {
    if [[ -f "$VMP_DIR/ssl/vpsmanagerpro.crt" && -f "$VMP_DIR/ssl/vpsmanagerpro.key" ]]; then
        ok "SSL material already present — keeping it."
        return
    fi
    log "Generating fresh self-signed edge certificate..."
    openssl req -x509 -nodes -days 3650 -newkey rsa:4096 \
        -subj "/C=US/O=VPSManagerPRO Live/CN=vpsmanagerpro" \
        -keyout "$VMP_DIR/ssl/vpsmanagerpro.key" \
        -out   "$VMP_DIR/ssl/vpsmanagerpro.crt" 2>/dev/null
    cat "$VMP_DIR/ssl/vpsmanagerpro.crt" "$VMP_DIR/ssl/vpsmanagerpro.key" \
        > "$VMP_DIR/ssl/vpsmanagerpro.pem"
    chmod 600 "$VMP_DIR/ssl/vpsmanagerpro.key" "$VMP_DIR/ssl/vpsmanagerpro.pem"
    chmod 644 "$VMP_DIR/ssl/vpsmanagerpro.crt"
    ok "Self-signed edge cert generated: $VMP_DIR/ssl/vpsmanagerpro.pem"
}

deploy_menu() {
    log "Deploying the management menu..."
    install -m 0755 "$BUNDLE_DIR/menu" /usr/bin/menu
    ln -sf /usr/bin/menu /usr/local/bin/menu
    ok "menu installed at /usr/bin/menu (alias: menu)."
}

deploy_daemons() {
    log "Deploying tunnel daemons..."
    install -m 0755 "$BUNDLE_DIR/daemons/falconproxy"   /usr/local/bin/falconproxy
    install -m 0755 "$BUNDLE_DIR/daemons/falconproxy"   /usr/local/lib/vpsmanagerpro/falconproxy
    install -m 0755 "$BUNDLE_DIR/daemons/dnstt-server" /usr/local/bin/dnstt-server
    install -m 0755 "$BUNDLE_DIR/daemons/udpgw"        /usr/local/bin/udpgw
    ok "falconproxy, dnstt-server and udpgw deployed."
}

deploy_helpers() {
    log "Deploying helper scripts..."
    install -m 0755 "$BUNDLE_DIR/scripts/vpsmanagerpro-limiter.sh"        /usr/local/bin/vpsmanagerpro-limiter.sh
    install -m 0755 "$BUNDLE_DIR/scripts/vpsmanagerpro-trial-cleanup.sh"  /usr/local/bin/vpsmanagerpro-trial-cleanup.sh
    ok "Limiter and trial-cleanup helpers deployed."
}

deploy_xui() {
    [[ -x "$BUNDLE_DIR/panel/x-ui.sh" ]] || return 0
    log "Deploying bundled 3X-UI panel..."
    install -d /usr/local/x-ui /usr/local/x-ui/bin
    install -m 0755 "$BUNDLE_DIR/panel/x-ui.sh" /usr/local/x-ui/x-ui.sh
    install -m 0755 "$BUNDLE_DIR/panel/bin/xray-linux-amd64" /usr/local/x-ui/bin/xray-linux-amd64
    install -m 0644 "$BUNDLE_DIR"/panel/bin/geoip*.dat  /usr/local/x-ui/bin/ 2>/dev/null || true
    install -m 0644 "$BUNDLE_DIR"/panel/bin/geosite*.dat /usr/local/x-ui/bin/ 2>/dev/null || true
    ln -sf /usr/local/x-ui/x-ui.sh /usr/local/bin/x-ui
    ok "x-ui panel files deployed (first start generates a fresh x-ui.db)."
}

configure_ssh() {
    local dropin="/etc/ssh/sshd_config.d/99-vpsmanagerpro.conf"
    log "Configuring sshd (root login / password auth / TCP forwarding)..."
    cat > "$dropin" <<EOF
PermitRootLogin yes
PasswordAuthentication yes
AllowTcpForwarding yes
EOF
    chmod 600 "$dropin"
    (systemctl reload sshd 2>/dev/null || systemctl reload ssh 2>/dev/null || true)
    ok "sshd drop-in written: $dropin"
}

configure_desec() {
    local conf="$VMP_DIR/desec.conf"
    if [[ -f "$conf" ]]; then
        ok "desec.conf already exists — keeping it."
        return
    fi
    local token="${DESEC_TOKEN:-}" domain="${DESEC_DOMAIN:-}"
    if [[ -z "$token" && $ASSUME_YES -eq 0 ]]; then
        echo -e "\n${C_CYAN}── deSEC (auto DNS subdomains + DNSTT records) ──${C_RESET}"
        echo "Optional but recommended. Create a free zone first: https://desec.io"
        if ask_yn "Configure deSEC now?"; then
            token="$(ask_value "deSEC API token" "$token")"
            domain="$(ask_value "deSEC zone (e.g. myserver.dedyn.io)" "$domain")"
        fi
    fi
    if [[ -n "$token" && -n "$domain" ]]; then
        cat > "$conf" <<EOF
DESEC_TOKEN="$token"
DESEC_DOMAIN="$domain"
EOF
        chmod 600 "$conf"
        ok "deSEC configured: $domain"
    else
        warn "deSEC not configured; DNS/DNSTT automation in the menu will prompt for /etc/vpsmanagerpro/desec.conf."
    fi
}

configure_edge_prefs() {
    local conf="$VMP_DIR/edge_cert.conf"
    [[ -f "$conf" ]] && return 0
    local domain="${EDGE_DOMAIN:-}" email="${EDGE_EMAIL:-}"
    if [[ -z "$domain" && $ASSUME_YES -eq 0 ]]; then
        echo -e "\n${C_CYAN}── Edge TLS (optional) ──${C_RESET}"
        domain="$(ask_value "Primary domain for the edge TLS stack (blank to skip)" "$domain")"
        [[ -n "$domain" ]] && email="$(ask_value "Let's Encrypt notification email" "$email")"
    fi
    if [[ -n "$domain" ]]; then
        cat > "$conf" <<EOF
EDGE_CERT_MODE="certbot"
EDGE_DOMAIN="$domain"
EDGE_EMAIL="$email"
EOF
        chmod 600 "$conf"
        ok "Edge domain pre-configured: $domain"
    else
        warn "No edge domain set — configure it later via the menu (edge/SSL stack) or write $conf yourself."
    fi
}

open_base_ports() {
    log "Opening base firewall ports (22, 80, 443)..."
    if command -v ufw >/dev/null 2>&1; then
        ufw allow 22/tcp  >/dev/null 2>&1 || true
        ufw allow 80/tcp  >/dev/null 2>&1 || true
        ufw allow 443/tcp >/dev/null 2>&1 || true
    fi
    iptables -C INPUT -p tcp --dport 22  -j ACCEPT &>/dev/null || iptables -I INPUT -p tcp --dport 22  -j ACCEPT || true
    iptables -C INPUT -p tcp --dport 80  -j ACCEPT &>/dev/null || iptables -I INPUT -p tcp --dport 80  -j ACCEPT || true
    iptables -C INPUT -p tcp --dport 443 -j ACCEPT &>/dev/null || iptables -I INPUT -p tcp --dport 443 -j ACCEPT || true
    ok "Base ports opened."
}

run_menu_setup() {
    log "Running menu core setup (limiter + bandwidth + trial-cleanup services)..."
    if ! command -v menu >/dev/null 2>&1; then
        warn "menu binary missing — skipping core service setup. Re-run the bundle."
        return
    fi
    if ! menu --install-setup; then
        warn "menu --install-setup returned non-zero; review the output above."
    fi
    ok "Core services configured (vpsmanagerpro-limiter.service active on next boot)."
}

compat_aliases() {
    log "Creating backward-compatibility aliases for the old firewallfalcon install path..."
    if [[ -L /etc/firewallfalcon ]]; then
        ok "Existing symlink /etc/firewallfalcon already present — keeping it."
    elif [[ -e /etc/firewallfalcon ]]; then
        warn "/etc/firewallfalcon exists as a real path (prior install)."
        warn "Point it at the new tree manually: ln -s /etc/vpsmanagerpro /etc/firewallfalcon"
    else
        ln -s /etc/vpsmanagerpro /etc/firewallfalcon
        ok "Symlinked /etc/firewallfalcon -> /etc/vpsmanagerpro (legacy paths keep working)."
    fi
    for sb in vpsmanagerpro-limiter.sh vpsmanagerpro-trial-cleanup.sh; do
        [[ -e "/usr/local/bin/$sb" ]] || continue
        local legacy="${sb/vpsmanagerpro/firewallfalcon}"
        ln -sf "/usr/local/bin/$sb" "/usr/local/bin/$legacy"
    done
    if [[ -e /etc/systemd/system/vpsmanagerpro-limiter.service ]]; then
        ln -sf /etc/systemd/system/vpsmanagerpro-limiter.service \
               /etc/systemd/system/firewallfalcon-limiter.service
        systemctl daemon-reload
        ok "Created firewallfalcon-limiter.service alias for legacy units."
    fi
}

install_nodejs() {
    if command -v node >/dev/null 2>&1 && node -e 'process.exit(+(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' 2>/dev/null; then
        ok "Node.js $(node -v) already installed."
        return 0
    fi
    log "Installing Node.js 20 LTS from NodeSource..."
    export DEBIAN_FRONTEND=noninteractive
    if ! curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1; then
        warn "NodeSource setup failed — cannot install the web panel automatically."
        warn "Install Node.js 18+ manually, then run: cd panel && bash install-panel.sh"
        return 1
    fi
    apt-get install -y -qq nodejs >/dev/null || {
        warn "nodejs package install failed — web panel skipped."
        return 1
    }
    ok "Node.js $(node -v) installed."
}

install_panel() {
    if [[ $PANEL_SKIP -eq 1 ]]; then
        warn "Web panel skipped (--no-panel). Install later: cd panel && bash install-panel.sh [--hostname DOMAIN]"
        return 0
    fi
    log "Installing the web control panel..."
    install_nodejs || return 0
    local args=()
    if [[ -n "$PANEL_HOSTNAME" ]]; then
        args=( "--hostname" "$PANEL_HOSTNAME" )
    else
        args=( "--no-nginx" )
    fi
    if bash "$BUNDLE_DIR/panel/install-panel.sh" "${args[@]}"; then
        ok "Web panel installed and enabled (vpsmanagerpro-panel.service)."
    else
        warn "Panel installer returned non-zero — inspect: journalctl -u vpsmanagerpro-panel"
    fi
}

print_summary() {
    cat <<EOF

${C_GREEN}═══════════════════════════════════════════════════════════════════${C_RESET}
${C_GREEN}  VPSManagerPRO Live is installed.${C_RESET}

  Management menu : ${C_WHITE}menu${C_RESET}   (or: sudo menu)
  User database   : /etc/vpsmanagerpro/users.db   (add users via the menu)
  Limiter service : vpsmanagerpro-limiter.service
  Edge SSL cert   : /etc/vpsmanagerpro/ssl/vpsmanagerpro.pem (self-signed)

  NEXT STEPS (all inside the ${C_WHITE}menu${C_RESET}):
    1. Install Falcon Proxy   →  installs from the bundled binary on 80/443 path
    2. DNSTT (option 2/3)     →  requires a domain; auto via deSEC or custom NS
    3. UDP Custom + udpgw     →  Option "UDP" in protocols
    4. ZiVPN                  →  registers UDP 5667 + 6000-19999 redirection
    5. Edge stack (HAProxy)   →  port 80/443 routing; uses the generated .pem
    6. 3X-UI panel            →  already deployed at /usr/local/x-ui
       (first run creates credentials; change them via: x-ui settings)

  VERIFY THE FALCON PROXY:
    systemctl status falconproxy
    falconproxy --help
    ss -tlnp | grep falconproxy
EOF
    if [[ $PANEL_SKIP -eq 0 ]]; then
        IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
        echo ""
        echo -e "  ${C_PURPLE}═══ WEB CONTROL PANEL ═══${C_RESET}"
        if [[ -n "$PANEL_HOSTNAME" ]]; then
            echo -e "  ${C_WHITE}LINK  →  https://$PANEL_HOSTNAME${C_RESET}"
            echo -e "  (obtain TLS first:  certbot --nginx -d $PANEL_HOSTNAME)"
        else
            echo -e "  ${C_WHITE}LINK  →  http://localhost:3100${C_RESET}  (via SSH tunnel):"
            echo -e "  ssh -L 3100:127.0.0.1:3100 root@${IP:-<SERVER_IP>}   # then open the link in your browser"
        fi
        if [[ -n "$PANEL_HOSTNAME" ]]; then
            echo -e "  Until TLS is issued, the link above works through the same tunnel:"
            echo -e "  ssh -L 3100:127.0.0.1:3100 root@${IP:-<SERVER_IP>}   # then open http://localhost:3100"
        fi
        echo -e "  First login: user ${C_WHITE}admin${C_RESET}, set a password (8+ chars), then enroll the TOTP code."
    fi
    echo -e "${C_YELLOW}Compat: /etc/firewallfalcon -> /etc/vpsmanagerpro symlink created for legacy paths (falconproxy data, old cert names).${C_RESET}"
    echo -e "${C_YELLOW}Current version tracking: SHA256SUMS in $BUNDLE_DIR/SHA256SUMS${C_RESET}"
}

main() {
    require_root
    verify_bundle
    detect_os
    install_deps
    create_state_dirs
    generate_selfsigned_ssl
    deploy_menu
    deploy_daemons
    deploy_helpers
    deploy_xui
    configure_ssh
    configure_desec
    configure_edge_prefs
    open_base_ports
    run_menu_setup
    compat_aliases
    install_panel
    print_summary
}

main "$@"