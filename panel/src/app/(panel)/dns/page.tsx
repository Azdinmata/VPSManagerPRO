"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../../../lib/api";

interface DnsData {
  dnsInfo: { domain: string; ip: string; dns1?: string; dns2?: string; subdomain?: string };
  dnstt: Record<string, string>;
  nginxPorts: string[];
  edgeCert: string | null;
  ipv4: string;
}

export default function DnsPage() {
  const [data, setData] = useState<DnsData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ subname: "", ipv4: "", ipv6: "" });

  const refresh = useCallback(async () => {
    try {
      const d = await api("/api/dns");
      setData(d);
      setForm((f) => ({ ...f, ipv4: f.ipv4 || d.ipv4 || "" }));
      setError("");
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function createRecord(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/dns", {
        method: "POST",
        csrf: true,
        body: { subname: form.subname, ipv4: form.ipv4, ipv6: form.ipv6 },
      });
      setForm((f) => ({ ...f, subname: "", ipv6: "" }));
      await refresh();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>DNS &amp; Domain</h1>
          <p className="sub">deSEC records, dnstt info, and nginx ports</p>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="grid cols-3">
        <div className="card">
          <p className="card-title">Domain</p>
          <div className="muted mono">{data?.dnsInfo.domain || "—"}</div>
          <div className="muted">IP: {data?.dnsInfo.ip || data?.ipv4 || "—"}</div>
          {data?.dnsInfo.dns1 && <div className="muted">DNS1: {data.dnsInfo.dns1}</div>}
          {data?.dnsInfo.dns2 && <div className="muted">DNS2: {data.dnsInfo.dns2}</div>}
        </div>

        <div className="card">
          <p className="card-title">dnstt</p>
          {data && Object.keys(data.dnstt).length === 0 ? (
            <div className="empty">dnstt not installed</div>
          ) : (
            data?.dnstt &&
            Object.entries(data.dnstt).map(([k, v]) => (
              <div key={k} className="muted">
                <span className="mono">{k}</span>: {v}
              </div>
            ))
          )}
        </div>

        <div className="card">
          <p className="card-title">Nginx</p>
          <div className="muted mono">{data?.nginxPorts.join(", ") || "—"}</div>
          {data?.edgeCert && <div className="muted">edge cert: configured</div>}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <p className="card-title">Create deSEC record</p>
        <form onSubmit={createRecord}>
          <div className="form-row">
            <div className="field">
              <label>Subdomain label</label>
              <input
                type="text"
                value={form.subname}
                onChange={(e) => setForm({ ...form, subname: e.target.value })}
                placeholder="vps-xxxx"
                pattern="[a-z0-9-]{1,63}"
                required
              />
              {data?.dnsInfo.domain && (
                <div className="hint">
                  → {form.subname || "…"}.{data.dnsInfo.domain}
                </div>
              )}
            </div>
            <div className="field">
              <label>IPv4</label>
              <input
                type="text"
                value={form.ipv4}
                onChange={(e) => setForm({ ...form, ipv4: e.target.value })}
                placeholder="1.2.3.4"
                required
              />
            </div>
            <div className="field">
              <label>IPv6 (optional)</label>
              <input
                type="text"
                value={form.ipv6}
                onChange={(e) => setForm({ ...form, ipv6: e.target.value })}
                placeholder="2001:db8::1"
              />
            </div>
          </div>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create A record"}
          </button>
        </form>
      </div>
    </div>
  );
}