'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Database, HardDrive, Clock, Calendar, CheckCircle2, XCircle,
  Loader2, Play, RefreshCw, ShieldCheck, User as UserIcon,
} from 'lucide-react';

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n, i = -1;
  do { v /= 1024; i++; } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(1)} ${units[i]}`;
}
function fmtDur(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}
function relTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return `${d} day${d > 1 ? 's' : ''} ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    SUCCESS: { label: 'Success', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: CheckCircle2 },
    FAILED:  { label: 'Failed',  cls: 'bg-red-50 text-red-700 border-red-200',            Icon: XCircle },
    RUNNING: { label: 'Running', cls: 'bg-blue-50 text-blue-700 border-blue-200',         Icon: Loader2 },
  };
  const m = map[status] ?? map.RUNNING;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${m.cls}`}>
      <m.Icon className={`size-3 ${status === 'RUNNING' ? 'animate-spin' : ''}`} /> {m.label}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, sub, tone = 'text-foreground' }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        <Icon className="size-4" />
        <span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-lg font-bold ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function BackupsPageClient() {
  const [runs, setRuns] = useState([]);
  const [lastSuccess, setLastSuccess] = useState(null);
  const [schedule, setSchedule] = useState('Every day at 4:00 AM IST');
  const [activeRun, setActiveRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [loaded, setLoaded] = useState(false);
  const prevActive = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/backups');
      if (!res.ok) { setLoaded(true); return null; }
      const d = await res.json();
      setRuns(d.runs || []);
      setLastSuccess(d.lastSuccess || null);
      if (d.schedule) setSchedule(d.schedule);
      const active = (d.runs || []).find((r) => r.status === 'RUNNING') || null;
      setActiveRun(active);
      setLoaded(true);
      return active;
    } catch { setLoaded(true); return null; }
  }, []);

  // Initial load.
  useEffect(() => { load(); }, [load]);

  // Self-sustaining poll: each poll replaces activeRun with a fresh object, so
  // this re-runs and schedules the next one — until no run is active.
  useEffect(() => {
    if (!activeRun) return undefined;
    const t = setTimeout(() => load(), 1500);
    return () => clearTimeout(t);
  }, [activeRun, load]);

  // Ticking clock for the live elapsed timer while a backup runs.
  useEffect(() => {
    if (!activeRun) return undefined;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [activeRun]);

  // Toast when a run transitions from active → finished.
  useEffect(() => {
    const had = prevActive.current;
    const has = !!activeRun;
    prevActive.current = has;
    if (had && !has) {
      const latest = runs[0];
      if (latest?.status === 'SUCCESS') toast.success(`Backup completed — ${fmtBytes(latest.sizeBytes)} in ${fmtDur(latest.durationMs)}.`);
      else if (latest?.status === 'FAILED') toast.error('Backup failed. See the history below for details.');
    }
  }, [activeRun, runs]);

  async function startBackup() {
    setBusy(true);
    try {
      const res = await apiFetch('/api/backups/run', { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (res.status === 409) toast.info('A backup is already in progress.');
      else if (!res.ok) toast.error(d.error || 'Could not start the backup.');
      else toast.success('Backup started.');
      await load();
    } catch { toast.error('Could not start the backup.'); }
    finally { setBusy(false); }
  }

  const elapsedMs = activeRun ? Math.max(0, now - new Date(activeRun.startedAt).getTime()) : 0;
  const running = !!activeRun;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <style>{`@keyframes ftcbar{0%{left:-40%}100%{left:100%}}`}</style>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary"><Database className="size-6" /></div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Database Backups</h1>
            <p className="text-sm text-muted-foreground">Automated daily snapshots of the portal database, plus on-demand backups.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={load} disabled={busy} className="gap-1.5">
            <RefreshCw className="size-4" /> Refresh
          </Button>
          <Button onClick={startBackup} disabled={busy || running} className="gap-1.5">
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {running ? 'Backing up…' : busy ? 'Starting…' : 'Backup Now'}
          </Button>
        </div>
      </div>

      {/* In-progress card */}
      {running && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-blue-700 font-semibold text-sm">
              <Loader2 className="size-4 animate-spin" /> Backing up the database…
            </div>
            <div className="text-sm font-mono text-blue-800 tabular-nums">{fmtDur(elapsedMs)}</div>
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-blue-100">
            <div className="absolute top-0 h-full w-2/5 rounded-full bg-blue-500" style={{ animation: 'ftcbar 1.2s ease-in-out infinite' }} />
          </div>
          <p className="text-[11px] text-blue-700/80 mt-2">
            {activeRun.trigger === 'MANUAL' ? 'Manual backup' : 'Scheduled backup'} ·{' '}
            {activeRun.liveSizeBytes ? `${fmtBytes(activeRun.liveSizeBytes)} written` : 'Preparing…'} — this runs on the server; you can leave this page.
          </p>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={CheckCircle2}
          label="Last successful backup"
          tone={lastSuccess ? 'text-emerald-600' : 'text-muted-foreground'}
          value={lastSuccess ? relTime(lastSuccess.finishedAt || lastSuccess.startedAt) : '—'}
          sub={lastSuccess ? fmtDateTime(lastSuccess.finishedAt || lastSuccess.startedAt) : 'No successful backup yet'}
        />
        <StatCard
          icon={HardDrive}
          label="Last backup size"
          value={lastSuccess ? fmtBytes(lastSuccess.sizeBytes) : '—'}
          sub={lastSuccess ? `Took ${fmtDur(lastSuccess.durationMs)}` : ''}
        />
        <StatCard icon={Calendar} label="Schedule" value="4:00 AM" sub={schedule} />
        <StatCard icon={Clock} label="Backups on record" value={String(runs.length)} sub="Most recent 50 shown" />
      </div>

      {/* History table */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/30">
          <Clock className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Backup activity history</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/20 text-muted-foreground">
              <tr className="text-left text-[11px] uppercase tracking-wide">
                <th className="px-4 py-2.5 font-semibold">When</th>
                <th className="px-4 py-2.5 font-semibold">Type</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold text-right">Duration</th>
                <th className="px-4 py-2.5 font-semibold text-right">Size</th>
                <th className="px-4 py-2.5 font-semibold">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {!loaded ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground"><Loader2 className="size-5 animate-spin mx-auto" /></td></tr>
              ) : runs.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No backups yet. Click <span className="font-medium text-foreground">Backup Now</span> or wait for the 4:00 AM run.</td></tr>
              ) : runs.map((r) => (
                <tr key={r.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{fmtDateTime(r.startedAt)}</div>
                    <div className="text-[11px] text-muted-foreground">{relTime(r.startedAt)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${r.trigger === 'MANUAL' ? 'bg-violet-50 text-violet-700 border-violet-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                      {r.trigger === 'MANUAL' ? 'Manual' : 'Scheduled'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                    {r.status === 'FAILED' && r.error && (
                      <div className="text-[11px] text-red-600 mt-1 max-w-xs truncate" title={r.error}>{r.error}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">{fmtDur(r.durationMs)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{fmtBytes(r.sizeBytes)}</td>
                  <td className="px-4 py-3">
                    {r.triggeredBy ? (
                      <span className="inline-flex items-center gap-1 text-muted-foreground text-[12px]"><UserIcon className="size-3" />{r.triggeredBy.name}</span>
                    ) : (
                      <span className="text-muted-foreground text-[12px]">System</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footnote */}
      <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
        <ShieldCheck className="size-3.5 shrink-0 mt-0.5" />
        <p>
          Backups use <span className="font-mono">pg_dump</span> (compressed custom format) and are stored on the server, keeping the most recent 14 files.
          Runs every day at 4:00 AM IST; you can also trigger one anytime with <span className="font-medium text-foreground">Backup Now</span>. Visible to administrators only.
        </p>
      </div>
    </div>
  );
}
