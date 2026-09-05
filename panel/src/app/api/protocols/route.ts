import { NextRequest } from "next/server";
import { exists } from "@/lib/exec";
import { PANEL_SCRIPTS_DIR } from "@/lib/paths";
import { startJob, getJob, listJobs, jobLog, jobErrorLog } from "@/lib/jobs";
import { audit } from "@/lib/audit";
import { guardMutation, guardRead, jsonErr, jsonOk } from "@/lib/req";

const INSTALLERS: Record<string, { script: string; label: string }> = {
  udpcustom: { script: "install-udpcustom.sh", label: "Install udp-custom" },
  falconproxy: { script: "install-falconproxy.sh", label: "Install falconproxy" },
  dnstt: { script: "install-dnstt.sh", label: "Install dnstt" },
  zivpn: { script: "install-zivpn.sh", label: "Install ZiVPN" },
  v2ray: { script: "install-v2ray.sh", label: "Install V2Ray/Xray core" },
};

export async function GET(req: NextRequest) {
  const guard = guardRead(req);
  if ("status" in guard) return guard;

  const url = new URL(req.url);
  const id = url.searchParams.get("job");
  if (id) {
    const job = getJob(id);
    if (!job) return jsonErr("job not found", 404);
    return jsonOk({
      job,
      log: job.status === "running" ? undefined : jobLog(id),
      error: job.status === "failed" ? jobErrorLog(id) : undefined,
    });
  }

  return jsonOk({ installers: Object.keys(INSTALLERS), jobs: listJobs() });
}

export async function POST(req: NextRequest) {
  const guard = guardMutation(req);
  if ("status" in guard) return guard;

  const body = await req.json().catch(() => ({}));
  const { protocol, domain, forward, mtu } = body as {
    protocol?: string;
    domain?: string;
    forward?: string;
    mtu?: number;
  };

  const meta = protocol ? INSTALLERS[protocol] : undefined;
  if (!meta) return jsonErr("unknown protocol", 400);

  let args: string[] = [];
  if (protocol === "dnstt") {
    if (!domain) return jsonErr("dnstt domain required (--domain)");
    args = ["--domain", String(domain)];
    if (forward) args.push("--forward", String(forward));
    if (mtu) args.push("--mtu", String(mtu));
  }

  const script = `${PANEL_SCRIPTS_DIR}/${meta.script}`;
  if (!exists(script)) {
    return jsonErr(`helper ${meta.script} not deployed on server`, 500);
  }

  // Run directly when the panel itself is root; fall back to sudo otherwise.
  const cmd = process.getuid?.() === 0 ? [script, ...args] : ["/usr/bin/sudo", "-n", script, ...args];
  const job = startJob(meta.label, cmd);
  audit("admin", "protocol_install", protocol, JSON.stringify({ domain, forward, mtu }));
  return jsonOk({ job }, 202);
}