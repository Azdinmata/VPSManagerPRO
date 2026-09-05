"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../../../lib/api";

interface Service {
  name: string;
  active: boolean;
  enabled: boolean;
  running: boolean;
  description?: string;
}

const ACTIONS = [
  { key: "start", label: "Start", cls: "primary" },
  { key: "restart", label: "Restart", cls: "" },
  { key: "stop", label: "Stop", cls: "danger" },
  { key: "enable", label: "Enable", cls: "" },
  { key: "disable", label: "Disable", cls: "" },
] as const;

export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api("/api/services");
      setServices(data.services);
      setError("");
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 20_000);
    return () => clearInterval(iv);
  }, [refresh]);

  async function act(svc: Service, action: string) {
    setBusy(`${svc.name}:${action}`);
    try {
      await api("/api/services", { method: "POST", csrf: true, body: { name: svc.name, action } });
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
          <h1>Services</h1>
          <p className="sub">systemd service control</p>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>State</th>
              <th>Boot</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="empty">
                  <span className="spinner" /> Loading…
                </td>
              </tr>
            )}
            {services.map((s) => (
              <tr key={s.name}>
                <td>
                  <strong className="mono">{s.name}</strong>
                  {s.description && <div className="muted">{s.description}</div>}
                </td>
                <td>
                  {s.running ? (
                    <span className="badge green">Running</span>
                  ) : s.active ? (
                    <span className="badge yellow">Active</span>
                  ) : (
                    <span className="badge gray">Stopped</span>
                  )}
                </td>
                <td>
                  <span className={`badge ${s.enabled ? "green" : "gray"}`}>
                    {s.enabled ? "enabled" : "disabled"}
                  </span>
                </td>
                <td>
                  <div className="flex">
                    {ACTIONS.map((a) => (
                      <button
                        key={a.key}
                        className={`btn sm ${a.cls}`}
                        disabled={busy !== null || !s.active && a.key === "restart"}
                        onClick={() => act(s, a.key)}
                      >
                        {busy === `${s.name}:${a.key}` ? "…" : a.label}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}