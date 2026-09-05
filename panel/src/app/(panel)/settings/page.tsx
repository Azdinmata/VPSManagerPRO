"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../../../lib/api";

export default function SettingsPage() {
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    username: "",
  });

  const refresh = useCallback(async () => {
    try {
      const d = await api("/api/settings");
      setInfo(d);
      setForm((f) => ({ ...f, username: d.admin?.username ?? "" }));
      setError("");
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await api("/api/auth/settings", {
        method: "PATCH",
        csrf: true,
        body: {
          currentPassword: form.currentPassword,
          newPassword: form.newPassword || undefined,
          username: form.username,
        },
      });
      setForm((f) => ({ ...f, currentPassword: "", newPassword: "" }));
      setSaved(true);
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
          <h1>Settings</h1>
          <p className="sub">Panel admin credentials and server info</p>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      {saved && <div className="alert success">Settings saved.</div>}

      <div className="grid cols-2">
        <div className="card">
          <p className="card-title">Admin credentials</p>
          <form onSubmit={saveSettings}>
            <div className="field">
              <label>Username</label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                pattern="[a-zA-Z0-9_.-]{3,32}"
              />
            </div>
            <div className="field">
              <label>Current password</label>
              <input
                type="password"
                value={form.currentPassword}
                onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label>New password (leave empty to keep)</label>
              <input
                type="password"
                value={form.newPassword}
                onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
                minLength={8}
              />
            </div>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save credentials"}
            </button>
          </form>
        </div>

        <div className="card">
          <p className="card-title">Panel info</p>
          {!info && <div className="empty"><span className="spinner" /> Loading…</div>}
          {info && (
            <div>
              <div className="muted">Admin: {info.admin?.username}</div>
              <div className="muted">2FA: {info.admin?.totpVerified ? "active" : "not verified"}</div>
              <div className="muted">Created: {info.admin?.createdAt}</div>
              <div className="muted" style={{ marginTop: 12 }}>
                Known services: {info.knownServices?.join(", ")}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}