import { NextRequest } from "next/server";
import {
  createUser,
  deleteUser,
  findAccount,
  hasAccount,
  readUsersDb,
  updateUser,
} from "@/lib/users";
import { bandwidthRecords, listSessions } from "@/lib/system";
import {
  addXrayBundle,
  removeXrayAccountsForUser,
  xrayLinkForAccount,
  xrayLinksForUser,
} from "@/lib/xray";
import { audit } from "@/lib/audit";
import { guardMutation, guardRead, jsonErr, jsonOk } from "@/lib/req";
import type { Account } from "@/lib/users";

export async function GET(req: NextRequest) {
  const guard = guardRead(req);
  if ("status" in guard) return guard;

  const url = new URL(req.url);
  const includeBw = url.searchParams.get("with_bandwidth") === "1";

  const accounts: Account[] = readUsersDb();
  const sessions = listSessions();
  const bw = includeBw ? bandwidthRecords() : {};

  const users = await Promise.all(
    accounts.map(async (a) => ({
      ...a,
      usageBytes: bw[a.username] ?? 0,
      activeSessions: sessions.filter((s) => s.user === a.username).length,
      v2ray: await xrayLinksForUser(a.username),
    }))
  );

  return jsonOk({ users, sessions });
}

export async function POST(req: NextRequest) {
  const guard = guardMutation(req);
  if ("status" in guard) return guard;

  const body = await req.json().catch(() => ({}));
  const { username, password, expiry, maxlogins, bandwidthGb, type, v2ray } = body as {
    username?: string;
    password?: string;
    expiry?: string;
    maxlogins?: number;
    bandwidthGb?: number;
    type?: string;
    v2ray?: string;
  };

  const errors = validateCreate({ username, password, expiry, maxlogins, bandwidthGb, type });
  if (errors) return jsonErr(errors);
  if (!username) return jsonErr("username required");
  if (hasAccount(username)) return jsonErr(`User "${username}" already exists`, 409);

  const res = await createUser({
    username,
    password: password ?? "",
    expiry: expiry || "never",
    maxlogins: maxlogins ?? 1,
    bandwidthGb: bandwidthGb ?? 0,
    type: type === "trial" ? "trial" : "user",
  });
  if (!res.ok) return jsonErr(res.error ?? "create failed", 500);
  audit("admin", "user_create", username);

  let v2rayBundle: {
    id: string;
    protocol: string;
    name: string;
    secret: string;
    port: number;
    network: string;
    path?: string;
    link: string;
  }[] = [];
  if (v2ray && v2ray !== "none") {
    const accounts = addXrayBundle(username);
    for (const acct of accounts) {
      v2rayBundle.push({
        id: acct.id,
        protocol: acct.protocol,
        name: acct.name,
        secret: acct.secret,
        port: acct.port,
        network: acct.network,
        path: acct.path,
        link: await xrayLinkForAccount(acct),
      });
    }
    audit("admin", "v2ray_add", username, "bundle");
  }

  return jsonOk({ user: findAccount(username), v2ray: v2rayBundle }, 201);
}

function validateCreate(input: {
  username?: string;
  password?: string;
  expiry?: string;
  maxlogins?: number;
  bandwidthGb?: number;
  type?: string;
}): string | null {
  if (!input.username || !/^[A-Za-z0-9_.-]{3,32}$/.test(input.username)) return "Invalid username (3-32 alphanumeric chars)";
  if (!input.password || input.password.length < 6) return "Password must be at least 6 characters";
  if (["root", "nobody", "bin", "daemon", "systemd-coredump"].includes(input.username)) return "Reserved username";
  if (input.expiry && input.expiry !== "never" && !/^\d{4}-\d{2}-\d{2}$/.test(input.expiry)) return "Expiry must be YYYY-MM-DD or 'never'";
  if (input.maxlogins !== undefined && (!Number.isInteger(input.maxlogins) || input.maxlogins < 1)) return "Max logins must be an integer >= 1";
  if (input.bandwidthGb !== undefined && (typeof input.bandwidthGb !== "number" || input.bandwidthGb < 0)) return "Bandwidth must be a non-negative number";
  return null;
}

export async function PATCH(req: NextRequest) {
  const guard = guardMutation(req);
  if ("status" in guard) return guard;

  const body = await req.json().catch(() => ({}));
  const { username, password, expiry, maxlogins, bandwidthGb, type, lock } = body as {
    username?: string;
    password?: string;
    expiry?: string;
    maxlogins?: number;
    bandwidthGb?: number;
    type?: string;
    lock?: boolean;
  };

  if (!username) return jsonErr("username required");
  if (!hasAccount(username)) return jsonErr("user not found", 404);
  if (password && password.length < 6) return jsonErr("password too short");

  const res = await updateUser(username, {
    password,
    expiry,
    maxlogins,
    bandwidthGb,
    type: type === "trial" || type === "user" ? type : undefined,
    lock,
  });
  if (!res.ok) return jsonErr(res.error ?? "update failed", 500);
  audit("admin", "user_update", username, JSON.stringify({ password: !!password, expiry, maxlogins, bandwidthGb, type, lock }));
  return jsonOk({ user: findAccount(username) });
}

export async function DELETE(req: NextRequest) {
  const guard = guardMutation(req);
  if ("status" in guard) return guard;

  const url = new URL(req.url);
  const username = url.searchParams.get("username");
  if (!username) return jsonErr("username required");
  if (!hasAccount(username)) return jsonErr("user not found", 404);

  const res = await deleteUser(username);
  if (!res.ok) return jsonErr(res.error ?? "delete failed", 500);
  removeXrayAccountsForUser(username);
  audit("admin", "user_delete", username);
  return jsonOk({});
}