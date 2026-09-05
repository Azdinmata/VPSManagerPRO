import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { PANEL_JOBS_DIR } from "./paths";

export type JobStatus = "running" | "done" | "failed";

export interface Job {
  id: string;
  label: string;
  cmd: string[];
  status: JobStatus;
  exitCode?: number;
  startedAt: string;
  finishedAt?: string;
}

function jobDir(id: string): string {
  return `${PANEL_JOBS_DIR}/${id}`;
}

export function startJob(
  label: string,
  cmd: string[],
  options?: { cwd?: string }
): Job {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = jobDir(id);
  mkdirSync(dir, { recursive: true });

  const meta: Job = {
    id,
    label,
    cmd,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  writeFileSync(`${dir}/meta.json`, JSON.stringify(meta, null, 2));
  writeFileSync(`${dir}/args`, JSON.stringify(cmd));

  const outFd = openSync(`${dir}/stdout.log`, "a");
  const child = spawn(cmd[0], cmd.slice(1), {
    detached: true,
    stdio: ["ignore", outFd, outFd],
    cwd: options?.cwd,
  });
  child.unref();
  writeFileSync(`${dir}/pid`, String(child.pid ?? ""));

  child.on("error", (err) => {
    finishJob(id, 1, String(err.message));
  });
  child.on("close", (code) => {
    finishJob(id, code ?? 0);
  });

  return { ...meta };
}

function finishJob(id: string, code: number, error?: string): void {
  const dir = jobDir(id);
  try {
    writeFileSync(`${dir}/exit`, String(code));
    if (error) writeFileSync(`${dir}/stderr.log`, error);
    const meta: Job = JSON.parse(readFileSync(`${dir}/meta.json`, "utf8"));
    meta.status = code === 0 ? "done" : "failed";
    meta.exitCode = code;
    meta.finishedAt = new Date().toISOString();
    writeFileSync(`${dir}/meta.json`, JSON.stringify(meta, null, 2));
  } catch { /* ignore */ }
}

export function getJob(id: string): Job | null {
  const dir = jobDir(id);
  if (!existsSync(dir)) return null;
  try {
    const meta: Job = JSON.parse(readFileSync(`${dir}/meta.json`, "utf8"));
    if (meta.status === "running") {
      const pidRaw = readFileSync(`${dir}/pid`, "utf8").trim();
      const pid = parseInt(pidRaw, 10);
      if (!Number.isNaN(pid) && !existsSync(`/proc/${pid}`)) {
        const exitRaw = readFileSync(`${dir}/exit`, "utf8").trim();
        finishJob(id, exitRaw ? parseInt(exitRaw, 10) : 1);
        return getJob(id);
      }
    }
    return meta;
  } catch {
    return null;
  }
}

export function listJobs(limit = 50): Job[] {
  if (!existsSync(PANEL_JOBS_DIR)) return [];
  return readdirSync(PANEL_JOBS_DIR)
    .map(getJob)
    .filter((j): j is Job => j !== null)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .slice(0, limit);
}

export function jobLog(id: string): string {
  try {
    return readFileSync(`${jobDir(id)}/stdout.log`, "utf8");
  } catch {
    return "";
  }
}

export function jobErrorLog(id: string): string {
  try {
    return readFileSync(`${jobDir(id)}/stderr.log`, "utf8");
  } catch {
    return "";
  }
}

export function pruneJobs(maxAgeMs = 2 * 24 * 3600 * 1000): number {
  if (!existsSync(PANEL_JOBS_DIR)) return 0;
  const now = Date.now();
  let pruned = 0;
  for (const id of readdirSync(PANEL_JOBS_DIR)) {
    try {
      const dir = jobDir(id);
      const pidRaw = readFileSync(`${dir}/pid`, "utf8").trim();
      const pid = parseInt(pidRaw, 10);
      const running = !Number.isNaN(pid) && existsSync(`/proc/${pid}`);
      if (running) continue;
      const stat = statSync(dir);
      if (now - stat.mtimeMs > maxAgeMs) {
        rmSync(dir, { recursive: true, force: true });
        pruned++;
      }
    } catch { /* ignore */ }
  }
  return pruned;
}