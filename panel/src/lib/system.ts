import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { run } from "./exec";
import { BANDWIDTH_DIR, KNOWN_SERVICES, PID_DIR } from "./paths";

export interface CpuInfo {
  cores: number;
  load1: number;
  load5: number;
  load15: number;
}

export interface MemInfo {
  totalKb: number;
  freeKb: number;
  availKb: number;
}

export interface DiskInfo {
  total: number;
  used: number;
}

export interface ServiceHealth {
  name: string;
  active: boolean;
  enabled: boolean;
  running: boolean;
  description?: string;
}

export function readLoad(): CpuInfo {
  let cores = 0;
  try {
    cores = Number(readFileSync("/proc/cpuinfo", "utf8").match(/^processor\s*:/gm)?.length ?? 0) || 0;
  } catch { /* non-Linux: no /proc/cpuinfo */ }
  let l1 = 0, l5 = 0, l15 = 0;
  try {
    const [a, b, c] = readFileSync("/proc/loadavg", "utf8").trim().split(/\s+/);
    l1 = parseFloat(a); l5 = parseFloat(b); l15 = parseFloat(c);
  } catch { /* ignore */ }
  return { cores, load1: l1, load5: l5, load15: l15 };
}

export function readMem(): MemInfo | null {
  try {
    const total = Number(readFileSync("/proc/meminfo", "utf8").match(/MemTotal:\s+(\d+)/)?.[1] ?? 0);
    const avail = Number(readFileSync("/proc/meminfo", "utf8").match(/MemAvailable:\s+(\d+)/)?.[1] ?? 0);
    const free = Number(readFileSync("/proc/meminfo", "utf8").match(/MemFree:\s+(\d+)/)?.[1] ?? 0);
    return { totalKb: total, freeKb: free, availKb: avail };
  } catch {
    return null;
  }
}

export async function readDisk(): Promise<DiskInfo> {
  // df -B1 / gives exact byte accounting without privileged reads.
  try {
    const r = await run("/bin/df", ["-B1", "--output=size,used,avail", "/"], { timeout: 5_000 });
    const lines = r.stdout.split("\n").filter((l) => l.trim().length > 1);
    const row = lines[1]?.split(/\s+/);
    if (!row || row.length < 2) return { total: 0, used: 0 };
    const total = parseInt(row[0], 10) || 0;
    const used = parseInt(row[1], 10) || 0;
    return { total, used };
  } catch {
    return { total: 0, used: 0 };
  }
}

export function uptimeSeconds(): number {
  try {
    const n = Number(readFileSync("/proc/uptime", "utf8").trim().split(/\s+/)[0]);
    return Number.isNaN(n) ? 0 : n;
  } catch {
    return 0;
  }
}

export async function listServices(): Promise<ServiceHealth[]> {
  const out: ServiceHealth[] = [];
  for (const name of KNOWN_SERVICES) {
    const status = await run("/bin/bash", ["-lc", `systemctl show "${name}.service" --property=ActiveState,SubState,UnitFileState,Description 2>/dev/null || true`], { timeout: 10_000 });
    const kv: Record<string, string> = {};
    for (const line of status.stdout.trim().split("\n")) {
      const i = line.indexOf("=");
      if (i === -1) continue;
      kv[line.slice(0, i)] = line.slice(i + 1);
    }
    const active = kv.ActiveState === "active";
    out.push({
      name,
      active,
      enabled: kv.UnitFileState === "enabled",
      running: kv.SubState === "running",
      description: kv.Description,
    });
  }
  return out;
}

export async function serviceAction(name: string, action: string): Promise<{ ok: boolean; error?: string }> {
  const allowed = new Set(["start", "stop", "restart", "enable", "disable"]);
  if (!allowed.has(action) || !KNOWN_SERVICES.includes(name as (typeof KNOWN_SERVICES)[number])) {
    return { ok: false, error: "unknown service or action" };
  }
  const script = `systemctl ${action} "${name}.service" 2>&1; rc=$?; exit $rc`;
  const r = await run("/bin/bash", ["-lc", script], { timeout: 60_000 });
  return r.code === 0 ? { ok: true } : { ok: false, error: (r.stderr || r.stdout).trim() };
}

export interface SessionInfo {
  user: string;
  pid: number;
  lastActive: string;
}

/** Enumerates live sessions from pidtrack/<user>__<pid>.last (live pids only). */
export function listSessions(): SessionInfo[] {
  const sessions: SessionInfo[] = [];
  if (!existsSync(PID_DIR)) return sessions;
  for (const file of readdirSync(PID_DIR)) {
    const m = file.match(/^(.*?)__(\d+)\.last$/);
    if (!m) continue;
    const user = m[1];
    const pid = parseInt(m[2], 10);
    if (!existsSync(`/proc/${pid}`)) continue;
    sessions.push({
      user,
      pid,
      lastActive: statSync(`${PID_DIR}/${file}`).mtime.toISOString(),
    });
  }
  return sessions;
}

export function bandwidthRecords(): Record<string, number> {
  const out: Record<string, number> = {};
  if (!existsSync(BANDWIDTH_DIR)) return out;
  for (const file of readdirSync(BANDWIDTH_DIR)) {
    if (!file.endsWith(".usage")) continue;
    const user = file.slice(0, -".usage".length);
    try {
      const n = parseInt(readFileSync(`${BANDWIDTH_DIR}/${file}`, "utf8").replace(/[^0-9]/g, ""), 10);
      if (!Number.isNaN(n)) out[user] = n;
    } catch { /* ignore */ }
  }
  return out;
}