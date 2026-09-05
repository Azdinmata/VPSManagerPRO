"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../../../lib/api";

interface BannerState {
  enabled: boolean;
  staticBanner: string;
  dynamicEnabled: boolean;
  dynamicUsers: string[];
}

export default function BannerPage() {
  const [state, setState] = useState<BannerState | null>(null);
  const [staticText, setStaticText] = useState("");
  const [dynUser, setDynUser] = useState("");
  const [dynText, setDynText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const refresh = useCallback(async () => {
    try {
      const d = await api("/api/banner");
      setState(d.state);
      setStaticText(d.state.staticBanner);
      setError("");
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function saveStatic(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/banner", { method: "POST", csrf: true, body: { mode: "static", content: staticText } });
      await refresh();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveDynamic(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/banner", {
        method: "POST",
        csrf: true,
        body: { mode: "dynamic", entries: [{ user: dynUser, text: dynText }] },
      });
      setDynUser("");
      setDynText("");
      await refresh();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function disableDynamic() {
    setBusy(true);
    setError("");
    try {
      await api("/api/banner?mode=dynamic", { method: "DELETE", csrf: true });
      await refresh();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function openEditor(user: string) {
    setEditingUser(user);
    try {
      const d = await api(`/api/banner?user=${encodeURIComponent(user)}`);
      setEditText(d.banner);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>SSH Banner</h1>
          <p className="sub">Static server banner and per-user dynamic banners</p>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      {!state?.dynamicEnabled && (
        <div className="alert info">Per-user banners are currently disabled. The static banner below still applies.</div>
      )}

      <div className="grid cols-2">
        <div className="card">
          <p className="card-title">Static banner (/etc/bannerssh)</p>
          <form onSubmit={saveStatic}>
            <div className="field">
              <textarea value={staticText} onChange={(e) => setStaticText(e.target.value)} rows={8} />
            </div>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save static banner"}
            </button>
          </form>
        </div>

        <div className="card">
          <p className="card-title">Per-user banners</p>
          {state?.dynamicUsers.map((u) => (
            <div key={u} className="flex-between" style={{ marginBottom: 8 }}>
              <strong className="mono">{u}</strong>
              <button className="btn sm" onClick={() => openEditor(u)}>Edit</button>
            </div>
          ))}
          {state && state.dynamicUsers.length === 0 && <div className="empty">No per-user banners.</div>}

          <form onSubmit={saveDynamic} style={{ marginTop: 12 }}>
            <div className="field">
              <label>User</label>
              <input
                type="text"
                value={dynUser}
                onChange={(e) => setDynUser(e.target.value)}
                placeholder="username"
                required
              />
            </div>
            <div className="field">
              <label>Banner text</label>
              <textarea value={dynText} onChange={(e) => setDynText(e.target.value)} rows={5} required />
            </div>
            <div className="flex-between">
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Add / update user banner"}
              </button>
              {state?.dynamicEnabled && (
                <button className="btn danger" type="button" onClick={disableDynamic}>
                  Disable all per-user
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      {editingUser && (
        <div className="card" style={{ marginTop: 16 }}>
          <p className="card-title">Editing banner for {editingUser}</p>
          <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={6} />
          <div className="flex" style={{ marginTop: 8 }}>
            <button
              className="btn primary"
              onClick={async () => {
                await api("/api/banner", {
                  method: "POST",
                  csrf: true,
                  body: { mode: "dynamic", entries: [{ user: editingUser, text: editText }] },
                });
                setEditingUser(null);
                setDynUser("");
                setDynText("");
                await refresh();
              }}
            >
              Save
            </button>
            <button className="btn" onClick={() => setEditingUser(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}