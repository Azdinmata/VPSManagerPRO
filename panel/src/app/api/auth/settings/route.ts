import { NextRequest } from "next/server";
import {
  getAdmin,
  verifyPassword,
  hashPassword,
  saveAdmin,
} from "@/lib/auth";
import { guardMutation, jsonErr, jsonOk } from "@/lib/req";
import { audit } from "@/lib/audit";

export async function PATCH(req: NextRequest) {
  const guard = guardMutation(req);
  if ("status" in guard) return guard;
  const admin = getAdmin();
  if (!admin) return jsonErr("not initialized", 400);

  const body = await req.json().catch(() => ({}));
  const { currentPassword, newPassword, username } = body as {
    currentPassword?: string;
    newPassword?: string;
    username?: string;
  };

  if (!currentPassword || !verifyPassword(currentPassword, admin.passwordHash)) {
    return jsonErr("Current password is incorrect", 403);
  }

  const updates = { ...admin };
  if (newPassword) {
    if (newPassword.length < 8) return jsonErr("New password must be at least 8 characters", 400);
    updates.passwordHash = hashPassword(newPassword);
  }
  if (username && /^[a-zA-Z0-9_.-]{3,32}$/.test(username)) updates.username = username;

  saveAdmin(updates);
  audit(admin.username, "admin_settings_updated");
  return jsonOk({});
}