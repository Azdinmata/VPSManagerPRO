import { readFileSync } from "node:fs";
import { run, parseKeyValueConf } from "./exec";
import {
  DESEC_CONFIG_FILE,
  DNS_INFO_FILE,
  DNSTT_INFO_FILE,
  EDGE_CERT_FILE,
  NGINX_PORTS_FILE,
  PANEL_SCRIPTS_DIR,
} from "./paths";

export interface DesecConfig {
  token: string;
  domain: string;
}

export interface DnsInfo {
  domain: string;
  ip: string;
  dns1?: string;
  dns2?: string;
  subdomain?: string;
}

export function readDesecConfig(): DesecConfig | null {
  try {
    const conf = parseKeyValueConf(readFileSync(DESEC_CONFIG_FILE, "utf8"));
    if (!conf.token && !conf.DESEC_TOKEN) return null;
    return {
      token: conf.token || conf.DESEC_TOKEN,
      domain: conf.domain || conf.DNS_DOMAIN || conf.DESEC_DOMAIN || "",
    };
  } catch {
    return null;
  }
}

export function readDnsInfo(): DnsInfo {
  try {
    const conf = parseKeyValueConf(readFileSync(DNS_INFO_FILE, "utf8"));
    return {
      domain: conf.domain || conf.DNS_DOMAIN || "",
      ip: conf.ip || conf.IP || conf.hostname || "",
      dns1: conf.dns1 || conf.DNS1,
      dns2: conf.dns2 || conf.DNS2,
      subdomain: conf.subdomain || conf.SUBDOMAIN,
    };
  } catch {
    return { domain: "", ip: "" };
  }
}

export function readNginxPorts(): string[] {
  try {
    const conf = parseKeyValueConf(readFileSync(NGINX_PORTS_FILE, "utf8"));
    const raw = conf.port || conf.PORT || conf.ports || "";
    return raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s));
  } catch {
    return [];
  }
}

export function readEdgeCert(): string | null {
  try {
    return readFileSync(EDGE_CERT_FILE, "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function readDnsttInfo(): Record<string, string> {
  try {
    return parseKeyValueConf(readFileSync(DNSTT_INFO_FILE, "utf8"));
  } catch {
    return {};
  }
}

export interface RecordResult {
  subname: string;
  type: string;
  records: string[];
  ttl: number;
}

/**
 * Creates an A (and optionally AAAA) record via deSEC.pdns.
 * Wired to the exact payload shape the live menu uses (menu:1050).
 */
export async function createDesecRecord(
  subname: string,
  ipv4: string,
  ipv6?: string
): Promise<{ ok: boolean; records?: RecordResult[]; error?: string }> {
  const cfg = readDesecConfig();
  if (!cfg) return { ok: false, error: "deSEC not configured (run the installer first)" };
  if (!cfg.domain) return { ok: false, error: "Empty deSEC domain in config" };
  if (!/^[a-z0-9-]{1,63}$/i.test(subname)) return { ok: false, error: "Invalid subdomain label" };
  if (!/^[0-9.]+$/.test(ipv4)) return { ok: false, error: "Invalid IPv4" };

  const rrset: unknown[] = [{ subname, type: "A", ttl: 3600, records: [ipv4] }];
  if (ipv6 && /^[0-9a-fA-F:]+$/.test(ipv6)) {
    rrset.push({ subname, type: "AAAA", ttl: 3600, records: [ipv6] });
  }

  const script = `${PANEL_SCRIPTS_DIR}/desec-record.sh`;
  const payload = JSON.stringify(rrset);
  const r = await run("/bin/bash", ["-lc", `"${script}" ${JSON.stringify(payload)}`], { timeout: 30_000 });
  if (r.code !== 0) return { ok: false, error: (r.stderr || r.stdout).trim() || "deSEC API call failed" };
  try {
    const parsed = JSON.parse(r.stdout.trim()) as RecordResult[];
    return { ok: true, records: parsed };
  } catch {
    return { ok: true };
  }
}

export async function deleteDesecRecord(subname: string): Promise<{ ok: boolean; error?: string }> {
  const cfg = readDesecConfig();
  if (!cfg) return { ok: false, error: "deSEC not configured" };
  const script = `${PANEL_SCRIPTS_DIR}/desec-record.sh`;
  const r = await run("/bin/bash", ["-lc", `"${script}" delete ${JSON.stringify(subname)}`], { timeout: 30_000 });
  return r.code === 0 ? { ok: true } : { ok: false, error: (r.stderr || r.stdout).trim() || "deSEC delete failed" };
}