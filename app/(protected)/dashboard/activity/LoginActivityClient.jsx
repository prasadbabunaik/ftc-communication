'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  History, LogIn, LogOut, Search, X, Users, RefreshCw,
  Monitor, Smartphone, KeyRound, ShieldCheck,
} from 'lucide-react';

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLE_META = {
  ADMIN:  { color: 'bg-violet-50 text-violet-700 border-violet-200' },
  NLDC:   { color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  SRLDC:  { color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  NRLDC:  { color: 'bg-blue-50 text-blue-700 border-blue-200' },
  ERLDC:  { color: 'bg-orange-50 text-orange-700 border-orange-200' },
  WRLDC:  { color: 'bg-amber-50 text-amber-700 border-amber-200' },
  NERLDC: { color: 'bg-pink-50 text-pink-700 border-pink-200' },
};

const METHOD_LABEL = { PASSWORD: 'Password', ENTRA: 'Microsoft', SSO: 'Microsoft SSO' };

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name) {
  return name?.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() || 'U';
}

// Absolute timestamp, e.g. "17 Jul 2026, 02:14 PM".
function fmtAbs(iso) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

// Relative "time ago", e.g. "3 min ago", "2 hr ago", "Yesterday".
function fmtAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'Just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'Yesterday';
  if (d < 30) return `${d} days ago`;
  return fmtAbs(iso);
}

// Coarse device/browser guess from the UA string — enough for an at-a-glance
// audit, not a full parser.
function deviceInfo(ua) {
  if (!ua) return { label: '—', mobile: false };
  const mobile = /Mobi|Android|iPhone|iPad/i.test(ua);
  let browser = 'Browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\//.test(ua)) browser = 'Opera';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  let os = '';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iOS/.test(ua)) os = 'iOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  return { label: os ? `${browser} · ${os}` : browser, mobile };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RoleBadge({ role }) {
  const m = ROLE_META[role];
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${m?.color ?? 'bg-slate-50 text-slate-600 border-slate-200'}`}>
      {role}
    </span>
  );
}

function ActionBadge({ action }) {
  const login = action === 'LOGIN';
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
      login ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-300'
    }`}>
      {login ? <LogIn className="size-3" /> : <LogOut className="size-3" />}
      {login ? 'Login' : 'Logout'}
    </span>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function LoginActivityClient({ rows }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all'); // all | LOGIN | LOGOUT

  const stats = useMemo(() => ({
    total:   rows.length,
    logins:  rows.filter((r) => r.action === 'LOGIN').length,
    logouts: rows.filter((r) => r.action === 'LOGOUT').length,
    users:   new Set(rows.map((r) => r.userEmail)).size,
  }), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (actionFilter !== 'all' && r.action !== actionFilter) return false;
      if (!q) return true;
      return (
        r.userName.toLowerCase().includes(q) ||
        r.userEmail.toLowerCase().includes(q) ||
        (r.ipAddress ?? '').toLowerCase().includes(q) ||
        (r.userRole ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, search, actionFilter]);

  return (
    <div className="px-4 lg:px-6 pb-8 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
            <History className="size-5 text-violet-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Login Activity</h1>
            <p className="text-sm text-muted-foreground">Sign-in &amp; sign-out audit trail for all users</p>
          </div>
        </div>
        <button
          onClick={() => router.refresh()}
          className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-background text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
        >
          <RefreshCw className="size-3.5" /> Refresh
        </button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Events',  value: stats.total,   color: 'text-foreground',  bg: 'bg-muted/30' },
          { label: 'Logins',        value: stats.logins,  color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Logouts',       value: stats.logouts, color: 'text-slate-600',   bg: 'bg-slate-50' },
          { label: 'Users Seen',    value: stats.users,   color: 'text-violet-600',  bg: 'bg-violet-50' },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl border bg-card p-4 ${s.bg}`}>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">{s.label}</p>
            <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search user, email, role or IP…"
            className="w-full h-9 rounded-md border border-input bg-background pl-9 pr-8 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div className="inline-flex rounded-md border border-input bg-background p-0.5">
          {[
            { key: 'all',    label: 'All' },
            { key: 'LOGIN',  label: 'Logins' },
            { key: 'LOGOUT', label: 'Logouts' },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setActionFilter(t.key)}
              className={`h-8 px-3 rounded text-xs font-semibold transition-colors ${
                actionFilter === t.key ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground ml-auto">
          Showing {filtered.length} of {rows.length}
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="text-left font-semibold px-4 py-2.5">User</th>
                <th className="text-left font-semibold px-3 py-2.5">Action</th>
                <th className="text-left font-semibold px-3 py-2.5">Method</th>
                <th className="text-left font-semibold px-3 py-2.5">IP Address</th>
                <th className="text-left font-semibold px-3 py-2.5">Device</th>
                <th className="text-right font-semibold px-4 py-2.5">When</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    <History className="size-6 mx-auto mb-2 opacity-40" />
                    {rows.length === 0 ? 'No login activity recorded yet.' : 'No events match your filter.'}
                  </td>
                </tr>
              ) : filtered.map((r) => {
                const dev = deviceInfo(r.userAgent);
                return (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="size-8 rounded-full bg-violet-50 text-violet-700 flex items-center justify-center text-[11px] font-bold shrink-0">
                          {initials(r.userName)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-foreground truncate">{r.userName}</span>
                            <RoleBadge role={r.userRole} />
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">{r.userEmail}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5"><ActionBadge action={r.action} /></td>
                    <td className="px-3 py-2.5">
                      {r.method ? (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          {r.method === 'PASSWORD' ? <KeyRound className="size-3" /> : <ShieldCheck className="size-3" />}
                          {METHOD_LABEL[r.method] ?? r.method}
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{r.ipAddress || '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title={r.userAgent || ''}>
                        {dev.mobile ? <Smartphone className="size-3.5" /> : <Monitor className="size-3.5" />}
                        {dev.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div className="text-foreground">{fmtAgo(r.createdAt)}</div>
                      <div className="text-[11px] text-muted-foreground">{fmtAbs(r.createdAt)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
