#!/usr/bin/env node
"use strict";
/*
 * VPSManagerPRO - V2Ray/Xray bundle generator (CLI twin).
 * Faithful port of panel/src/lib/xray.ts (addXrayBundle + buildXrayConfig +
 * buildClientLink). Produces the one-port-443 TLS multiplex: a Trojan TLS
 * inbound with WebSocket path fallbacks into loopback VLESS/VMess inbounds.
 *
 * usage: node xray-bundle.js [--name NAME] [--print-links] [--dry-run]
 *   --name NAME     used only when creating a fresh bundle (no accounts yet)
 *   --print-links   print client share links for every account
 *   --dry-run       print what WOULD be written / nothing is changed
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const XRAY_DIR = process.env.VMP_XRAY_DIR || "/etc/vpsmanagerpro/xray";
const ACCOUNTS_FILE = process.env.VMP_XRAY_ACCOUNTS_FILE || path.join(XRAY_DIR, "accounts.json");
const CONFIG_FILE = process.env.VMP_XRAY_CONFIG_FILE || path.join(XRAY_DIR, "config.json");
const TLS_CERT = process.env.VMP_TLS_CERT || "/etc/vpsmanagerpro/ssl/vpsmanagerpro.crt";
const TLS_KEY = process.env.VMP_TLS_KEY || "/etc/vpsmanagerpro/ssl/vpsmanagerpro.key";
const XRAY_SERVICE = "vpsmanagerpro-xray";

const MUX_INNER_VLESS_BASE = 10001;
const DEFAULT_PATHS = { trojan: "", vless: "/vless", vmess: "/vmess" };

let name = "demo", printLinks = false, dryRun = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--print-links") printLinks = true;
  else if (a === "--dry-run") dryRun = true;
  else if (a === "--name") name = argv[++i] || name;
  else if (a.startsWith("--name=")) name = a.slice(7);
}
if (!/^[A-Za-z0-9_.-]{1,32}$/.test(name)) {
  console.error("error: invalid account name '" + name + "' (1-32 chars [A-Za-z0-9_.-])");
  process.exit(2);
}

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}
function uuid() {
  try { return sh("cat /proc/sys/kernel/random/uuid"); } catch { return "00000000-0000-4000-8000-000000000000"; }
}
function trojanSecret() {
  try {
    const s = sh("openssl rand -base64 27").replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
    if (s) return s;
  } catch {}
  try {
    return sh("head -c 27 /dev/urandom | base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
  } catch { return "Xy3demoSecret0000000000000"; }
}
function serverIP() {
  try {
    const ip = sh("curl -s -4 --max-time 6 https://icanhazip.com");
    if (/^[0-9.]+$/.test(ip)) return ip;
  } catch {}
  try {
    const ip = sh("hostname -I").split(/\s+/)[0];
    if (ip) return ip;
  } catch {}
  return "your-server-ip";
}
function ts() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
}
function pathOr(a, fb) {
  return a.path && String(a.path).trim() !== "" ? String(a.path) : fb;
}
function distinct(arr) {
  return Array.from(new Set(arr));
}

function readStore() {
  try {
    const p = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
    return {
      server: p.server || "",
      tlsCert: p.tlsCert || TLS_CERT,
      tlsKey: p.tlsKey || TLS_KEY,
      accounts: Array.isArray(p.accounts) ? p.accounts : [],
    };
  } catch {
    return { server: "", tlsCert: TLS_CERT, tlsKey: TLS_KEY, accounts: [] };
  }
}
function saveStore(s) {
  fs.mkdirSync(path.dirname(ACCOUNTS_FILE), { recursive: true });
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
}

function trojanMuxPort(store, port) {
  return store.accounts.some((a) => a.protocol === "trojan" && a.network === "tcp" && a.port === port);
}

function legacyInbound(store, a) {
  const base = { tag: a.protocol + "-" + a.id, protocol: a.protocol, port: a.port, settings: {} };
  if (a.protocol === "trojan") {
    base.settings = { clients: [{ password: a.secret, email: a.name }], decryption: "none" };
    base.streamSettings = {
      network: a.network,
      security: "tls",
      tlsSettings: { certificates: [{ certificateFile: store.tlsCert, keyFile: store.tlsKey }] },
    };
    if (a.network === "ws") base.streamSettings.wsSettings = { path: pathOr(a, DEFAULT_PATHS.trojan) };
    return base;
  }
  if (a.protocol === "vless") {
    base.settings = { clients: [{ id: a.secret, email: a.name, flow: a.flow || "" }], decryption: "none" };
    base.streamSettings = {
      network: a.network,
      security: "none",
      wsSettings: a.network === "ws" ? { path: pathOr(a, DEFAULT_PATHS.vless) } : undefined,
    };
    return base;
  }
  base.settings = { clients: [{ id: a.secret, email: a.name, alterId: 0 }] };
  base.streamSettings = {
    network: a.network,
    security: "none",
    wsSettings: a.network === "ws" ? { path: pathOr(a, DEFAULT_PATHS.vmess) } : undefined,
  };
  return base;
}

function buildConfig(store) {
  const trojanTcp = store.accounts.filter((a) => a.protocol === "trojan" && a.network === "tcp");
  const other = store.accounts.filter((a) => a.protocol === "trojan" && a.network !== "tcp");
  const vless = store.accounts.filter((a) => a.protocol === "vless");
  const vmess = store.accounts.filter((a) => a.protocol === "vmess");
  const inbounds = [];

  if (trojanTcp.length > 0) {
    const vlessPaths = distinct(vless.map((a) => pathOr(a, DEFAULT_PATHS.vless)));
    const vmessPaths = distinct(vmess.map((a) => pathOr(a, DEFAULT_PATHS.vmess)));
    let next = MUX_INNER_VLESS_BASE;
    const vp = new Map(vlessPaths.map((p) => [p, next++]));
    const mp = new Map(vmessPaths.map((p) => [p, next++]));
    const fallbacks = [
      ...vlessPaths.map((p) => ({ path: p, dest: "127.0.0.1:" + vp.get(p) })),
      ...vmessPaths.map((p) => ({ path: p, dest: "127.0.0.1:" + mp.get(p) })),
    ];

    const byPort = new Map();
    for (const a of trojanTcp) {
      if (!byPort.has(a.port)) byPort.set(a.port, []);
      byPort.get(a.port).push(a);
    }
    for (const group of byPort.values()) {
      inbounds.push({
        tag: "trojan-" + group[0].id,
        protocol: "trojan",
        port: group[0].port,
        settings: { clients: group.map((a) => ({ password: a.secret, email: a.name })), decryption: "none", fallbacks },
        streamSettings: {
          network: "tcp",
          security: "tls",
          tlsSettings: { certificates: [{ certificateFile: store.tlsCert, keyFile: store.tlsKey }] },
        },
      });
    }

    for (const a of other) inbounds.push(legacyInbound(store, a));

    for (const p of vlessPaths) {
      inbounds.push({
        tag: "vless-inner-" + vp.get(p),
        protocol: "vless",
        port: vp.get(p),
        listen: "127.0.0.1",
        settings: {
          clients: vless.filter((a) => pathOr(a, DEFAULT_PATHS.vless) === p).map((a) => ({ id: a.secret, email: a.name, flow: a.flow || "" })),
          decryption: "none",
        },
        streamSettings: { network: "ws", security: "none", wsSettings: { path: p } },
      });
    }
    for (const p of vmessPaths) {
      inbounds.push({
        tag: "vmess-inner-" + mp.get(p),
        protocol: "vmess",
        port: mp.get(p),
        listen: "127.0.0.1",
        settings: {
          clients: vmess.filter((a) => pathOr(a, DEFAULT_PATHS.vmess) === p).map((a) => ({ id: a.secret, email: a.name, alterId: 0 })),
        },
        streamSettings: { network: "ws", security: "none", wsSettings: { path: p } },
      });
    }
  } else {
    for (const a of store.accounts) inbounds.push(legacyInbound(store, a));
  }

  return { log: { loglevel: "warning" }, inbounds, outbounds: [{ protocol: "freedom", tag: "direct" }] };
}

function buildLinks(store) {
  const host = store.server || serverIP();
  const enc = encodeURIComponent;
  const out = [];
  for (const a of store.accounts) {
    const nm = enc(a.name);
    const muxed = a.protocol !== "trojan" && trojanMuxPort(store, a.port);
    let link = "";
    if (a.protocol === "trojan") {
      link =
        a.network === "ws"
          ? `trojan://${a.secret}@${host}:${a.port}?security=tls&type=ws&path=${enc(pathOr(a, DEFAULT_PATHS.trojan))}&host=${host}&sni=${host}&allowInsecure=1#${nm}`
          : `trojan://${a.secret}@${host}:${a.port}?security=tls&type=tcp&sni=${host}&allowInsecure=1#${nm}`;
    } else if (a.protocol === "vless") {
      link =
        a.network === "ws"
          ? muxed
            ? `vless://${a.secret}@${host}:${a.port}?type=ws&path=${enc(pathOr(a, DEFAULT_PATHS.vless))}&host=${host}&security=tls&sni=${host}&allowInsecure=1&encryption=none#${nm}`
            : `vless://${a.secret}@${host}:${a.port}?type=ws&path=${enc(pathOr(a, DEFAULT_PATHS.vless))}&host=${host}&security=none&encryption=none#${nm}`
          : `vless://${a.secret}@${host}:${a.port}?type=tcp&security=none&encryption=none#${nm}`;
    } else {
      const vm = {
        v: "2", ps: a.name, add: host, port: String(a.port), id: a.secret, aid: "0",
        net: a.network, type: a.network === "ws" ? "ws" : "none", host: host,
        path: a.network === "ws" ? pathOr(a, DEFAULT_PATHS.vmess) : "", tls: muxed ? "tls" : "none", scy: "auto",
      };
      if (muxed) { vm.sni = host; vm.allowInsecure = "1"; }
      link = `vmess://${Buffer.from(JSON.stringify(vm)).toString("base64")}`;
    }
    out.push({ name: a.name, protocol: a.protocol, port: a.port, link });
  }
  return out;
}

let store = readStore();
if (store.accounts.length === 0) {
  if (dryRun) {
    console.log("[dry-run] would create a fresh bundle for '" + name + "'");
  } else {
    if (!store.server) store.server = serverIP();
    store.accounts = [
      { id: uuid(), protocol: "vless", name, secret: uuid(), port: 443, flow: "", network: "ws", path: "/vless", createdAt: ts() },
      { id: uuid(), protocol: "vmess", name, secret: uuid(), port: 443, network: "ws", path: "/vmess", createdAt: ts() },
      { id: uuid(), protocol: "trojan", name, secret: trojanSecret(), port: 443, network: "tcp", createdAt: ts() },
    ];
    saveStore(store);
    console.log("created fresh bundle for '" + name + "'");
  }
  store = readStore();
}

const config = buildConfig(store);
if (dryRun) {
  process.stdout.write(JSON.stringify(config, null, 2) + "\n");
} else {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", { mode: 0o644 });
  console.log("config written: " + CONFIG_FILE);
  if (printLinks) {
    for (const r of buildLinks(store)) console.log(`[${r.protocol}] ${r.link}`);
  }
}