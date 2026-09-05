// Central path constants for the VPSManagerPRO server layout.
// Mirrors the paths used by /usr/bin/menu and the limiter daemon.

export const VMP_DIR = "/etc/vpsmanagerpro";
export const DB_FILE = `${VMP_DIR}/users.db`;
export const BANDWIDTH_DIR = `${VMP_DIR}/bandwidth`;
export const PID_DIR = `${BANDWIDTH_DIR}/pidtrack`;
export const BANNER_DIR = `${VMP_DIR}/banners`;
export const SSL_DIR = `${VMP_DIR}/ssl`;
export const DNSTT_KEYS_DIR = `${VMP_DIR}/dnstt`;

export const DESEC_CONFIG_FILE = `${VMP_DIR}/desec.conf`;
export const DNS_INFO_FILE = `${VMP_DIR}/dns_info.conf`;
export const DNSTT_INFO_FILE = `${VMP_DIR}/dnstt_info.conf`;
export const EDGE_CERT_FILE = `${VMP_DIR}/edge_cert.conf`;
export const NGINX_PORTS_FILE = `${VMP_DIR}/nginx_ports.conf`;
export const FALCONPROXY_CONFIG_FILE = `${VMP_DIR}/falconproxy_config.conf`;

export const STATIC_BANNER_FILE = "/etc/bannerssh";
export const DYNAMIC_BANNER_MARKER = `${VMP_DIR}/banners_enabled`;
export const SSHD_VMP_CONFIG = "/etc/ssh/sshd_config.d/vpsmanagerpro.conf";

// Panel own state (all root-only)
export const PANEL_DIR = `${VMP_DIR}/panel`;
export const PANEL_SECRET_FILE = `${PANEL_DIR}/secret`;
export const PANEL_ADMIN_FILE = `${PANEL_DIR}/admin.json`;
export const PANEL_AUDIT_FILE = `${PANEL_DIR}/audit.jsonl`;
export const PANEL_JOBS_DIR =
  process.env.VMP_PANEL_JOBS_DIR || "/var/log/vpsmanagerpro-panel/jobs";
export const PANEL_SCRIPTS_DIR =
  process.env.VMP_PANEL_SCRIPTS_DIR || "/opt/vpsmanagerpro-panel/scripts";

// Well-known helper scripts shipped with the panel
export const SCRIPT_USER_ADD = `${PANEL_SCRIPTS_DIR}/user-add.sh`;
export const SCRIPT_USER_DEL = `${PANEL_SCRIPTS_DIR}/user-del.sh`;
export const SCRIPT_USER_UPDATE = `${PANEL_SCRIPTS_DIR}/user-update.sh`;
export const SCRIPT_DNSTT = `${PANEL_SCRIPTS_DIR}/install-dnstt.sh`;
export const SCRIPT_UDPCUSTOM = `${PANEL_SCRIPTS_DIR}/install-udpcustom.sh`;
export const SCRIPT_FALCONPROXY = `${PANEL_SCRIPTS_DIR}/install-falconproxy.sh`;
export const SCRIPT_ZIVPN = `${PANEL_SCRIPTS_DIR}/install-zivpn.sh`;
export const SCRIPT_DESEC = `${PANEL_SCRIPTS_DIR}/desec-record.sh`;
export const SCRIPT_V2RAY = `${PANEL_SCRIPTS_DIR}/install-v2ray.sh`;

// V2Ray / Xray (Trojan, VLESS, VMess) — panel-managed config under /etc/vpsmanagerpro
export const XRAY_DIR = `${VMP_DIR}/xray`;
export const XRAY_ACCOUNTS_FILE = `${XRAY_DIR}/accounts.json`;
export const XRAY_CONFIG_FILE = `${XRAY_DIR}/config.json`;
export const XRAY_BIN = "/usr/local/bin/xray";
export const XRAY_SERVICE = "vpsmanagerpro-xray";
export const XRAY_SSL_DIR = `${SSL_DIR}`;

// Services surfaced in the panel
export const KNOWN_SERVICES = [
  "vpsmanagerpro-limiter",
  "falconproxy",
  "dnstt",
  "udp-custom",
  "udpgw",
  "zivpn",
  "x-ui",
  "vpsmanagerpro-xray",
  "nginx",
  "haproxy",
] as const;

export const VMP_USERS_GROUP = "vmpusers";

export const PANEL_ISSUER = "VPSManagerPRO Panel";
export const SESSION_COOKIE = "vmp_session";
export const PENDING_COOKIE = "vmp_pending";
export const CSRF_COOKIE = "vmp_csrf";