import { NextRequest } from "next/server";
import { exists } from "@/lib/exec";
import { PANEL_SCRIPTS_DIR, XRAY_ACCOUNTS_FILE, XRAY_BIN } from "@/lib/paths";
import {
  addXrayAccount,
  listXrayAccounts,
  removeXrayAccount,
  restartXray,
  saveXrayStore,
  xrayBinaryInstalled,
  xrayLinkForAccount,
  xrayServiceActive,
  readXrayStore,
  type XrayProtocol,
} from "@/lib/xray";
import { startJob, listJobs } from "@/lib/jobs";
import { audit } from "@/lib/audit";
import { guardMutation, guardRead, jsonErr, jsonOk } from "@/lib/req";

export async function GET(req: NextRequest) {
  const guard = guardRead(req);
  if ("status" in guard) return guard;

  const url = new URL(req.url);
  const jobId = url.searchParams.get("job");
  if (jobId) {
    return jsonOk({ installJobs: listJobs() });
  }

  const { accounts, store } = await listXrayAccounts();
  return jsonOk({
    accounts,
    installed: xrayBinaryInstalled(),
    serviceActive: await xrayServiceActive(),
    configExists: exists("/etc/vpsmanagerpro/xray/config.json"),
    store: {
      server: store.server,
      tlsCert: store.tlsCert,
      tlsKey: store.tlsKey,
    },
    installJobs: listJobs(),
  });
}

export async function POST(req: NextRequest) {
  const guard = guardMutation(req);
  if ("status" in guard) return guard;

  const body = await req.json().catch(() => ({}));
  const action = body.action as string | undefined;

  if (action === "install") {
    const script = `${PANEL_SCRIPTS_DIR}/install-v2ray.sh`;
    if (!exists(script)) return jsonErr(`helper ${script} not deployed on server`, 500);
    const cmd = process.getuid?.() === 0 ? [script] : ["/usr/bin/sudo", "-n", script];
    const job = startJob("Install V2Ray/Xray core", cmd);
    audit("admin", "v2ray_install");
    return jsonOk({ job }, 202);
  }

  if (action === "restart") {
    const r = await restartXray();
    audit("admin", "v2ray_restart");
    return r.ok ? jsonOk({}) : jsonErr(r.error ?? "failed to restart xray", 500);
  }

  if (action === "server") {
    const store = readXrayStore();
    store.server = String(body.server ?? "").trim();
    saveXrayStore(store);
    audit("admin", "v2ray_server", body.server);
    return jsonOk({});
  }

  const { protocol, name, port, network, path, flow } = body as {
    protocol?: string;
    name?: string;
    port?: number;
    network?: string;
    path?: string;
    flow?: string;
  };
  if (action === "add") {
    if (!protocol || !["trojan", "vless", "vmess"].includes(protocol)) {
      return jsonErr("protocol must be trojan, vless or vmess");
    }
    if (!name || !/^[A-Za-z0-9_.-]{1,32}$/.test(String(name))) {
      return jsonErr("name must be 1-32 chars [A-Za-z0-9_.-]");
    }
    const account = addXrayAccount({
      protocol: protocol as XrayProtocol,
      name: String(name),
      port: typeof port === "number" ? port : undefined,
      network: network === "tcp" || network === "ws" ? (network as "tcp" | "ws") : undefined,
      path: path ? String(path) : undefined,
      flow: flow ? String(flow) : undefined,
    });
    audit("admin", "v2ray_add", account.name, protocol);
    return jsonOk({ account }, 201);
  }

  return jsonErr("unknown action", 400);
}

export async function DELETE(req: NextRequest) {
  const guard = guardMutation(req);
  if ("status" in guard) return guard;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return jsonErr("id required");

  if (removeXrayAccount(id)) {
    audit("admin", "v2ray_remove", id);
    return jsonOk({});
  }
  return jsonErr("account not found", 404);
}