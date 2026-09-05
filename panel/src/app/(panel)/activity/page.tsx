"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../../../lib/api";

interface Entry {
  ts: string;
  actor: string;
  action: string;
  target?: string;
  detail?: string;
  ip?: string;
}

export default function ActivityPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const d = await api("/api/activity");
      setEntries(d.entries);
      setError("");
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Activity Log</h1>
          <p className="sub">Admin actions audit trail (all size-limited)</p>
        </div>
        <button className="btn sm" onClick={refresh}>↻ Refresh</button>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="empty">
                  <span className="spinner" /> Loading…
                </td>
              </tr>
            )}
            {!loading && entries.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">No activity yet.</td>
              </tr>
            )}
            {entries.map((e, i) => (
              <tr key={i}>
                <td className="mono">{new Date(e.ts).toLocaleString()}</td>
                <td>{e.actor}</td>
                <td>
                  <span className="badge blue">{e.action}</span>
                </td>
                <td className="mono">{e.target || "—"}</td>
                <td className="muted">{e.ip || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {entries.some((e) => e.detail) && (
        <div className="card" style={{ marginTop: 16 }}>
          <p className="card-title">Details</p>
          {entries
            .filter((e) => e.detail)
            .slice(0, 20)
            .map((e, i) => (
              <div key={i} className="muted mono" style={{ marginBottom: 6 }}>
                {new Date(e.ts).toLocaleString()} · {e.action} · {e.target} → {e.detail}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}