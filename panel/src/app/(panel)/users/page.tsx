"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../../../lib/api";

interface V2RayAccount {
  id: string;
  protocol: "trojan" | "vless" | "vmess";
  name: string;
  secret: string;
  port: number;
  network: "tcp" | "ws";
  path?: string;
  link: string;
}

interface User {
  username: string;
  password: string;
  expiry: string;
  maxlogins: number;
  bandwidthGb: number;
  type: string;
  locked: boolean;
  valid: boolean;
  usageBytes: number;
  activeSessions: number;
  v2ray: V2RayAccount[];
}

const EMPTY_FORM = {
  username: "",
  password: "",
  expiry: "",
  maxlogins: "1",
  bandwidthGb: "0",
  type: "user",
  v2ray: false,
};

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<User | null>(null);
  const [selectedV2Ray, setSelectedV2Ray] = useState<V2RayAccount[] | null>(null);
  const [createdV2Ray, setCreatedV2Ray] = useState<V2RayAccount[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api("/api/users?with_bandwidth=1");
      setUsers(data.users);
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

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setCreatedV2Ray(null);
    try {
      const data = await api("/api/users", {
        method: "POST",
        csrf: true,
        body: {
          username: form.username,
          password: form.password,
          expiry: form.expiry || "never",
          maxlogins: parseInt(form.maxlogins, 10),
          bandwidthGb: parseFloat(form.bandwidthGb) || 0,
          type: form.type,
          v2ray: form.v2ray ? "bundle" : undefined,
        },
      });
      if (data.v2ray && Array.isArray(data.v2ray)) {
        setCreatedV2Ray(data.v2ray as V2RayAccount[]);
      }
      setShowForm(false);
      setForm(EMPTY_FORM);
      await refresh();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleLock(user: User) {
    try {
      await api("/api/users", {
        method: "PATCH",
        csrf: true,
        body: { username: user.username, lock: !user.locked },
      });
      await refresh();
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  async function delUser() {
    if (!confirmDel) return;
    setBusy(true);
    try {
      await api(`/api/users?username=${encodeURIComponent(confirmDel.username)}`, {
        method: "DELETE",
        csrf: true,
      });
      setConfirmDel(null);
      await refresh();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Accounts</h1>
          <p className="sub">SSH accounts managed by the panel</p>
        </div>
        <button className="btn primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New Account"}
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}

      {showForm && (
        <div className="card" style={{ marginBottom: 16 }}>
          <form onSubmit={createUser}>
            <div className="form-row">
              <div className="field">
                <label>Username</label>
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  pattern="[A-Za-z0-9_.-]{3,32}"
                  required
                />
              </div>
              <div className="field">
                <label>Password</label>
                <input
                  type="text"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  minLength={6}
                  required
                />
              </div>
              <div className="field">
                <label>Expiry</label>
                <input
                  type="date"
                  value={form.expiry}
                  onChange={(e) => setForm({ ...form, expiry: e.target.value })}
                />
                <div className="hint">Leave empty for never</div>
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label>Max concurrent logins</label>
                <input
                  type="number"
                  min={1}
                  value={form.maxlogins}
                  onChange={(e) => setForm({ ...form, maxlogins: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Bandwidth (GB / month)</label>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={form.bandwidthGb}
                  onChange={(e) => setForm({ ...form, bandwidthGb: e.target.value })}
                />
                <div className="hint">0 = unlimited</div>
              </div>
              <div className="field">
                <label>Type</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="user">user</option>
                  <option value="trial">trial</option>
                </select>
              </div>
              <div className="field">
                <label>V2Ray proxy</label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={form.v2ray}
                    onChange={(e) => setForm({ ...form, v2ray: e.target.checked })}
                  />
                  <span>Create V2Ray bundle (Trojan + VLESS + VMess for this account)</span>
                </label>
              </div>
            </div>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? "Creating..." : "Create account"}
            </button>
          </form>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Status</th>
              <th>Expiry</th>
              <th>Logins</th>
              <th>Bandwidth</th>
              <th>Used</th>
              <th>Type</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="empty">
                  <span className="spinner" /> Loading…
                </td>
              </tr>
            )}
            {!loading && users.length === 0 && (
              <tr>
                <td colSpan={8} className="empty">
                  No accounts yet.
                </td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.username}>
                <td>
                  <strong>{u.username}</strong>
                  <div className="muted">{u.activeSessions} active</div>
                </td>
                <td>
                  {u.locked ? (
                    <span className="badge red">Locked</span>
                  ) : !u.valid ? (
                    <span className="badge yellow">Expired</span>
                  ) : (
                    <span className="badge green">Active</span>
                  )}
                </td>
                <td className="mono">{u.expiry}</td>
                <td>{u.maxlogins}</td>
                <td>{u.bandwidthGb > 0 ? `${u.bandwidthGb} GB` : "Unlimited"}</td>
                <td className="mono">{formatBytes(u.usageBytes)}</td>
                <td>
                  <span className={`badge ${u.type === "trial" ? "blue" : "gray"}`}>{u.type}</span>
                </td>
                <td>
                  <div className="flex">
                    {u.v2ray && u.v2ray.length > 0 && (
                      <button
                        className="icon-btn"
                        title="V2Ray links"
                        onClick={() => setSelectedV2Ray(u.v2ray)}
                      >
                        📡
                      </button>
                    )}
                    <button
                      className="icon-btn"
                      title={u.locked ? "Unlock" : "Lock"}
                      onClick={() => toggleLock(u)}
                    >
                      {u.locked ? "🔓" : "🔒"}
                    </button>
                    <button className="icon-btn danger" title="Delete" onClick={() => setConfirmDel(u)}>
                      🗑
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(createdV2Ray || selectedV2Ray) && (
        <div className="modal-backdrop" onClick={() => (setCreatedV2Ray(null), setSelectedV2Ray(null))}>
          <div className="card modal wide" onClick={(e) => e.stopPropagation()}>
            <h3>V2Ray Proxy / {(createdV2Ray?.[0]?.name ?? selectedV2Ray?.[0]?.name) || "bundle"}</h3>
            <p className="muted">
              One account, three configs — Trojan+TLS (TCP/443), VLESS (WebSocket) and VMess
              (WebSocket). All use the same username identity.
            </p>
            {(createdV2Ray ?? selectedV2Ray ?? []).map((acct) => (
              <div key={acct.protocol} className="v2ray-block">
                <div className="flex-between">
                  <strong className="badge blue">{acct.protocol.toUpperCase()}</strong>
                  <span className="mono muted">
                    {acct.network.toUpperCase()} :{acct.port}
                    {acct.path ? ` · path ${acct.path}` : ""}
                  </span>
                </div>
                <div className="flex" style={{ gap: 8, marginTop: 8 }}>
                  <img
                    src={`/api/v2ray/qr?link=${encodeURIComponent(acct.link)}`}
                    alt={`${acct.protocol} QR`}
                    width={120}
                    height={120}
                    className="qr"
                  />
                  <textarea readOnly value={acct.link} rows={3} className="link-src" />
                </div>
              </div>
            ))}
            <div className="flex-between" style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => (setCreatedV2Ray(null), setSelectedV2Ray(null))}>
                Close
              </button>
              <span className="muted small">Copy each link into your V2Ray client</span>
            </div>
          </div>
        </div>
      )}

      {confirmDel && (
        <div className="modal-backdrop">
          <div className="card modal">
            <h3>Delete {confirmDel.username}?</h3>
            <p className="muted">
              This removes the system user, kills sessions, and deletes the users.db entry. This cannot be undone.
            </p>
            <div className="flex-between">
              <button className="btn" onClick={() => setConfirmDel(null)}>
                Cancel
              </button>
              <button className="btn danger" onClick={delUser} disabled={busy}>
                {busy ? "Deleting…" : "Delete account"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.55);
          display: grid;
          place-items: center;
          z-index: 50;
        }
        .modal {
          max-width: 420px;
          width: 100%;
        }
        .modal.wide {
          max-width: 640px;
        }
        .v2ray-block {
          border: 1px solid rgba(127, 127, 127, 0.2);
          border-radius: 8px;
          padding: 12px;
          margin-bottom: 10px;
        }
        .qr {
          border-radius: 6px;
          background: #fff;
          padding: 4px;
        }
        .link-src {
          flex: 1;
          font-family: var(--mono-font, monospace);
          font-size: 12px;
          background: rgba(127, 127, 127, 0.08);
          border: 1px solid rgba(127, 127, 127, 0.2);
          border-radius: 6px;
          padding: 8px;
          resize: vertical;
        }
        .small {
          font-size: 12px;
        }
        .modal h3 {
          margin-top: 0;
        }
      `}</style>
    </div>
  );
}