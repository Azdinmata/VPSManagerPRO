import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import {
  CSRF_COOKIE,
  PANEL_ADMIN_FILE,
  PANEL_DIR,
  PANEL_SECRET_FILE,
  PENDING_COOKIE,
  SESSION_COOKIE,
} from "./paths";
import {
  makeSessionToken,
  verifyJwt,
  type SessionPayload,
} from "./token";

// ------------------------------------------------------------------ constants

export const SESSION_TTL_SEC = 12 * 3600;
const PENDING_TTL_SEC = 5 * 60;

// ------------------------------------------------------------------ admin store

export interface Admin {
  username: string;
  passwordHash: string;
  totpSecret: string;
  totpVerified: boolean;
  createdAt: string;
  lastLogin?: string;
}

export function getAdmin(): Admin | null {
  try {
    return JSON.parse(readFileSync(PANEL_ADMIN_FILE, "utf8"));
  } catch {
    return null;
  }
}

export function saveAdmin(admin: Admin): void {
  mkdirSync(PANEL_DIR, { recursive: true });
  writeFileSync(PANEL_ADMIN_FILE, JSON.stringify(admin, null, 2) + "\n", { mode: 0o600 });
}

export function adminExists(): boolean {
  return existsSync(PANEL_ADMIN_FILE);
}

// ------------------------------------------------------------------ password hashing (scrypt)

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// ------------------------------------------------------------------ cookies

export async function setSessionCookies(
  res: NextResponse,
  opts: { pending?: boolean; https?: boolean } = {}
): Promise<NextResponse> {
  const secure = opts.https ?? isHttps();
  const ttl = opts.pending ? PENDING_TTL_SEC : SESSION_TTL_SEC;
  const token = makeSessionToken(!opts.pending, ttl);
  res.cookies.set(opts.pending ? PENDING_COOKIE : SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: ttl,
  });
  if (!opts.pending) {
    res.cookies.set(CSRF_COOKIE, randomBytes(24).toString("hex"), {
      httpOnly: false,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: ttl,
    });
  }
  return res;
}

export function clearSessionCookies(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  res.cookies.set(PENDING_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  res.cookies.set(CSRF_COOKIE, "", { httpOnly: false, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}

function isHttps(): boolean {
  return process.env.NODE_ENV === "production";
}

export function sessionFromRequest(req: Request): SessionPayload | null {
  const cookieHeader = (req.headers.get("cookie") ?? "")
    .split(";")
    .find((c) => c.trim().startsWith(`${SESSION_COOKIE}=`));
  if (!cookieHeader) return null;
  const token = cookieHeader.split("=").slice(1).join("=").trim();
  return verifyJwt(token);
}

export function pendingFromRequest(req: Request): SessionPayload | null {
  const cookieHeader = (req.headers.get("cookie") ?? "")
    .split(";")
    .find((c) => c.trim().startsWith(`${PENDING_COOKIE}=`));
  if (!cookieHeader) return null;
  const token = cookieHeader.split("=").slice(1).join("=").trim();
  return verifyJwt(token);
}

export function csrfFromRequest(req: Request): string {
  const cookieHeader = (req.headers.get("cookie") ?? "")
    .split(";")
    .find((c) => c.trim().startsWith(`${CSRF_COOKIE}=`));
  return cookieHeader ? cookieHeader.split("=").slice(1).join("=").trim() : "";
}

export function getServerSession(): SessionPayload | null {
  const store = cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return token ? verifyJwt(token) : null;
}

export { SESSION_COOKIE, PENDING_COOKIE, CSRF_COOKIE, PANEL_SECRET_FILE };