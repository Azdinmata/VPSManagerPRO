import { NextRequest } from "next/server";
import {
  createDesecRecord,
  deleteDesecRecord,
  readDnsttInfo,
  readDnsInfo,
  readEdgeCert,
  readNginxPorts,
} from "@/lib/dns";
import { audit } from "@/lib/audit";
import { guardMutation, guardRead, jsonErr, jsonOk } from "@/lib/req";
import { publicIPv4 } from "@/lib/exec";

export async function GET(req: NextRequest) {
  const guard = guardRead(req);
  if ("status" in guard) return guard;
  return jsonOk({
    dnsInfo: readDnsInfo(),
    dnstt: readDnsttInfo(),
    nginxPorts: readNginxPorts(),
    edgeCert: readEdgeCert(),
    ipv4: await publicIPv4(),
  });
}

export async function POST(req: NextRequest) {
  const guard = guardMutation(req);
  if ("status" in guard) return guard;

  const body = await req.json().catch(() => ({}));
  const { subname, ipv4, ipv6 } = body as { subname?: string; ipv4?: string; ipv6?: string };

  if (!subname) return jsonErr("subname required");
  if (!ipv4) {
    const detected = await publicIPv4();
    if (detected) body.ipv4 = detected;
  }
  if (!body.ipv4 || !/^[0-9.]+$/.test(body.ipv4)) return jsonErr("valid ipv4 required");

  const res = await createDesecRecord(subname, body.ipv4, ipv6);
  if (!res.ok) return jsonErr(res.error ?? "record create failed", 500);
  audit("admin", "dns_record_create", subname, JSON.stringify(res.records));
  return jsonOk({ result: res.records ?? [] });
}

export async function DELETE(req: NextRequest) {
  const guard = guardMutation(req);
  if ("status" in guard) return guard;
  const url = new URL(req.url);
  const subname = url.searchParams.get("subname");
  if (!subname) return jsonErr("subname required");
  const res = await deleteDesecRecord(subname);
  if (!res.ok) return jsonErr(res.error ?? "record delete failed", 500);
  audit("admin", "dns_record_delete", subname);
  return jsonOk({});
}