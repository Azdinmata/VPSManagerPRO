"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, api } from "../../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pwd, setPwd] = useState<null | { step: string; setup?: boolean; secret?: string; otpauth?: string }>(null);
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await api("/api/auth", {
        method: "POST",
        body: { username, password, step: "password" },
      });
      if (res.step === "totp") {
        setPwd({ step: "totp", setup: res.setup, secret: res.secret, otpauth: res.otpauth });
      } else if (res.step === "done") {
        router.push("/");
      }
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitTotp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await api("/api/auth", { method: "POST", body: { otp, step: "totp" } });
      if (res.step === "done") router.push("/");
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>VPSManagerPRO</h1>
        <p className="sub">Control Panel</p>

        {pwd && pwd.step === "totp" && !pwd.setup && (
          <form onSubmit={submitTotp}>
            <div className="field">
              <label>Enter 6-digit authentication code</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                autoFocus
                placeholder="000000"
              />
            </div>
            {error && <div className="alert error">{error}</div>}
            <button className="btn primary grow" type="submit" disabled={busy || otp.length !== 6}>
              {busy ? "Verifying..." : "Verify & Sign in"}
            </button>
          </form>
        )}

        {pwd && pwd.step === "totp" && pwd.setup && (
          <div>
            <p>
              Scan with Google Authenticator / Authy, then enter the 6-digit code to activate 2FA. This code is shown
              only once.
            </p>
            {pwd.otpauth && (
              <div style={{ textAlign: "center", margin: "12px 0" }}>
                <img alt="QR" src={`/api/auth/qr?data=${encodeURIComponent(pwd.otpauth)}`} width={180} height={180} />
              </div>
            )}
            <div className="auth-secret">{pwd.secret}</div>
            <form onSubmit={submitTotp}>
              <div className="field">
                <label>Enter 6-digit authentication code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  autoFocus
                  placeholder="000000"
                />
              </div>
              {error && <div className="alert error">{error}</div>}
              <button className="btn primary grow" type="submit" disabled={busy || otp.length !== 6}>
                {busy ? "Activating..." : "Activate 2FA"}
              </button>
            </form>
          </div>
        )}

        {(!pwd || pwd.step === "password") && (
          <form onSubmit={submitPassword}>
            <div className="field">
              <label>Username</label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            {error && <div className="alert error">{error}</div>}
            <button className="btn primary grow" type="submit" disabled={busy || !username || !password}>
              {busy ? "Signing in..." : "Continue"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}