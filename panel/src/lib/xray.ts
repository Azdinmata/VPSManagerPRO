import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { run, publicIPv4 } from "./exec";
import { XRAY_ACCOUNTS_FILE, XRAY_CONFIG_FILE, XRAY_SERVICE, XRAY_SSL_DIR } from "./paths";

export type XrayProtocol = "trojan" | "vless" | "vmess";

export interface XrayAccount {
  id: string;
  protocol: XrayProtocol;
  name: string;
  secret: string;
  port: number;
  flow?: string;
  network: "tcp" | "ws";
  path?: string;
  createdAt: string;
}

interface XrayStore {
  server: string;
  tlsCert: string;
  tlsKey: string;
  accounts: XrayAccount[];
}

function defaultStore(): XrayStore {
  return {
    server: "",
    tlsCert: `${XRAY_SSL_DIR}/vpsmanagerpro.crt`,
    tlsKey: `${XRAY_SSL_DIR}/vpsmanagerpro.key`,
    accounts: [],
  };
}

export function readXrayStore(): XrayStore {
  try {
    const raw = readFileSync(XRAY_ACCOUNTS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<XrayStore>;
    return {
      ...defaultStore(),
      ...parsed,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    };
  } catch {
    return defaultStore();
  }
}

export function saveXrayStore(store: XrayStore): void {
  mkdirSync(dirname(XRAY_ACCOUNTS_FILE), { recursive: true });
  writeFileSync(XRAY_ACCOUNTS_FILE, JSON.stringify(store, null, 2) + "\n", { mode: 0o600 });
}

/** Best-effort advertised host: configured server name, edge domain, else public IP. */
export async function xrayServerHost(store: XrayStore): Promise<string> {
  if (store.server) return store.server;
  const ip = await publicIPv4();
  return ip || "your-server-ip";
}

export function generateSecret(protocol: XrayProtocol): string {
  if (protocol === "trojan") {
    const b = randomBytes(18);
    return Buffer.from(b).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
  }
  return randomUUID();
}

const DEFAULT_PORTS: Record<XrayProtocol, number> = { trojan: 443, vless: 8443, vmess: 8444 };
const DEFAULT_PATHS: Record<XrayProtocol, string> = { trojan: "", vless: "/vless", vmess: "/vmess" };

export function defaultPort(protocol: XrayProtocol): number {
  return DEFAULT_PORTS[protocol];
}

const MUX_INNER_VLESS_BASE = 10001;

function distinct<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function pathOr(a: XrayAccount, fallback: string): string {
  return a.path && a.path.trim() !== "" ? a.path : fallback;
}

/** True when the given port is the TLS entry point of a Trojan (TCP) inbound. */
function trojanMuxPort(store: XrayStore, port: number): boolean {
  return store.accounts.some((a) => a.protocol === "trojan" && a.network === "tcp" && a.port === port);
}

function buildTrojanInbound(store: XrayStore, accounts: XrayAccount[], fallbacks: Array<{ path: string; dest: string }>) {
  const inbound: Record<string, unknown> = {
    tag: `trojan-${accounts[0].id}`,
    protocol: "trojan",
    port: accounts[0].port,
    settings: {
      clients: accounts.map((a) => ({ password: a.secret, email: a.name })),
      decryption: "none",
    },
    streamSettings: {
      network: "tcp",
      security: "tls",
      tlsSettings: {
        certificates: [{ certificateFile: store.tlsCert, keyFile: store.tlsKey }],
      },
    },
  };
  if (fallbacks.length) {
    inbound.settings = { ...(inbound.settings as Record<string, unknown>), fallbacks };
  }
  return inbound;
}

function buildWSInbound(slot: number, protocol: "vless" | "vmess", accounts: XrayAccount[]) {
  return {
    tag: `${protocol}-inner-${slot}`,
    protocol,
    port: slot,
    listen: "127.0.0.1",
    settings:
      protocol === "vless"
        ? { clients: accounts.map((a) => ({ id: a.secret, email: a.name, flow: a.flow ?? "" })), decryption: "none" }
        : { clients: accounts.map((a) => ({ id: a.secret, email: a.name, alterId: 0 })) },
    streamSettings: {
      network: "ws",
      security: "none",
      wsSettings: { path: pathOr(accounts[0], protocol === "vless" ? DEFAULT_PATHS.vless : DEFAULT_PATHS.vmess) },
    },
  };
}

function buildLegacyInbound(store: XrayStore, account: XrayAccount) {
  const base: Record<string, unknown> = {
    tag: `${account.protocol}-${account.id}`,
    protocol: account.protocol,
    port: account.port,
    settings: {},
  };

  if (account.protocol === "trojan") {
    base.settings = {
      clients: [{ password: account.secret, email: account.name }],
      decryption: "none",
    };
    base.streamSettings = {
      network: account.network,
      security: "tls",
      tlsSettings: {
        certificates: [{ certificateFile: store.tlsCert, keyFile: store.tlsKey }],
      },
    };
    if (account.network === "ws") {
      (base.streamSettings as Record<string, unknown>).wsSettings = { path: pathOr(account, DEFAULT_PATHS.trojan) };
    }
    return base;
  }

  if (account.protocol === "vless") {
    base.settings = {
      clients: [{ id: account.secret, email: account.name, flow: account.flow ?? "" }],
      decryption: "none",
    };
    base.streamSettings = {
      network: account.network,
      security: "none",
      wsSettings: account.network === "ws" ? { path: pathOr(account, DEFAULT_PATHS.vless) } : undefined,
    };
    return base;
  }

  // vmess
  base.settings = {
    clients: [{ id: account.secret, email: account.name, alterId: 0 }],
  };
  base.streamSettings = {
    network: account.network,
    security: "none",
    wsSettings: account.network === "ws" ? { path: pathOr(account, DEFAULT_PATHS.vmess) } : undefined,
  };
  return base;
}

/**
 * Writes an Xray JSON config. When Trojan(TCP) accounts exist, a single TLS
 * "Trojan" inbound terminates TLS and uses WebSocket path fallbacks into loopback
 * VLESS/VMess inbounds — one public port, all three protocols. Otherwise one
 * inbound per account is emitted.
 */
export function buildXrayConfig(store: XrayStore): string {
  const trojanTcp = store.accounts.filter((a) => a.protocol === "trojan" && a.network === "tcp");
  // Everything except muxed members: only Trojan-over-WS accounts can still need a
  // legacy inbound when the mux is active (VLESS/VMess get loopback inner inbounds).
  const other = store.accounts.filter((a) => a.protocol === "trojan" && a.network !== "tcp");
  const vless = store.accounts.filter((a) => a.protocol === "vless");
  const vmess = store.accounts.filter((a) => a.protocol === "vmess");

  let inbounds: Record<string, unknown>[];

  if (trojanTcp.length > 0) {
    const vlessPaths = Array.from(distinct(vless.map((a) => pathOr(a, DEFAULT_PATHS.vless))));
    const vmessPaths = Array.from(distinct(vmess.map((a) => pathOr(a, DEFAULT_PATHS.vmess))));
    let nextInner = MUX_INNER_VLESS_BASE;
    const vlessPort = new Map(vlessPaths.map((p) => [p, nextInner++] as const));
    const vmessPort = new Map(vmessPaths.map((p) => [p, nextInner++] as const));

    const fallbacks: Array<{ path: string; dest: string }> = [
      ...vlessPaths.map((p) => ({ path: p, dest: `127.0.0.1:${vlessPort.get(p)!}` })),
      ...vmessPaths.map((p) => ({ path: p, dest: `127.0.0.1:${vmessPort.get(p)!}` })),
    ];

    const trojanByPort = new Map<number, XrayAccount[]>();
    for (const a of trojanTcp) {
      if (!trojanByPort.has(a.port)) trojanByPort.set(a.port, []);
      trojanByPort.get(a.port)!.push(a);
    }

    const muxInbounds = Array.from(trojanByPort.values()).map((group) => buildTrojanInbound(store, group, fallbacks));
    const innerInbounds: Record<string, unknown>[] = [];
    for (const p of vlessPaths) {
      innerInbounds.push(buildWSInbound(vlessPort.get(p)!, "vless", vless.filter((a) => pathOr(a, DEFAULT_PATHS.vless) === p)));
    }
    for (const p of vmessPaths) {
      innerInbounds.push(buildWSInbound(vmessPort.get(p)!, "vmess", vmess.filter((a) => pathOr(a, DEFAULT_PATHS.vmess) === p)));
    }

    inbounds = [...muxInbounds, ...other.map((a) => buildLegacyInbound(store, a)), ...innerInbounds];
  } else {
    inbounds = store.accounts.map((a) => buildLegacyInbound(store, a));
  }

  const config = {
    log: { loglevel: "warning" },
    inbounds,
    outbounds: [{ protocol: "freedom", tag: "direct" }],
  };
  return JSON.stringify(config, null, 2);
}

export function applyXrayConfig(store: XrayStore): void {
  mkdirSync(dirname(XRAY_CONFIG_FILE), { recursive: true });
  writeFileSync(XRAY_CONFIG_FILE, buildXrayConfig(store) + "\n", { mode: 0o644 });
}

export function xrayBinaryInstalled(): boolean {
  return existsSync("/usr/local/bin/xray");
}

export async function xrayServiceActive(): Promise<boolean> {
  const r = await run("/bin/bash", ["-lc", `systemctl is-active ${XRAY_SERVICE}.service 2>/dev/null || true`], { timeout: 10_000 });
  return r.stdout.trim() === "active";
}

export async function restartXray(): Promise<{ ok: boolean; error?: string }> {
  if (!xrayBinaryInstalled()) return { ok: false, error: "xray binary not installed" };
  if (!existsSync(XRAY_CONFIG_FILE)) {
    const store = readXrayStore();
    applyXrayConfig(store);
  }
  const r = await run("/bin/bash", ["-lc", `systemctl restart ${XRAY_SERVICE}.service 2>&1; rc=$?; exit $rc`], { timeout: 60_000 });
  return r.code === 0 ? { ok: true } : { ok: false, error: (r.stderr || r.stdout).trim() };
}

async function buildClientLink(store: XrayStore, account: XrayAccount): Promise<string> {
  const host = await xrayServerHost(store);
  const name = encodeURIComponent(account.name);
  const muxed = account.protocol !== "trojan" && trojanMuxPort(store, account.port);

  if (account.protocol === "trojan") {
    const query =
      account.network === "ws"
        ? `security=tls&type=ws&path=${encodeURIComponent(pathOr(account, DEFAULT_PATHS.trojan))}&host=${host}&sni=${host}&allowInsecure=1#${name}`
        : `security=tls&type=tcp&sni=${host}&allowInsecure=1#${name}`;
    return `trojan://${account.secret}@${host}:${account.port}?${query}`;
  }

  if (account.protocol === "vless") {
    const query =
      account.network === "ws"
        ? muxed
          ? `type=ws&path=${encodeURIComponent(pathOr(account, DEFAULT_PATHS.vless))}&host=${host}&security=tls&sni=${host}&allowInsecure=1&encryption=none#${name}`
          : `type=ws&path=${encodeURIComponent(pathOr(account, DEFAULT_PATHS.vless))}&host=${host}&security=none&encryption=none#${name}`
        : `type=tcp&security=none&encryption=none#${name}`;
    return `vless://${account.secret}@${host}:${account.port}?${query}`;
  }

  // vmess — JSON encoded into vmess://
  const vmess: Record<string, string> = {
    v: "2",
    ps: account.name,
    add: host,
    port: account.port.toString(),
    id: account.secret,
    aid: "0",
    net: account.network,
    type: account.network === "ws" ? "ws" : "none",
    host,
    path: account.network === "ws" ? pathOr(account, DEFAULT_PATHS.vmess) : "",
    tls: muxed ? "tls" : "none",
    scy: "auto",
  };
  if (muxed) {
    vmess.sni = host;
    vmess.allowInsecure = "1";
  }
  return `vmess://${Buffer.from(JSON.stringify(vmess)).toString("base64")}`;
}

export interface XrayAccountWithLink extends XrayAccount {
  link: string;
}

/** Share link for a single account (used when returning a fresh account to callers). */
export async function xrayLinkForAccount(account: XrayAccount): Promise<string> {
  return buildClientLink(readXrayStore(), account);
}

export async function listXrayAccounts(): Promise<{
  accounts: XrayAccountWithLink[];
  store: XrayStore;
}> {
  const store = readXrayStore();
  const accounts: XrayAccountWithLink[] = [];
  for (const a of store.accounts) {
    accounts.push({ ...a, link: await buildClientLink(store, a) });
  }
  return { accounts, store };
}

export function addXrayAccount(
  input: { protocol: XrayProtocol; name: string; port?: number; network?: "tcp" | "ws"; path?: string; flow?: string }
): XrayAccount {
  const store = readXrayStore();
  const account: XrayAccount = {
    id: randomUUID(),
    protocol: input.protocol,
    name: input.name,
    secret: generateSecret(input.protocol),
    port: input.port && input.port > 0 && input.port < 65536 ? input.port : defaultPort(input.protocol),
    flow: input.protocol === "vless" ? input.flow || "" : undefined,
    network: input.network ?? (input.protocol === "trojan" ? "tcp" : "ws"),
    path: input.path || (input.protocol === "trojan" ? "" : DEFAULT_PATHS[input.protocol]),
    createdAt: new Date().toISOString(),
  };
  store.accounts.push(account);
  saveXrayStore(store);
  applyXrayConfig(store);
  return account;
}

export function removeXrayAccount(id: string): boolean {
  const store = readXrayStore();
  const before = store.accounts.length;
  store.accounts = store.accounts.filter((a) => a.id !== id);
  if (store.accounts.length === before) return false;
  saveXrayStore(store);
  applyXrayConfig(store);
  return true;
}

/** Returns v2ray accounts whose name matches a given account username. */
export function xrayAccountsForUser(username: string): XrayAccount[] {
  const store = readXrayStore();
  return store.accounts.filter((a) => a.name === username);
}

/** V2ray accounts for a user, each with its full share link. */
export async function xrayLinksForUser(username: string): Promise<XrayAccountWithLink[]> {
  const store = readXrayStore();
  const accounts = store.accounts.filter((a) => a.name === username);
  const out: XrayAccountWithLink[] = [];
  for (const a of accounts) {
    out.push({ ...a, link: await buildClientLink(store, a) });
  }
  return out;
}

/** Removes every v2ray account tied to a username. Returns number removed. */
export function removeXrayAccountsForUser(username: string): number {
  const store = readXrayStore();
  const before = store.accounts.length;
  store.accounts = store.accounts.filter((a) => a.name !== username);
  if (store.accounts.length === before) return 0;
  saveXrayStore(store);
  applyXrayConfig(store);
  return before - store.accounts.length;
}

/**
 * Creates a full V2Ray bundle for one account — one identity per protocol so a
 * single created account works across all configs (Trojan+TLS over TCP, VLESS
 * and VMess over WebSocket).
 */
export function addXrayBundle(
  username: string,
  opts: { include: XrayProtocol[] } = { include: ["trojan", "vless", "vmess"] }
): XrayAccount[] {
  let store = readXrayStore();
  const created: XrayAccount[] = [];
  for (const protocol of opts.include) {
    const account: XrayAccount = {
      id: randomUUID(),
      protocol,
      name: username,
      secret: generateSecret(protocol),
      // All bundle members share the single TLS entry port (443 by default) so
      // Trojan terminates TLS and VLESS/VMess ride the same port via WS fallback.
      port: 443,
      flow: protocol === "vless" ? "" : undefined,
      network: protocol === "trojan" ? "tcp" : "ws",
      path: protocol === "trojan" ? "" : DEFAULT_PATHS[protocol],
      createdAt: new Date().toISOString(),
    };
    store = readXrayStore();
    store.accounts.push(account);
    created.push(account);
    saveXrayStore(store);
  }
  applyXrayConfig(store);
  return created;
}

/** Bundle share links for a user across all protocols (empty array if none). */
export async function xrayBundleForUser(username: string): Promise<XrayAccountWithLink[]> {
  return xrayLinksForUser(username);
}