'use client';

import { Fragment, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUp, ArrowDown, Minus, RefreshCw, Clock, GitCompare, History, Search, X, Download, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { DatePicker } from '@/components/ui/date-picker';
import { apiFetch } from '@/lib/api-fetch';
import { useAuth } from '@/providers/auth-provider';

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(v) {
  if (v == null) return '—';
  const n = Number(v);
  if (n === 0) return '0';
  const parts = n.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const dec = parts[1]?.replace(/0+$/, '');
  return dec ? `${parts[0]}.${dec}` : parts[0];
}

function DeltaCell({ val }) {
  const n = Number(val ?? 0);
  const abs = Math.abs(n);
  if (abs < 0.01) return <td className="px-2 py-1 text-center text-xs text-slate-400">—</td>;
  const color = n > 0 ? 'text-emerald-600' : 'text-red-600';
  const Icon  = n > 0 ? ArrowUp : ArrowDown;
  return (
    <td className={`px-2 py-1 text-center text-xs font-semibold ${color}`}>
      <span className="inline-flex items-center gap-0.5">
        <Icon className="size-3" />
        {n > 0 ? '+' : ''}{fmt(n)}
      </span>
    </td>
  );
}

function NumCell({ v }) {
  return <td className="px-2 py-1 text-center text-xs text-slate-700">{fmt(v)}</td>;
}

const SOURCE_BADGE = {
  WIND:   'bg-sky-100 text-sky-700',
  SOLAR:  'bg-amber-100 text-amber-700',
  BESS:   'bg-violet-100 text-violet-700',
  HYBRID: 'bg-teal-100 text-teal-700',
  COAL:   'bg-stone-100 text-stone-700',
  HYDRO:  'bg-blue-100 text-blue-700',
  PSP:    'bg-emerald-100 text-emerald-700',
};
const REGION_BADGE = {
  NR: 'bg-indigo-100 text-indigo-700', WR: 'bg-orange-100 text-orange-700',
  SR: 'bg-pink-100 text-pink-700', ER: 'bg-cyan-100 text-cyan-700', NER: 'bg-lime-100 text-lime-700',
};

// ── T2 Diff table ─────────────────────────────────────────────────────────────

const T2_COLS = [
  { key: 'totalCapacityMw', label: 'Total MW' },
  { key: 'ftcApprovedMw',   label: 'FTC Approved' },
  { key: 'ftcPendingMw',    label: 'FTC Pend' },
  { key: 'tocIssuedMw',     label: 'TOC Issued' },
  { key: 'tocPendingMw',    label: 'TOC Pend' },
  { key: 'codCompletedMw',  label: 'COD Declared' },
  { key: 'codPendingMw',    label: 'COD Pend' },
  { key: 'expectedMw',      label: 'Expected' },
];

function T2DiffTable({ changes }) {
  if (!changes?.length) return <p className="text-sm text-muted-foreground py-4">No FTC Pipeline changes between these dates.</p>;
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-xs min-w-[700px]">
        <thead>
          <tr className="bg-slate-100 text-slate-700 text-[10px] border-b border-slate-200">
            <th className="px-3 py-2 text-center whitespace-nowrap">Region</th>
            <th className="px-3 py-2 text-center whitespace-nowrap">Source</th>
            {T2_COLS.map(c => (
              <th key={c.key} colSpan={3} className="px-2 py-2 text-center whitespace-nowrap border-l border-slate-200">{c.label}</th>
            ))}
          </tr>
          <tr className="bg-slate-50 text-slate-600 text-[10px] border-b border-slate-200">
            <th colSpan={2} />
            {T2_COLS.map(c => (
              <Fragment key={c.key}>
                <th className="px-2 py-1 text-center border-l border-slate-200">From</th>
                <th className="px-2 py-1 text-center">To</th>
                <th className="px-2 py-1 text-center">Δ</th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {changes.map((row, i) => (
            <tr key={row.key} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
              <td className="px-3 py-1.5 text-center">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${REGION_BADGE[row.region] ?? 'bg-slate-100'}`}>{row.region}</span>
              </td>
              <td className="px-3 py-1.5 text-center">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${SOURCE_BADGE[row.source] ?? 'bg-slate-100'}`}>{row.source}</span>
              </td>
              {T2_COLS.map(c => (
                <Fragment key={c.key}>
                  <NumCell v={row[c.key]?.from} />
                  <NumCell v={row[c.key]?.to}   />
                  <DeltaCell val={row[c.key]?.delta} />
                </Fragment>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── T1 Diff table ─────────────────────────────────────────────────────────────

function T1DiffTable({ changes }) {
  if (!changes?.length) return <p className="text-sm text-muted-foreground py-4">No CONTD-4 Study changes between these dates.</p>;
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-xs min-w-[500px]">
        <thead>
          <tr className="bg-slate-100 text-slate-700 text-[10px] border-b border-slate-200">
            <th className="px-3 py-2 text-center">Region</th>
            <th className="px-3 py-2 text-center">Source</th>
            <th className="px-2 py-2 text-center border-l border-slate-200" colSpan={3}>Total MW</th>
            <th className="px-2 py-2 text-center border-l border-slate-200" colSpan={3}>Monthly Capacity</th>
          </tr>
          <tr className="bg-slate-50 text-slate-600 text-[10px] border-b border-slate-200">
            <th colSpan={2} />
            <th className="px-2 py-1 text-center border-l border-slate-200">From</th>
            <th className="px-2 py-1 text-center">To</th>
            <th className="px-2 py-1 text-center">Δ</th>
            <th className="px-2 py-1 text-center border-l border-slate-200" colSpan={3}>Month / From / To / Δ</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((row, i) => (
            <tr key={row.key} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
              <td className="px-3 py-1.5 text-center">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${REGION_BADGE[row.region] ?? 'bg-slate-100'}`}>{row.region}</span>
              </td>
              <td className="px-3 py-1.5 text-center">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${SOURCE_BADGE[row.source] ?? 'bg-slate-100'}`}>{row.source}</span>
              </td>
              <NumCell v={row.totalMw?.from} />
              <NumCell v={row.totalMw?.to}   />
              <DeltaCell val={row.totalMw?.delta} />
              <td colSpan={3} className="px-3 py-1.5 border-l border-slate-100">
                {Object.entries(row.months ?? {}).filter(([,d]) => Math.abs(d.delta) >= 0.01).map(([m, d]) => (
                  <div key={m} className="text-[10px] flex items-center gap-1">
                    <span className="text-slate-500">{m}:</span>
                    <span>{fmt(d.from)}</span>
                    <span className="text-slate-400">→</span>
                    <span>{fmt(d.to)}</span>
                    {Math.abs(d.delta) >= 0.01 && (
                      <span className={d.delta > 0 ? 'text-emerald-600 font-bold' : 'text-red-600 font-bold'}>
                        ({d.delta > 0 ? '+' : ''}{fmt(d.delta)})
                      </span>
                    )}
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── T3 Diff table ─────────────────────────────────────────────────────────────

function T3DiffTable({ changes }) {
  if (!changes?.length) return <p className="text-sm text-muted-foreground py-4">No Transmission changes between these dates.</p>;
  const cols = [
    { key: 'completedNo', label: 'Comp. No' },
    { key: 'completedKm', label: 'Comp. Km' },
    { key: 'completedMva', label: 'Comp. MVA' },
    { key: 'pendingNo', label: 'Pend. No' },
    { key: 'pendingKm', label: 'Pend. Km' },
    { key: 'pendingMva', label: 'Pend. MVA' },
  ];
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-xs min-w-[600px]">
        <thead>
          <tr className="bg-slate-100 text-slate-700 text-[10px] border-b border-slate-200">
            <th className="px-3 py-2 text-center">Region</th>
            <th className="px-3 py-2 text-center">Category</th>
            {cols.map(c => (
              <th key={c.key} colSpan={3} className="px-2 py-2 text-center border-l border-slate-200">{c.label}</th>
            ))}
          </tr>
          <tr className="bg-slate-50 text-slate-600 text-[10px] border-b border-slate-200">
            <th colSpan={2} />
            {cols.map(c => (
              <Fragment key={c.key}>
                <th className="px-2 py-1 text-center border-l border-slate-200">From</th>
                <th className="px-2 py-1 text-center">To</th>
                <th className="px-2 py-1 text-center">Δ</th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {changes.map((row, i) => (
            <tr key={row.key} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
              <td className="px-3 py-1.5 text-center">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${REGION_BADGE[row.region] ?? 'bg-slate-100'}`}>{row.region}</span>
              </td>
              <td className="px-3 py-1.5 text-center font-medium text-slate-700">{row.category}</td>
              {cols.map(c => (
                <Fragment key={c.key}>
                  <NumCell v={row[c.key]?.from} />
                  <NumCell v={row[c.key]?.to}   />
                  <DeltaCell val={row[c.key]?.delta} />
                </Fragment>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

// ── Download & Print log (ADMIN only) ─────────────────────────────────────────
function DownloadFormatBadge({ format }) {
  const map = {
    XLSX:  { label: 'Excel', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: FileSpreadsheet },
    PDF:   { label: 'PDF',   cls: 'bg-red-50 text-red-700 border-red-200',             Icon: FileText },
    PRINT: { label: 'Print', cls: 'bg-slate-100 text-slate-600 border-slate-200',      Icon: Printer },
  };
  const m = map[format] ?? map.PRINT;
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${m.cls}`}>
      <m.Icon className="size-3" /> {m.label}
    </span>
  );
}

function DownloadLogView() {
  const [logs, setLogs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const load = () => {
    setLoading(true);
    apiFetch('/api/downloads')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed'))))
      .then((d) => { setLogs(d.logs ?? []); setError(null); })
      .catch(() => setError('Failed to load the download log.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const fmtWhen = (iso) => new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  });

  return (
    <div className="bg-white border border-border rounded-lg">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5"><Download className="size-4" /> Download &amp; Print Log</h3>
          <p className="text-[11px] text-muted-foreground">Every Excel / PDF / print export across the portal. Visible to administrators only.</p>
        </div>
        <button onClick={load} className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 border rounded px-2 py-1 hover:bg-slate-50 transition-colors">
          <RefreshCw className="size-3.5" /> Refresh
        </button>
      </div>
      {loading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
      ) : error ? (
        <div className="p-8 text-center text-sm text-red-600">{error}</div>
      ) : logs.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No downloads recorded yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr className="text-left text-[10px] uppercase tracking-wide">
                <th className="px-4 py-2 font-semibold">When</th>
                <th className="px-4 py-2 font-semibold">User</th>
                <th className="px-4 py-2 font-semibold">Downloaded</th>
                <th className="px-4 py-2 font-semibold">Format</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50/60 align-top">
                  <td className="px-4 py-2 whitespace-nowrap text-slate-700">{fmtWhen(l.createdAt)}</td>
                  <td className="px-4 py-2">
                    <div className="font-medium text-foreground">{l.user?.name ?? 'Unknown'}</div>
                    <div className="text-[10px] text-muted-foreground">{l.roleAtTime ?? l.user?.role ?? ''}</div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="text-foreground">{l.label}</div>
                    {l.meta && <div className="text-[10px] text-muted-foreground">{l.meta}</div>}
                  </td>
                  <td className="px-4 py-2"><DownloadFormatBadge format={l.format} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function SnapshotCompareTab() {
  // The day-wise changes are region-scoped server-side by the caller's role,
  // including an ADMIN "View as" overlay. The switcher updates the session
  // cookie and calls fetchUser(), so the auth user's role changes here — used
  // below to re-fetch (re-scope) in place when the view-as role changes,
  // without resetting the current sub-view or date pickers.
  const { user } = useAuth();
  const viewAsRole = user?.role;
  // The Downloads log is ADMIN-only. An ADMIN "viewing as" another role has that
  // role as their effective role, so the tab hides (matching the RLDC/NLDC view).
  const isAdmin = user?.role === 'ADMIN';
  // Two complementary views:
  //   • movement  — milestone-date diff between two dates (how much FTC/TOC/
  //                 COD moved by milestone date). Event-date based.
  //   • changelog — entry-time audit feed (who changed what, and when it was
  //                 recorded). createdAt / effectiveDate based.
  const [view, setView] = useState('movement');

  // If the effective role drops below ADMIN (e.g. an admin switches "view as"),
  // leave the Downloads view so a non-admin never lands on it.
  useEffect(() => { if (!isAdmin && view === 'downloads') setView('movement'); }, [isAdmin, view]);

  const [snapshots, setSnapshots] = useState([]);
  const [fromDate, setFromDate]   = useState('');
  const [toDate,   setToDate]     = useState('');
  const [diff,     setDiff]       = useState(null);
  const [loading,  setLoading]    = useState(false);
  const [error,    setError]      = useState(null);

  useEffect(() => {
    // Change-point list is informational (the "dates where data changed" chips
    // below the picker). The pickers themselves accept any date — the API
    // resolves each picked date to its effective snapshot (latest on or
    // before the date), so users don't need to know which days actually have
    // a snapshot row.
    apiFetch('/api/grid/snapshots?changesOnly=1')
      .then(r => r.json())
      .then(d => {
        const snaps = d.data ?? [];
        setSnapshots(snaps);
        // Sensible default: most recent change-point as "to", previous one as
        // "from". User can override either with the date pickers.
        if (snaps.length >= 2) {
          setToDate(snaps[snaps.length - 1].snapshotDate.slice(0, 10));
          setFromDate(snaps[snaps.length - 2].snapshotDate.slice(0, 10));
        } else if (snaps.length === 1) {
          setToDate(snaps[0].snapshotDate.slice(0, 10));
        }
      })
      .catch(() => setError('Failed to load snapshots'));
  }, []);

  const loadDiff = async () => {
    if (!fromDate || !toDate) return;
    if (fromDate === toDate) { setError('Select two different dates'); return; }
    setLoading(true); setError(null); setDiff(null);
    try {
      const res = await apiFetch(`/api/grid/snapshots/compare?from=${fromDate}&to=${toDate}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Error');
      // The endpoint now returns 200 with data:null + an error message when
      // there's no snapshot on or before one of the chosen dates. Surface
      // that to the user instead of silently rendering an empty diff.
      if (json.data == null) {
        setError(json.error ?? 'No snapshot available for the selected dates');
        setDiff(null);
      } else {
        setDiff(json.data);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Re-run the on-screen comparison when the ADMIN "View as" role changes, so
  // the region scope updates in place (the compare API filters by the role's
  // region). No-op on first mount (dates aren't chosen yet).
  useEffect(() => {
    if (fromDate && toDate && fromDate !== toDate) loadDiff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewAsRole]);

  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00Z');
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const totalChanges = (diff?.t2?.length ?? 0) + (diff?.t1?.length ?? 0) + (diff?.t3?.length ?? 0);

  return (
    // Scroll within the dashboard's fixed-height tab area so long comparison
    // tables don't overflow and push the page footer up over the content.
    <div className="space-y-5 flex-1 min-h-0 overflow-auto pr-1">
      {/* View toggle */}
      <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-slate-50 p-1">
        <button
          onClick={() => setView('movement')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
            view === 'movement' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <GitCompare className="size-3.5" /> Milestone Movement
        </button>
        <button
          onClick={() => setView('changelog')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
            view === 'changelog' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <History className="size-3.5" /> Change Log
        </button>
        {isAdmin && (
          <button
            onClick={() => setView('downloads')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              view === 'downloads' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Download className="size-3.5" /> Downloads
          </button>
        )}
      </div>

      {view === 'downloads' && isAdmin ? <DownloadLogView /> : view === 'changelog' ? <ChangeLog viewAsRole={viewAsRole} /> : (
      <>
      {/* Controls */}
      <div className="bg-white border border-border rounded-lg p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Compare Two Dates</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px]">
            <label className="block text-xs text-muted-foreground mb-1">From Date</label>
            <DatePicker
              value={fromDate}
              onChange={setFromDate}
              placeholder="Pick a date"
            />
          </div>
          <div className="min-w-[200px]">
            <label className="block text-xs text-muted-foreground mb-1">To Date</label>
            <DatePicker
              value={toDate}
              onChange={setToDate}
              placeholder="Pick a date"
            />
          </div>
          <button
            onClick={loadDiff}
            disabled={loading || !fromDate || !toDate}
            className="inline-flex items-center gap-1.5 px-4 h-10 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Loading…' : 'Compare'}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Pick any two dates — dates without a snapshot resolve to the most recent change before them.
        </p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      {/* Available snapshots */}
      {!diff && snapshots.length > 0 && (
        <div className="bg-slate-50 border border-border rounded-lg p-4">
          <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Change Points ({snapshots.length}) — dates where data actually changed</h4>
          <div className="flex flex-wrap gap-2">
            {snapshots.map(s => (
              <span key={s.id} className="inline-flex items-center px-2 py-1 rounded bg-white border border-border text-xs text-slate-700 font-mono">
                {s.snapshotDate.slice(0, 10)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {diff && (
        <div className="space-y-6">
          {/* Summary banner */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200 flex-wrap">
            <div className="text-sm text-blue-800">
              <span className="font-bold">{fmtDate(diff.from.date)}</span>
              <span className="mx-2 text-blue-400">→</span>
              <span className="font-bold">{fmtDate(diff.to.date)}</span>
              {(diff.from.effectiveDate !== diff.from.date || diff.to.effectiveDate !== diff.to.date) && (
                <span className="ml-2 text-[11px] text-blue-600/80">
                  (resolved to snapshots {fmtDate(diff.from.effectiveDate)} → {fmtDate(diff.to.effectiveDate)})
                </span>
              )}
            </div>
            <div className="ml-auto flex gap-3 text-xs">
              <span className="px-2 py-1 rounded bg-blue-100 text-blue-700 font-semibold">{diff.t2.length} FTC changes</span>
              <span className="px-2 py-1 rounded bg-slate-100 text-slate-700 font-semibold">{diff.t1.length} CONTD-4 changes</span>
              <span className="px-2 py-1 rounded bg-slate-100 text-slate-700 font-semibold">{diff.t3.length} TX changes</span>
            </div>
          </div>

          {totalChanges === 0 && (
            <div className="flex items-center gap-2 p-4 rounded-lg bg-slate-50 border border-border text-muted-foreground text-sm">
              <Minus className="size-4" /> No changes detected between these dates.
            </div>
          )}

          {diff.t2.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-2">FTC Pipeline Changes (T2)</h3>
              <T2DiffTable changes={diff.t2} />
            </section>
          )}

          {diff.t1.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-2">CONTD-4 Study Changes (T1)</h3>
              <T1DiffTable changes={diff.t1} />
            </section>
          )}

          {diff.t3.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-2">Transmission Changes (T3)</h3>
              <T3DiffTable changes={diff.t3} />
            </section>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}

// ── Change Log — entry-time audit feed ────────────────────────────────────────
// Lists every recorded change (project/phase/event edits + transmission
// edits) by the time it was ENTERED. Back-dated changes are tagged and
// positioned by their effective date. This is the "which change was made at
// what time" view, distinct from the milestone-movement diff above.
function ChangeLog({ viewAsRole }) {
  const router    = useRouter();
  // Clicking a change jumps to the entity (project → FTC tracker, opening its
  // detail; transmission → transmission page) with that row highlighted.
  const openEntity = (r) => {
    if (!r.refId) return;
    if (r.kind === 'TRANSMISSION') router.push(`/transmission?highlight=${r.refId}`);
    else router.push(`/ftc?project=${r.refId}`);
  };
  const today     = new Date().toISOString().slice(0, 10);
  const monthAgo  = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to,   setTo]   = useState(today);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  const load = (f = from, t = to) => {
    setLoading(true); setError(null);
    apiFetch(`/api/grid/audit?from=${f}&to=${t}&limit=500`)
      .then(r => r.json())
      .then(j => { if (j.error) setError(j.error); else setRows(j.data ?? []); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };
  // Load on mount and re-load when the ADMIN "View as" role changes, so the
  // region-scoped change log re-fetches in place (keeps the chosen date range).
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [viewAsRole]);

  const fmtTs = (iso) => new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const fmtDate = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const KIND_TONE = { PROJECT: 'bg-blue-100 text-blue-700', TRANSMISSION: 'bg-teal-100 text-teal-700' };

  // Free-text filter over entity, region, user, type, and each underlying
  // field / old→new value / note. Space-separated terms must ALL match.
  const rowMatches = (r, terms) => {
    const hay = [
      r.entityName, r.region, r.userName, r.userRole,
      r.kind === 'TRANSMISSION' ? 'tx transmission' : 'gen generation',
      r.backDated ? 'back-dated backdated' : '',
      ...(r.changes ?? []).flatMap((c) => [c.field, c.oldValue, c.newValue, c.text]),
    ].filter(Boolean).join(' ').toLowerCase();
    return terms.every((t) => hay.includes(t));
  };
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filteredRows = terms.length ? (rows ?? []).filter((r) => rowMatches(r, terms)) : (rows ?? []);
  const totalCount = (rows ?? []).length;

  // Group (filtered) rows by the calendar day they were recorded (effectiveDate ?? createdAt).
  const grouped = {};
  for (const r of filteredRows) {
    const day = new Date(r.effectiveDate ?? r.createdAt).toISOString().slice(0, 10);
    (grouped[day] ??= []).push(r);
  }
  const days = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <div className="space-y-4">
      <div className="bg-white border border-border rounded-lg p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Change Log — recorded edits by entry time</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px]">
            <label className="block text-xs text-muted-foreground mb-1">From</label>
            <DatePicker value={from} onChange={setFrom} placeholder="Pick a date" />
          </div>
          <div className="min-w-[180px]">
            <label className="block text-xs text-muted-foreground mb-1">To</label>
            <DatePicker value={to} onChange={setTo} placeholder="Pick a date" />
          </div>
          <button
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-4 h-10 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} /> {loading ? 'Loading…' : 'Refresh'}
          </button>
          {/* Free-text search — right-aligned in the same row as the date range */}
          <div className="relative ml-auto w-full sm:w-80 md:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search station / element, field, value or user…"
              className="w-full h-10 pl-9 pr-9 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                title="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Each row is recorded when entered. Back-dated edits (ADMIN/NLDC) appear under their effective date with a tag.
          {search && !loading && (
            <span className="ml-1 text-slate-600">
              · {filteredRows.length} of {totalCount} match “{search}”.
            </span>
          )}
        </p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      {!loading && days.length === 0 && (
        <div className="flex items-center gap-2 p-6 rounded-lg bg-slate-50 border border-border text-muted-foreground text-sm">
          <Minus className="size-4" />
          {terms.length && totalCount > 0
            ? <>No changes match “{search}”. <button type="button" onClick={() => setSearch('')} className="ml-1 text-blue-600 hover:underline">Clear search</button></>
            : 'No changes recorded in this window. Changes you make in the app will appear here with a timestamp.'}
        </div>
      )}

      {days.map((day) => (
        <div key={day} className="rounded-lg border border-border bg-white overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 border-b border-border flex items-center gap-2">
            <Clock className="size-3.5 text-slate-500" />
            <span className="text-xs font-semibold text-slate-700">{fmtDate(day)}</span>
            <span className="text-[10px] text-muted-foreground">{grouped[day].length} change{grouped[day].length === 1 ? '' : 's'}</span>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-slate-50/60 text-[10px] text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="px-3 py-1.5 text-center">Time</th>
                <th className="px-3 py-1.5 text-center">Type</th>
                <th className="px-3 py-1.5 text-center">Entity</th>
                <th className="px-3 py-1.5 text-center">Field</th>
                <th className="px-3 py-1.5 text-center">Change</th>
                <th className="px-3 py-1.5 text-center">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {grouped[day].map((r) => (
                <tr
                  key={r.id}
                  onClick={() => openEntity(r)}
                  title={r.refId ? `Open ${r.entityName}` : undefined}
                  className={`hover:bg-slate-50/60 ${r.refId ? 'cursor-pointer' : ''}`}
                >
                  <td className="px-3 py-1.5 text-center font-mono text-slate-600 whitespace-nowrap">{fmtTs(r.effectiveDate ?? r.createdAt)}</td>
                  <td className="px-3 py-1.5 text-center">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${KIND_TONE[r.kind] ?? 'bg-slate-100 text-slate-700'}`}>
                      {r.kind === 'TRANSMISSION' ? 'TX' : 'GEN'}
                    </span>
                    {r.backDated && <span className="ml-1 text-[9px] px-1 rounded bg-amber-100 text-amber-700 font-semibold">back-dated</span>}
                  </td>
                  <td className="px-3 py-1.5 text-center font-medium text-slate-800 max-w-[220px] truncate" title={r.entityName}>
                    {r.region && <span className="text-[10px] text-slate-400 mr-1">{r.region}</span>}{r.entityName}
                  </td>
                  {/* FIELD + CHANGE, one line per underlying change so a single
                      save shows exactly which fields moved and old → new. */}
                  <td className="px-3 py-1.5 text-left align-top text-slate-600">
                    {r.changes?.length
                      ? r.changes.map((c, k) => (
                          <div key={k} className="whitespace-nowrap leading-relaxed">{c.field ?? <span className="text-slate-400">—</span>}</div>
                        ))
                      : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-1.5 text-left align-top text-slate-700">
                    {r.changes?.length
                      ? r.changes.map((c, k) => (
                          <div key={k} className="leading-relaxed">
                            {c.oldValue != null || c.newValue != null
                              ? <span><span className="text-rose-600">{c.oldValue ?? '—'}</span> → <span className="text-emerald-700 font-semibold">{c.newValue ?? '—'}</span></span>
                              : <span className="text-slate-600" title={c.text}>{c.text}</span>}
                          </div>
                        ))
                      : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-1.5 text-center text-slate-600 whitespace-nowrap">
                    {r.userName}{r.userRole ? <span className="text-slate-400">, {r.userRole}</span> : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
