import { NextRequest } from "next/server";
import { listServices, serviceAction } from "@/lib/system";
import { audit } from "@/lib/audit";
import { guardMutation, guardRead, jsonErr, jsonOk } from "@/lib/req";

export async function GET(req: NextRequest) {
  const guard = guardRead(req);
  if ("status" in guard) return guard;
  return jsonOk({ services: await listServices() });
}

export async function POST(req: NextRequest) {
  const guard = guardMutation(req);
  if ("status" in guard) return guard;

  const body = await req.json().catch(() => ({}));
  const { name, action } = body as { name?: string; action?: string };
  if (!name || !action) return jsonErr("name and action required");

  const allowed = new Set(["start", "stop", "restart", "enable", "disable"]);
  if (!allowed.has(action)) return jsonErr("invalid action");

  const res = await serviceAction(name, action);
  if (!res.ok) return jsonErr(res.error ?? "action failed", 500);
  audit("admin", `service_${action}`, name);
  return jsonOk({ name, action });
}