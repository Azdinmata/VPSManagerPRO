import { mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";
import { PANEL_AUDIT_FILE } from "./paths";

export interface AuditEntry {
  ts: string;
  actor: string;
  action: string;
  target?: string;
  detail?: string;
  ip?: string;
}

export function audit(actor: string, action: string, target?: string, detail?: string, ip?: string): void {
  const entry: AuditEntry = {
    ts: new Date().toISOString(),
    actor,
    action,
    ...(target ? { target } : {}),
    ...(detail ? { detail } : {}),
    ip,
  };
  try {
    mkdirSync(dirname(PANEL_AUDIT_FILE), { recursive: true });
    appendFileSync(PANEL_AUDIT_FILE, JSON.stringify(entry) + "\n");
  } catch {
    /* audit must never break the request */
  }
}

export function readAudit(limit = 200): AuditEntry[] {
  try {
    const raw = readFileSync(PANEL_AUDIT_FILE, "utf8");
    const out: AuditEntry[] = [];
    for (const line of raw.trim().split("\n").reverse()) {
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch { /* ignore */ }
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}