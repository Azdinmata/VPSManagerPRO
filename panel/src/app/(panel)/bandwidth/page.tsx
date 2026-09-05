"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../../../lib/api";

interface BwRecord {
  username: string;
  usedBytes: number;
  limitBytes: number;
  limitGb: number;
  usedGb: number;
  remainingBytes: number | null;
  usagePercent: number;
}

interface Session {
  user: string;
  pid: number;
  lastActive: string;
}

export default function BandwidthPage() {
  const [records, setRecords] = useState<BwRecord[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const data = await api("/api/bandwidth");
      setRecords(data.records);
      setSessions(data.sessions);
      setError("");
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 15_000);
    return () => clearInterval(iv);
  }, [refresh]);

  const totalUsed = records.reduce((a, r) => a + r.usedBytes, 0);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Bandwidth</h1>
          <p className="sub">
            Usage against monthly allowance · {formatBytes(totalUsed)} total
          </p>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="grid cols-2">
        <div className="card">
          <p className="card-title">Live Sessions</p>
          {sessions.length === 0 ? (
            <div className="empty">No sessions right now.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>PID</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={`${s.user}-${s.pid}`}>
                    <td><strong>{s.user}</strong></td>
                    <td className="mono">{s.pid}</td>
                    <td className="mono">{s.lastActive ? new Date(s.lastActive).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <p className="card-title">By User</p>
          {loading && <div className="empty"><span className="spinner" /> Loading…</div>}
          {!loading && records.length === 0 && <div className="empty">No bandwidth data.</div>}
          {records.map((r) => (
            <div key={r.username} style={{ marginBottom: 14 }}>
              <div className="flex-between" style={{ marginBottom: 4 }}>
                <strong>{r.username}</strong>
                <span className="muted">
                  {formatBytes(r.usedBytes)}
                  {r.limitGb > 0 ? ` / ${r.limitGb} GB` : " / unlimited"}
                </span>
              </div>
              {r.limitGb > 0 ? (
                <div className={`progress ${r.usagePercent >= 90 ? "danger" : r.usagePercent >= 70 ? "warn" : ""}`}>
                  <div style={{ width: `${r.usagePercent}%` }} />
                </div>
              ) : (
                <div className="progress">
                  <div style={{ width: `${Math.min(100, r.usagePercent || 0)}%` }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}