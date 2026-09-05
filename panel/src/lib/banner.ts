import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { run, readFileOr } from "./exec";
import {
  BANNER_DIR,
  DYNAMIC_BANNER_MARKER,
  SSHD_VMP_CONFIG,
  STATIC_BANNER_FILE,
} from "./paths";

export interface BannerState {
  enabled: boolean;
  staticBanner: string;
  dynamicEnabled: boolean;
  dynamicUsers: string[];
}

/** Static banner installed via the original installer (single content). */
export function readStaticBanner(): string {
  return readFileOr(STATIC_BANNER_FILE);
}

/** Per-user banner drop-in marker present? */
export function dynamicBannerEnabled(): boolean {
  return existsSync(DYNAMIC_BANNER_MARKER);
}

export function listDynamicBannerUsers(): string[] {
  const cfg = readFileOr(SSHD_VMP_CONFIG);
  const m = cfg.match(/^Match User (.+)$/m);
  if (!m) return [];
  return m[1].split(/\s+/).filter(Boolean);
}

export function readBannerState(): BannerState {
  return {
    enabled: readStaticBanner().trim().length > 0 || dynamicBannerEnabled(),
    staticBanner: readStaticBanner(),
    dynamicEnabled: dynamicBannerEnabled(),
    dynamicUsers: listDynamicBannerUsers(),
  };
}

export function readBannerFile(user: string): string {
  return readFileOr(`${BANNER_DIR}/${user}.txt`);
}

/** Installs the per-user drop-in + Marker and reloads sshd. */
export async function installDynamicBanner(
  entries: { user: string; text: string }[]
): Promise<{ ok: boolean; error?: string }> {
  const valid = entries.filter((e) => /^[a-z_][a-z0-9_-]*$/i.test(e.user) && e.text.trim().length > 0);
  if (valid.length === 0) return { ok: false, error: "at least one user with non-empty banner text required" };

  try {
    mkdirSync(BANNER_DIR, { recursive: true });
    for (const entry of valid) {
      writeFileSync(`${BANNER_DIR}/${entry.user}.txt`, entry.text.endsWith("\n") ? entry.text : entry.text + "\n", { mode: 0o644 });
    }
    const lines = ["# VPSManagerPRO dynamic per-user banner - managed by the panel. Do not edit."];
    for (const entry of valid) {
      lines.push(`Match User ${entry.user}`, `    Banner ${BANNER_DIR}/${entry.user}.txt`);
    }
    lines.push("");
    mkdirSync("/etc/ssh/sshd_config.d", { recursive: true });
    writeFileSync(SSHD_VMP_CONFIG, lines.join("\n"), { mode: 0o644 });
    writeFileSync(DYNAMIC_BANNER_MARKER, "1\n", { mode: 0o644 });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  // Ensure the drop-in directory is included
  const sshdCfg = readFileOr("/etc/ssh/sshd_config");
  if (!/^\s*Include\s+\/etc\/ssh\/sshd_config\.d\b/im.test(sshdCfg)) {
    try {
      writeFileSync("/etc/ssh/sshd_config", sshdCfg.trimEnd() + "\n\nInclude /etc/ssh/sshd_config.d/*.conf\n", { mode: 0o644 });
    } catch (e) {
      return { ok: false, error: `cannot append Include line: ${(e as Error).message}` };
    }
  }

  const rc = await run("/bin/systemctl", ["reload", "sshd"], { timeout: 15_000 });
  return rc.code === 0 ? { ok: true } : { ok: false, error: (rc.stderr || rc.stdout).trim() };
}

/** Removes drop-in + marker and reloads sshd. */
export async function disableDynamicBanner(): Promise<{ ok: boolean; error?: string }> {
  try {
    if (existsSync(SSHD_VMP_CONFIG)) unlinkSync(SSHD_VMP_CONFIG);
    if (existsSync(DYNAMIC_BANNER_MARKER)) unlinkSync(DYNAMIC_BANNER_MARKER);
  } catch { /* ignore */ }
  const rc = await run("/bin/systemctl", ["reload", "sshd"], { timeout: 15_000 });
  return rc.code === 0 ? { ok: true } : { ok: false, error: (rc.stderr || rc.stdout).trim() };
}

/** Replaces the static /etc/bannerssh file and reloads sshd. */
export async function updateStaticBanner(content: string): Promise<{ ok: boolean; error?: string }> {
  try {
    mkdirSync(dirname(STATIC_BANNER_FILE), { recursive: true });
    writeFileSync(STATIC_BANNER_FILE, content.endsWith("\n") ? content : content + "\n", { mode: 0o644 });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const rc = await run("/bin/systemctl", ["reload", "sshd"], { timeout: 15_000 });
  return rc.code === 0 ? { ok: true } : { ok: false, error: (rc.stderr || rc.stdout).trim() };
}