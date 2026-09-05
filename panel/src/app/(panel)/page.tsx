export const dynamic = "force-dynamic";

import {
  readLoad,
  readMem,
  readDisk,
  uptimeSeconds,
} from "@/lib/system";
import { readUsersDb } from "@/lib/users";
import { bandwidthRecords, listSessions } from "@/lib/system";

export default async function DashboardPage() {
  const [load, mem, disk, accounts, bw, sessions] = await Promise.all([
    readLoad(),
    readMem(),
    readDisk(),
    readUsersDb(),
    bandwidthRecords(),
    listSessions(),
  ]);

  const activeUsers = new Set(sessions.map((s) => s.user)).size;
  const totalUsedBytes = Object.values(bw).reduce((a, b) => a + b, 0);
  const locked = accounts.filter((u) => u.locked).length;
  const expired = accounts.filter((u) => !u.valid).length;
  const memUsedKb = mem ? mem.totalKb - mem.availKb : 0;
  const memPct = mem && mem.totalKb > 0 ? Math.round((memUsedKb / mem.totalKb) * 100) : 0;
  const diskPct = disk.total > 0 ? Math.round((disk.used / disk.total) * 100) : 0;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="sub">Server and account overview</p>
        </div>
      </div>

      <div className="grid cols-3">
        <div className="card stat">
          <div className="value">{accounts.length}</div>
          <div className="label">Total Accounts</div>
          <div className="delta">
            {activeUsers} active sessions · {sessions.length} live
          </div>
        </div>
        <div className="card stat">
          <div className="value">{formatBytes(totalUsedBytes)}</div>
          <div className="label">Bandwidth Used</div>
          <div className="delta">across all users</div>
        </div>
        <div className="card stat">
          <div className="value">{load.load1.toFixed(2)}</div>
          <div className="label">Load (1 min) / {load.cores} cores</div>
          <div className="delta">{load.load5.toFixed(2)} avg 5m · {load.load15.toFixed(2)} avg 15m</div>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card">
          <p className="card-title">Memory</p>
          {mem ? (
            <>
              <div className="flex-between">
                <span>{formatBytes(memUsedKb * 1024)} used</span>
                <span>{formatBytes(mem.totalKb * 1024)} total</span>
              </div>
              <div className="progress" style={{ marginTop: 8 }}>
                <div style={{ width: `${memPct}%` }} />
              </div>
              <div className="muted" style={{ marginTop: 6 }}>
                {memPct}% · {formatBytes(mem.availKb * 1024)} available
              </div>
            </>
          ) : (
            <div className="empty">meminfo unavailable</div>
          )}
        </div>
        <div className="card">
          <p className="card-title">Disk</p>
          <div className="flex-between">
            <span>{formatBytes(disk.used)} used</span>
            <span>{formatBytes(disk.total)} total</span>
          </div>
          <div className="progress warn" style={{ marginTop: 8 }}>
            <div style={{ width: `${diskPct}%` }} />
          </div>
          <div className="muted" style={{ marginTop: 6 }}>
            {diskPct}% · {formatBytes(disk.total - disk.used)} free
          </div>
        </div>
      </div>

      <div className="grid cols-3" style={{ marginTop: 16 }}>
        <div className="card stat">
          <div className="value">{locked}</div>
          <div className="label">Locked Accounts</div>
        </div>
        <div className="card stat">
          <div className="value">{expired}</div>
          <div className="label">Expired Accounts</div>
        </div>
        <div className="card stat">
          <div className="value">{formatUptime(uptimeSeconds())}</div>
          <div className="label">Uptime</div>
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

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}