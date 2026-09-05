# VPSManagerPRO Live — installable rebuild

A clean-room, self-contained rebuild of the **VPSManagerPRO** SSH/VPN server,
reconstructed from a snapshot of the original live VPS. This package installs
the full original feature set onto a **new, different VPS** without depending on
the upstream project, whose GitHub org (`vpsmanagerpros/VPSManagerPRO-Manager`)
is offline and whose official installer was publicly documented as a
supply-chain backdoor.

Everything deployable lives in this one directory. No `curl | bash` from the
original project is used anywhere.

## Contents

| Path | Purpose |
| --- | --- |
| `install.sh` | Main installer (root, Debian/Ubuntu). Interactive or `--yes`. |
| `menu` | The management TUI (patched: deSEC credentials now per-deployment, falconproxy/udp-custom installers point at live sources). |
| `daemons/` | Bundled binaries: `falconproxy`, `dnstt-server`, `udpgw` (x86-64). |
| `panel/` | Self-contained **web control panel** (Next.js 14, admin-only) with one-shot `install-panel.sh`; also still ships the original 3X-UI assets (`x-ui.sh`, xray core, geo data) under `panel/bin/`. |
| `scripts/` | `vpsmanagerpro-limiter.sh` (session/bandwidth/expiry engine), trial cleanup. |
| `systemd/` | Reference units (the menu regenerates and installs these). |
| `config/` | Sanitized templates: nginx `default`, `haproxy.cfg`, `users.db.example`, `desec.conf.example`, edge/DNSTT/nginx-port configs, zivpn config. |
| `SHA256SUMS` | Checksums of every shipped artifact. |

## Quick start (new VPS)

The repo is **private**, so on the VPS clone it with GitHub auth (a personal
access token, or `gh`):

```bash
# option A — one-off clone with a GitHub PAT (create one: github.com/settings/tokens)
git clone https://oauth2:<YOUR_PAT>@github.com/Azdinmata/VPSManagerPRO.git

# option B — gh CLI (device-code login, like on a desktop)
#   apt install gh   &&   gh auth login   &&   gh repo clone Azdinmata/VPSManagerPRO
cd VPSManagerPRO

# 1. install everything — the web control panel is installed AUTOMATICALLY
bash install.sh
#    panel behind your own domain/TLS (nginx vhost + certbot note):
bash install.sh --panel-hostname panel.example.com
#    panel install optional flags:  --no-panel       skip the web panel
#    non-interactive wireguard/edge options:
DESEC_TOKEN=... DESEC_DOMAIN=... EDGE_DOMAIN=... EDGE_EMAIL=... bash install.sh --yes

# 2. open the menu and install the tunnels:
menu
```

The access link for the web panel is printed at the end of the install —
`https://panel.example.com` if you passed `--panel-hostname`, otherwise
`http://localhost:3100` reached through an SSH tunnel
(`ssh -L 3100:127.0.0.1:3100 root@<SERVER_IP>`).

The installer:
- verifies bundle checksums,
- creates fresh `/etc/vpsmanagerpro` state — **empty `users.db`**, empty
  bandwidth tracking, no copied credentials/keys from the old server,
- deploys the menu, daemons, helper scripts and the 3X-UI panel,
- generates a **new** self-signed edge cert (`vpsmanagerpro.pem`),
- writes `ssh` open drops-in (root login, password auth, TCP forwarding),
- optionally records your own **deSEC** token/zone (never the leaked one),
- runs `menu --install-setup` to install the limiter/trial services,
- auto-installs the **web panel** (`--panel-hostname`, `--no-panel`, or a new
  `VMP_PANEL_HOSTNAME` env var; Node.js 18+ is installed automatically).

## Falcon Proxy — what was fixed

The original service file ran:

```
ExecStart=/usr/local/bin/falconproxy -p 8080 8888     # BROKEN
```

The binary's CLI (extracted from its embedded strings) is:

```
falconproxy [OPTIONS] [host] [OTHER_PORTS]...
    -p, --ports <PORTS>   Comma-separated ports to listen on (e.g. 8080,8081)
    OTHER_PORTS           Additional positional ports to listen on
    host                  Host/address to bind (default :: for dual-stack)
```

`-p` consumes **one** comma-separated value, so the space-separated form fed
`8888` into the `host` positional and the proxy did not work. Fixed form (also
what `install_falcon_proxy()` in the patched menu now writes):

```
ExecStart=/usr/local/bin/falconproxy -p "8080,8888"
```

The menu installer also no longer tries to fetch releases from the dead GitHub
org — it installs the bundled binary and prints the CLI self-check.

Verify after install:

```bash
falconproxy --help
systemctl status falconproxy
ss -tlnp | grep falconproxy
# expected: LISTEN on 0.0.0.0:8080 and 0.0.0.0:8880 (or :::)
```

## Port 80 coexistence (proxy + nginx)

`falconproxy` is a compiled Rust binary with **no `SO_REUSEPORT`**, so it cannot
share port 80 with nginx by binding it directly — whichever starts second gets
`Address already in use`, and the menu's `check_and_free_ports()` would offer to
stop the web server ("add port 80 → nginx turns off").

The supported way to have **both on port 80**: nginx keeps `:80` and *fronts*
the proxy (WebSocket upgrade + `proxy_pass`):

```
payload client -> server:80 (nginx) --WS upgrade--> 127.0.0.1:8080 (falconproxy)
```

Client tools that use "the proxy on port 80" connect to `SERVER_IP:80` as
usual; nginx still answers certbot HTTP-01 challenges on `/.well-known/…`.

- The patched `menu` automates this: in *Install Falcon Proxy*, enter port 80;
  when it detects nginx on `:80`, choose option **1** — it writes
  `falconproxy-on-80` and skips binding 80 on the proxy.
