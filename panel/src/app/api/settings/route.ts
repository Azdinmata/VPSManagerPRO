import { NextRequest } from "next/server";
import { getAdmin } from "@/lib/auth";
import { guardRead, jsonOk } from "@/lib/req";
import { KNOWN_SERVICES } from "@/lib/paths";

export async function GET(req: NextRequest) {
  const guard = guardRead(req);
  if ("status" in guard) return guard;

  const admin = getAdmin();
  return jsonOk({
    admin: admin
      ? { username: admin.username, totpVerified: admin.totpVerified, createdAt: admin.createdAt, lastLogin: admin.lastLogin }
      : null,
    knownServices: KNOWN_SERVICES,
  });
}