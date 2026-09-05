import { NextRequest } from "next/server";
import { readAudit } from "@/lib/audit";
import { guardRead, jsonOk } from "@/lib/req";

export async function GET(req: NextRequest) {
  const guard = guardRead(req);
  if ("status" in guard) return guard;

  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "200", 10);
  return jsonOk({ entries: readAudit(Math.min(500, Math.max(1, isNaN(limit) ? 200 : limit))) });
}