- Manual alternative (no re-upload needed):

```bash
cat > /etc/nginx/sites-available/falconproxy-on-80 <<'NGX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_tokens off;
    server_name _;
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type text/plain;
    }
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
        proxy_buffering off;
        proxy_request_buffering off;
    }
}
NGX
ln -sf /etc/nginx/sites-available/falconproxy-on-80 /etc/nginx/sites-enabled/falconproxy-on-80
rm -f /etc/nginx/sites-enabled/default      # avoid a default_server clash
nginx -t && systemctl reload nginx
```

The reference config lives at `config/nginx/falconproxy-on-80.conf`.

> **Heads-up on port 8880**: the edge stack's nginx binds `127.0.0.1:8880`
> (internal cleartext). If you later activate the edge/SSL flow, a proxy
> listener on 8880 (all interfaces) will overlap it — keep the proxy pair on
> 8080 + a non-colliding port (e.g. 8888, as the original server used).

## deSEC / DNS

The menu's DNS automation (generate subdomain, DNSTT auto records) reads
`/etc/vpsmanagerpro/desec.conf`:

```
DESEC_TOKEN="<your token>"
DESEC_DOMAIN="<your zone, e.g. myserver.dedyn.io>"
```

Register a free zone at <https://desec.io> and create a token with DNS
permissions. If the file is missing/empty the menu aborts those options with a
friendly hint instead of using hardcoded (leaked) credentials. The token from
the original server is **not** shipped in this build.

## What to configure manually after install

All of the below are done from the `menu` (same flows as the original server):

1. **Add users** — the account manager creates real system users and rows in
   `users.db` (`user:pass:YYYY-MM-DD:maxconn:killswitch:user|trial`).
2. **Install protocols** — Falcon Proxy, DNSTT, UDP Custom (+udpgw), ZiVPN,
   3X-UI, badvpn.
3. **Edge stack** — nginx + HAProxy on ports 80/443, routing raw SSH, HTTP/WS
   and TLS payloads per the templates in `config/`.
4. **Edge TLS** — certbot (choose a domain) or self-sign. `edge_cert.conf`
   mode drives this.
5. **SSH banner** — static `Banner /etc/bannerssh` or the per-user dynamic
   banner system.
6. **Trial cleanup / limits** — handled by the limiter service automatically.

## Web control panel (`panel/`)

A separate admin-only web UI for managing everything on the server — users,
bandwidth, services, protocols, DNS, banners and activity. It is a Next.js 14
(TypeScript) app that runs **as root on `127.0.0.1:3100`** behind nginx TLS.

Features:

- Login with username/password **plus TOTP 2FA** (RFC 6238, no external auth
  service). First run sets the admin password and enrolls Google
  Authenticator/Authy via an on-screen QR code.
- **Users** — create/delete/edit accounts (real system users backed by
  `users.db`), lock/unlock, set expiry / max-logins / bandwidth quota.
- **Bandwidth** — live per-user usage vs. quota, tracked from the limiter's
  `/proc/<pid>/io` tallies, plus the live session table.
- **Services** — start/stop/restart/enable/disable for the known daemons
  (limiter, falconproxy, dnstt, udp-custom, udpgw, zivpn, x-ui, nginx, haproxy)
  via `systemctl`.
- **Protocols** — one-click installs of falconproxy / udp-custom / DNSTT /
  ZiVPN. Each runs as a background job whose log you can watch live.
- **DNS** — manage deSEC A/AAAA records for your domain (DNSTT subdomains),
  driven by the same `desec.conf` the menu uses.
- **Banner** — static `/etc/bannerssh` plus the per-user dynamic banner system.
- **Activity** — audit trail (`/etc/vpsmanagerpro/panel/audit.jsonl`).

--- `install.sh` now installs the panel automatically (no separate step). To
manually (re)install it later:

```bash
cd panel                      # the panel source directory
VMP_ADMIN_USER=admin bash install-panel.sh --hostname panel.example.com
```

- `install-panel.sh` installs the app to `/opt/vpsmanagerpro-panel`, seeds the
  bundled daemons, runs `npm install && npm run build`, installs the systemd
  unit (root, `127.0.0.1:3100`) and optionally writes an nginx TLS vhost
  (`certbot --nginx`). Use `--no-nginx` to skip the web server bits.
- State lives in `/etc/vpsmanagerpro/panel/` (`secret`, `admin.json`,
  `audit.jsonl`); install job logs under `/var/log/vpsmanagerpro-panel/jobs`.
- Only the admin can log in; privileged actions run the bundled root helper
  scripts in `panel/scripts/`.

## Security notes

- This rebuild reuses the **original binaries from the snapshot** so the
  feature set matches the old server exactly. Verify them against
  `SHA256SUMS` before deploying (`sha256sum -c SHA256SUMS`).
- The bundled `falconproxy` is dynamic-glibc and runs on stock Debian/Ubuntu.
  The other daemons (`dnstt-server`, `udpgw`, xray) are standard prebuilt
  x86-64 releases.
- `users.db` is plaintext by design (same as the original). Keep
  `/etc/vpsmanagerpro` root-only: `chmod 600` on `users.db` and `desec.conf`.
- On a shared/anonymous VPS, domain reputation matters: the old server used a
  deSEC subdomain; use your own.

## Rebuilding / extending

- `install.sh` only deploys. Protocol installers live inside `menu` and are
  what regenerate `/etc/systemd/system/*.service`.
- If you ever replace `daemons/falconproxy` with a new build, regenerate
  `SHA256SUMS`:
  `sha256sum menu daemons/* scripts/* panel/x-ui.sh panel/bin/* panel/install-panel.sh panel/src/** panel/scripts/* panel/systemd/* panel/config/** | tee SHA256SUMS`