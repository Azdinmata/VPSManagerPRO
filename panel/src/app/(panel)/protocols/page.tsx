"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../../../lib/api";

interface Job {
  id: string;
  label: string;
  status: "running" | "done" | "failed";
  exitCode?: number;
  startedAt: string;
  finishedAt?: string;
}

const PROTOCOLS = [
  {
    key: "udpcustom",
    title: "udp-custom",
    desc: "SlowDNS UDP tunnel server (broken refit)",
    fields: [] as string[],
  },
  {
    key: "falconproxy",
    title: "falconproxy",
    desc: "SSH proxy on 8080/8880 with nginx port-80 front",
    fields: [] as string[],
  },
  {
    key: "dnstt",
    title: "dnstt",
    desc: "DNS tunnel server with key generation",
    fields: ["domain", "forward", "mtu"] as string[],
  },
  {
    key: "zivpn",
    title: "ZiVPN",
    desc: "UDP game VPN server",
    fields: [] as string[],
  },
  {
    key: "v2ray",
    title: "V2Ray / Xray",
    desc: "Trojan, VLESS & VMess proxy server (xray-core)",
    fields: [] as string[],
  },
];

export default function ProtocolsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const data = await api("/api/protocols");
      setJobs(data.jobs);
      setError("");
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 3000);
    return () => clearInterval(iv);
  }, [refresh]);

  async function install(key: string) {
    setBusy(key);
    setError("");
    try {
      const body: Record<string, unknown> = { protocol: key };
      if (key === "dnstt") {
        for (const f of ["domain", "forward", "mtu"]) {
          if (form[f]) body[f] = f === "mtu" ? parseInt(form[f], 10) : form[f];
        }
      }
      await api("/api/protocols", { method: "POST", csrf: true, body });
      await refresh();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Protocols</h1>
          <p className="sub">Install / update tunnel servers from the bundled binaries</p>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="grid cols-2">
        {PROTOCOLS.map((p) => (
          <div className="card" key={p.key}>
            <div className="flex-between">
              <h3 className="card-title" style={{ margin: 0 }}>{p.title}</h3>
              <button
                className="btn primary sm"
                disabled={busy !== null}
                onClick={() => install(p.key)}
              >
                {busy === p.key ? "Installing…" : "Install / Update"}
              </button>
            </div>
            <p className="muted">{p.desc}</p>
            {p.fields.length > 0 && (
              <div className="form-row" style={{ marginTop: 12 }}>
                {p.fields.map((f) => (
                  <div className="field" key={f}>
                    <label>{f}</label>
                    <input
                      type={f === "mtu" ? "number" : "text"}
                      value={form[f] ?? ""}
                      onChange={(e) => setForm({ ...form, [f]: e.target.value })}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid" style={{ marginTop: 16 }}>
        <div className="card">
          <p className="card-title">Recent Install Jobs</p>
          {jobs.length === 0 && <div className="empty">No install jobs yet.</div>}
          {jobs.map((j) => (
            <div key={j.id} className="flex-between" style={{ marginBottom: 8 }}>
              <div>
                <strong>{j.label}</strong>
                <div className="muted mono">{j.id}</div>
              </div>
              <div className="flex">
                {j.status === "running" && (
                  <span className="badge blue"><span className="spinner" style={{ width: 10, height: 10 }} /> running</span>
                )}
                {j.status === "done" && <span className="badge green">done</span>}
                {j.status === "failed" && <span className="badge red">fail ({j.exitCode})</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}