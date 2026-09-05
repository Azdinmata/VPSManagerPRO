import { NextResponse } from "next/server";
import { csrfFromRequest, sessionFromRequest } from "./auth";
import type { SessionPayload } from "./token";

export function jsonErr(message: string, status = 400, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

export function jsonOk(data: Record<string, unknown> = {}, status = 200): NextResponse {
  return NextResponse.json({ ok: true, ...data }, { status });
}

const IP_LIMITS = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 12;
const WINDOW_MS = 10 * 60_000;

export function tooManyRequests(ip: string): boolean {
  const now = Date.now();
  const entry = IP_LIMITS.get(ip);
  if (!entry || entry.resetAt < now) {
    IP_LIMITS.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export function rateLimit(req: Request): string | null {
  const ip = clientIp(req);
  if (weakBruteGuard(req, ip)) return ip;
  return null;
}

const FAILS = new Map<string, { n: number; until: number }>();

export function weakBruteGuard(req: Request, key: string): boolean {
  const now = Date.now();
  const e = FAILS.get(key);
  if (e && e.until > now && e.n > 8) return true;
  return false;
}

export function recordFail(key: string): number {
  const now = Date.now();
  const e = FAILS.get(key) ?? { n: 0, until: 0 };
  e.n += 1;
  if (e.n >= 8) e.until = now + 15 * 60_000;
  FAILS.set(key, e);
  return e.n;
}

export function clearFails(key: string): void {
  FAILS.delete(key);
}

/** Guards a mutation route: authenticated session + valid CSRF token. */
export function guardMutation(req: Request): { payload: SessionPayload } | NextResponse {
  const payload = sessionFromRequest(req);
  if (!payload || !payload.mfa) {
    return jsonErr("Not authenticated", 401);
  }
  const csrf = req.headers.get("x-vmp-csrf") ?? "";
  if (!csrf || csrf !== csrfFromRequest(req)) {
    return jsonErr("Invalid CSRF token", 403);
  }
  return { payload };
}

/** Guards a read route: authenticated session only. */
export function guardRead(req: Request): { payload: SessionPayload } | NextResponse {
  const payload = sessionFromRequest(req);
  if (!payload || !payload.mfa) {
    return jsonErr("Not authenticated", 401);
  }
  return { payload };
}

export function isGuardOk<T>(guard: T | NextResponse): guard is T {
  return (guard as NextResponse).status === undefined;
}