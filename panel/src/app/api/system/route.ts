import { NextRequest } from "next/server";
import {
  readDisk,
  readLoad,
  readMem,
  uptimeSeconds,
} from "@/lib/system";
import { publicIPv4, run } from "@/lib/exec";
import { guardRead, jsonOk } from "@/lib/req";

export async function GET(req: NextRequest) {
  const guard = guardRead(req);
  if ("status" in guard) return guard;

  const [load, mem, disk, ipv4, hostname] = await Promise.all([
    readLoad(),
    readMem(),
    readDisk(),
    publicIPv4(),
    run("/bin/hostname", [], { timeout: 5_000 }),
  ]);

  return jsonOk({
    hostname: hostname.stdout.trim(),
    ipv4,
    arch: process.arch,
    load,
    mem,
    disk,
    uptime: uptimeSeconds(),
    processes: await processCount(),
  });
}

async function processCount(): Promise<number> {
  const r = await run("/bin/bash", ["-lc", "ps -e --no-headers | wc -l"], { timeout: 10_000 });
  const n = parseInt(r.stdout.trim(), 10);
  return Number.isNaN(n) ? 0 : n;
}