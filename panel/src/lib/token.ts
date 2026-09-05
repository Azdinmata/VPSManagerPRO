import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { PANEL_SECRET_FILE } from "./paths";

// Pure JWT (HS256) + TOTP (RFC 6238) primitives. No next/headers dependency so
// this module is safe to import from Next.js middleware (Node runtime).

// ------------------------------------------------------------------ secret

let cachedSecret: string | null = null;

function getSecret(): string {
  if (cachedSecret) return cachedSecret;
  if (existsSync(PANEL_SECRET_FILE)) {
    cachedSecret = readFileSync(PANEL_SECRET_FILE, "utf8").trim();
    return cachedSecret;
  }
  // Prefer an explicit env override (stable across module instances).
  if (process.env.VMP_PANEL_DEV_SECRET) {
    cachedSecret = process.env.VMP_PANEL_DEV_SECRET;
    return cachedSecret;
  }
  // In dev without an installed secret, derive a stable per-deployment secret
  // from a constant so every route/module instance agrees (dev-only; sessions
  // are not meant to be durable here). Production ALWAYS writes the file.
  cachedSecret = createHmac("sha256", "vpsmanagerpro-panel-dev").digest("hex");
  return cachedSecret;
}

export interface SessionPayload {
  sub: string;
  role: "admin";
  iat: number;
  exp: number;
  mfa: boolean;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function signJwt(payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const sig = createHmac("sha256", getSecret()).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token: string): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = createHmac("sha256", getSecret()).update(`${header}.${body}`).digest("base64url");
  const sigBuf = Buffer.from(sig, "base64url");
  const expBuf = Buffer.from(expected, "base64url");
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function makeSessionToken(mfa: boolean, ttl: number): string {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({ sub: "admin", role: "admin", iat: now, exp: now + ttl, mfa });
}

// ------------------------------------------------------------------ TOTP

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf: Buffer): string {
  let bits = "";
  let out = "";
  for (const byte of buf) bits += byte.toString(2).padStart(8, "0");
  for (let i = 0; i < bits.length; i += 5) {
    out += B32_ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  }
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/g, "").replace(/[\s-]/g, "");
  const bytes: number[] = [];
  let bits = "";
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(16));
}

export function hotp(secretBase32: string, counter: number, digits = 6): string {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 10 ** digits).toString().padStart(digits, "0");
}

export function verifyTotp(code: string, secretBase32: string): boolean {
  const clean = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const now = Math.floor(Date.now() / 1000);
  for (let offset = -1; offset <= 1; offset++) {
    const counter = Math.floor((now + offset * 30) / 30);
    if (hotp(secretBase32, counter) === clean) return true;
  }
  return false;
}

export function provisioningUri(secretBase32: string, account: string, issuer: string): string {
  return (
    "otpauth://totp/" +
    encodeURIComponent(`${issuer}:${account}`) +
    "?secret=" +
    secretBase32 +
    "&issuer=" +
    encodeURIComponent(issuer) +
    "&algorithm=SHA1&digits=6&period=30"
  );
}