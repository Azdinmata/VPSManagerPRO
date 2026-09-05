import { existsSync, readFileSync } from "node:fs";
import { run } from "./exec";
import { BANDWIDTH_DIR, DB_FILE, VMP_USERS_GROUP, PANEL_SCRIPTS_DIR } from "./paths";

// ------------------------------------------------------------------ types

export type AccountType = "user" | "trial";

export interface Account {
  username: string;
  password: string;
  expiry: string; // "YYYY-MM-DD" or "never"
  maxlogins: number; // concurrent limit (`limit` column)
  bandwidthGb: number; // monthly GB allowance (0 = unlimited)
  type: AccountType;
  locked: boolean;
  valid: boolean; // expiry sanity
}

// ------------------------------------------------------------------ read

/**
 * users.db line format (verified against the limiter + menu):
 *   user:pass:expiry:limit:bandwidth_gb:type
 * `#` full-line comments allowed. `expiry` may be a date or "never".
 */
export function readUsersDb(): Account[] {
  if (!existsSync(DB_FILE)) return [];
  const out: Account[] = [];
  const lines = readFileSync(DB_FILE, "utf8").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(":");
    if (parts.length < 5) continue;
    const [username, password, expiry, limit, bandwidth] = parts;
    const type = (parts[5] === "trial" ? "trial" : "user") as AccountType;
    out.push({
      username,
      password: password || "",
      expiry: expiry || "never",
      maxlogins: parseInt(limit, 10) || 1,
      bandwidthGb: parseFloat(bandwidth) || 0,
      type,
      locked: isLocked(username),
      valid: !isExpired(expiry),
    });
  }
  return out;
}

export function findAccount(username: string): Account | null {
  return readUsersDb().find((u) => u.username === username) ?? null;
}

export function hasAccount(username: string): boolean {
  return readUsersDb().some((u) => u.username === username);
}

export function isExpired(expiry: string): boolean {
  if (!expiry || expiry.toLowerCase() === "never") return false;
  const d = new Date(expiry);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
}

function isLocked(username: string): boolean {
  if (username === "root") return false;
  try {
    const shadow = readFileSync("/etc/shadow", "utf8");
    const m = shadow.match(new RegExp(`^${escapeRegex(username)}:([^:\\n]+):`));
    if (!m) return false;
    return m[1].startsWith("!");
  } catch {
    return false;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ------------------------------------------------------------------ bandwidth / sessions

export function readUsageFile(user: string): number {
  try {
    const content = readFileSync(`${BANDWIDTH_DIR}/${user}.usage`, "utf8").trim();
    const n = parseInt(content.replace(/[^0-9]/g, ""), 10);
    return Number.isNaN(n) ? 0 : n;
  } catch {
    return 0;
  }
}

// ------------------------------------------------------------------ mutations (root helper scripts)

export function helperPath(name: string): string {
  return `${PANEL_SCRIPTS_DIR}/${name}`;
}

export interface CreateUserInput {
  username: string;
  password: string;
  expiry: string;
  maxlogins: number;
  bandwidthGb: number;
  type: AccountType;
}

export async function createUser(input: CreateUserInput): Promise<{ ok: boolean; error?: string }> {
  const r = await run(helperPath("user-add.sh"), [
    input.username,
    input.password,
    input.expiry || "never",
    String(input.maxlogins),
    String(input.bandwidthGb),
    input.type,
  ]);
  return r.code === 0 ? { ok: true } : { ok: false, error: (r.stderr || r.stdout).trim() };
}

export async function deleteUser(username: string): Promise<{ ok: boolean; error?: string }> {
  const r = await run(helperPath("user-del.sh"), [username]);
  return r.code === 0 ? { ok: true } : { ok: false, error: (r.stderr || r.stdout).trim() };
}

export async function updateUser(
  username: string,
  patch: Partial<Pick<CreateUserInput, "password" | "expiry" | "maxlogins" | "bandwidthGb" | "type">> & {
    lock?: boolean;
  }
): Promise<{ ok: boolean; error?: string }> {
  const args = [username];
  if (patch.password !== undefined) args.push(`--password=${patch.password}`);
  if (patch.expiry !== undefined) args.push(`--expiry=${patch.expiry}`);
  if (patch.maxlogins !== undefined) args.push(`--maxlogins=${patch.maxlogins}`);
  if (patch.bandwidthGb !== undefined) args.push(`--bandwidth=${patch.bandwidthGb}`);
  if (patch.type !== undefined) args.push(`--type=${patch.type}`);
  if (patch.lock !== undefined) args.push(patch.lock ? "--lock" : "--unlock");
  const r = await run(helperPath("user-update.sh"), args);
  return r.code === 0 ? { ok: true } : { ok: false, error: (r.stderr || r.stdout).trim() };
}

export const VMP_USERS_GROUP_NAME = VMP_USERS_GROUP;