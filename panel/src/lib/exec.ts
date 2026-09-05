import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

const DEFAULT_TIMEOUT = 240_000; // protocol installs can take a while
const DEFAULT_MAX_BUFFER = 4 * 1024 * 1024;

export function run(
  file: string,
  args: string[] = [],
  opts: { timeout?: number; maxBuffer?: number } = {}
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        timeout: opts.timeout ?? DEFAULT_TIMEOUT,
        maxBuffer: opts.maxBuffer ?? DEFAULT_MAX_BUFFER,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        resolve({
          code: error ? (typeof (error as any).code === "number" ? (error as any).code : 1) : 0,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        });
      }
    );
  });
}

export function readFileOr(path: string, fallback = ""): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return fallback;
  }
}

export function exists(path: string): boolean {
  return existsSync(path);
}

export function parseKeyValueConf(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return out;
}

export function writeFileExclusive(path: string, data: string, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data, { mode, flag: "wx" });
}

/** Returns the public IPv4 of this server (best-effort). */
export async function publicIPv4(): Promise<string> {
  const r = await run("/bin/bash", ["-lc", `curl -s -4 --max-time 6 https://icanhazip.com`], { timeout: 10_000 });
  const ip = r.stdout.trim();
  return /^[0-9.]+$/.test(ip) ? ip : "";
}