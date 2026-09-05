import { NextRequest } from "next/server";
import { bandwidthRecords, listSessions } from "@/lib/system";
import { readUsersDb } from "@/lib/users";
import { guardRead, jsonOk } from "@/lib/req";

export async function GET(req: NextRequest) {
  const guard = guardRead(req);
  if ("status" in guard) return guard;

  const bw = bandwidthRecords();
  const accounts = readUsersDb();
  const sessions = listSessions();

  const limitMap = new Map(accounts.map((u) => [u.username, u.bandwidthGb]));

  const records = accounts.map((u) => {
    const usedBytes = bw[u.username] ?? 0;
    const limitBytes = (u.bandwidthGb || 0) * 1024 ** 3;
    return {
      username: u.username,
      usedBytes,
      limitBytes,
      limitGb: u.bandwidthGb,
      usedGb: usedBytes / 1024 ** 3,
      remainingBytes: limitBytes ? Math.max(0, limitBytes - usedBytes) : null,
      usagePercent: limitBytes ? Math.min(100, (usedBytes / limitBytes) * 100) : 0,
    };
  });

  records.sort((a, b) => b.usedBytes - a.usedBytes);

  return jsonOk({ records, sessions, limitMap: Object.fromEntries(limitMap) });
}