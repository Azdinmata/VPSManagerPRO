import { NextRequest, NextResponse } from "next/server";
import {
  adminExists,
  clearSessionCookies,
  getAdmin,
  hashPassword,
  pendingFromRequest,
  saveAdmin,
  setSessionCookies,
  verifyPassword,
} from "@/lib/auth";
import {
  generateTotpSecret,
  provisioningUri,
  verifyTotp,
} from "@/lib/token";
import { audit } from "@/lib/audit";
import { jsonErr, jsonOk, tooManyRequests } from "@/lib/req";
import { PANEL_ISSUER } from "@/lib/paths";

// Default admin credentials from install (changed on first login).
const INSTALL_ADMIN_USER = process.env.VMP_ADMIN_USER ?? "admin";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "";
  if (tooManyRequests(ip)) return jsonErr("Too many attempts. Try later.", 429);

  let body: { username?: string; password?: string; otp?: string; step?: string };
  try {
    body = await req.json();
  } catch {
    return jsonErr("Bad JSON");
  }

  const step = body.step ?? "password";
  const admin = getAdmin();

  if (!adminExists()) {
    // First run: create the admin using the install-provided password.
    const pass = body.password;
    if (!pass || pass.length < 8) {
      return jsonErr("First-run setup: password must be at least 8 characters", 400);
    }
    const totpSecret = generateTotpSecret();
    const newAdmin = {
      username: INSTALL_ADMIN_USER,
      passwordHash: hashPassword(pass),
      totpSecret,
      totpVerified: false,
      createdAt: new Date().toISOString(),
      lastLogin: undefined,
    };
    saveAdmin(newAdmin);
    audit(INSTALL_ADMIN_USER, "first_run_init", undefined, "admin account created");
    return jsonOk({
      step: "totp",
      setup: true,
      secret: totpSecret,
      otpauth: provisioningUri(totpSecret, INSTALL_ADMIN_USER, PANEL_ISSUER),
    });
  }

  if (!admin) return jsonErr("not initialized", 500);

  if (step === "password") {
    if (body.username !== admin.username) return jsonErr("Invalid credentials", 401);
    if (!body.password || !verifyPassword(body.password, admin.passwordHash)) {
      audit(body.username, "login_failed_password");
      return jsonErr("Invalid credentials", 401);
    }
    if (!admin.totpVerified) {
      // Account created on first run but TOTP not yet confirmed.
      return jsonOk({
        step: "totp",
        setup: true,
        secret: admin.totpSecret,
        otpauth: provisioningUri(admin.totpSecret, admin.username, PANEL_ISSUER),
      });
    }
    const res = NextResponse.json({ ok: true, step: "totp", setup: false });
    return setSessionCookies(res, { pending: true });
  }

  if (step === "totp") {
    if (!body.otp) return jsonErr("Missing 6-digit code", 400);
    if (!admin.totpVerified) {
      // First-run enrollment: no password step happened, but the OTP alone
      // proves possession of the printed secret shown to the browser.
      if (!verifyTotp(body.otp, admin.totpSecret)) return jsonErr("Invalid code", 401);
    } else {
      // Normal 2FA: a pending (password-verified) session cookie is required.
      if (!pendingFromRequest(req)) return jsonErr("Authenticate with password first", 403);
      if (!verifyTotp(body.otp, admin.totpSecret)) {
        audit(admin.username, "login_2fa_invalid");
        return jsonErr("Invalid code", 401);
      }
    }

    let res: NextResponse;
    if (!admin.totpVerified) {
      const updated = { ...admin, totpVerified: true, lastLogin: new Date().toISOString() };
      saveAdmin(updated);
      res = NextResponse.json({ ok: true, step: "done", setup: true });
    } else {
      res = NextResponse.json({ ok: true, step: "done", setup: false });
      audit(admin.username, "login_2fa_success");
    }
    return setSessionCookies(res);
  }

  return jsonErr("Unknown step");
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  audit("admin", "logout");
  return clearSessionCookies(res);
}