"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "../lib/api";

const NAV = [
  { href: "/", label: "Dashboard", icon: "▦" },
  { href: "/users", label: "Accounts", icon: "👤" },
  { href: "/bandwidth", label: "Bandwidth", icon: "📊" },
  { href: "/services", label: "Services", icon: "⚙" },
  { href: "/protocols", label: "Protocols", icon: "🌐" },
  { href: "/dns", label: "DNS & Domain", icon: "🌍" },
  { href: "/banner", label: "Banner", icon: "🪧" },
  { href: "/activity", label: "Activity Log", icon: "🕘" },
  { href: "/settings", label: "Settings", icon: "🔧" },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await api("/api/auth", { method: "DELETE" });
    router.push("/login");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="dot" />
          <span className="brand-text">VPSManagerPRO</span>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={pathname === item.href ? "active" : ""}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="foot">
          <div className="flex-between">
            <span>Admin</span>
            <button className="icon-btn" onClick={logout} title="Sign out">
              ⏻
            </button>
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}