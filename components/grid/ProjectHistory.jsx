'use client';

import { Fragment, useEffect, useState } from 'react';
import { History, ArrowUp, ArrowDown, Loader2, ChevronDown } from 'lucide-react';

function fmt(v) {
  if (v == null) return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  if (n === 0) return '0';
  const parts = n.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const dec = parts[1]?.replace(/0+$/, '');
  return dec ? `${parts[0]}.${dec}` : parts[0];
}

function fmtDate(s) {
  const d = new Date(s + 'T00:00:00Z');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

function Delta({ from, to }) {
  const a = Number(from ?? 0);
  const b = Number(to   ?? 0);
  const d = b - a;
  if (Math.abs(d) < 0.01) return <span className="text-slate-300 text-[10px]">—</span>;
  const Icon = d > 0 ? ArrowUp : ArrowDown;
  const cls  = d > 0 ? 'text-emerald-600' : 'text-rose-600';
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${cls}`}>
      <Icon className="size-3" />
      {d > 0 ? '+' : ''}{fmt(d)}
    </span>
  );
}

const FTC_COLUMNS = [
  { key: 'totalCapacityMw',  label: 'Total',   group: '' },
  { key: 'capacityAppliedMw',label: 'Applied', group: '' },
  { key: 'ftcCompletedMw',   label: 'FTC',     group: 'blue' },
  { key: 'capacityUnderFtcMw', label: 'Under FTC', group: 'blue' },
  { key: 'tocIssuedMw',      label: 'TOC',     group: 'violet' },
  { key: 'capacityUnderTocMw', label: 'Under TOC', group: 'violet' },
  { key: 'codDeclaredMw',    label: 'COD',     group: 'emerald' },
  { key: 'expectedApr26Mw',  label: 'Expected', group: 'amber' },
];

const CONTD4_COLUMNS = [
  { key: 'totalCapacityMw', label: 'Total Cap (MW)' },
  { key: 'capacityApr26Mw', label: 'Capacity in Month (MW)' },
  { key: 'capacityMonth',   label: 'Target Month', isText: true },
];

const TX_COLUMNS = [
  { key: 'capacityMva',       label: 'Cap (MVA)' },
  { key: 'lineLengthKm',      label: 'Length (km)' },
  { key: 'capacityApr26Mva',  label: 'Pending Cap (MVA)' },
  { key: 'lineLengthApr26Km', label: 'Pending Length (km)' },
  { key: 'pendingFtc',        label: 'Pending FTC', isText: true },
];

// Per-row data accessor — for FTC kind the values live inside phases[0]
function val(match, kind, key) {
  if (!match) return null;
  if (kind === 'ftc') {
    if (key === 'totalCapacityMw') return match.totalCapacityMw;
    const ph = (match.phases || [])[0] || {};
    return ph[key];
  }
  if (kind === 'tx' && key === 'pendingFtc') return match.pendingFtc ? 'Yes' : 'No';
  return match[key];
}

export function ProjectHistory({ name, region, kind = 'ftc' }) {
  const [expanded, setExpanded] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [series,   setSeries]   = useState([]);
  const [error,    setError]    = useState(null);

  // Only fetch when first expanded
  useEffect(() => {
    if (!expanded || !name) return;
    if (series.length > 0 || error) return; // already loaded
    let cancelled = false;
    setLoading(true);
    fetch(`/api/grid/snapshots/project-history?name=${encodeURIComponent(name)}&region=${encodeURIComponent(region ?? '')}&kind=${kind}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (d.error) { setError(d.error); setSeries([]); }
        else { setSeries(d.snapshots ?? []); }
      })
      .catch(e => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [expanded, name, region, kind, series.length, error]);

  const cols = kind === 'contd4' ? CONTD4_COLUMNS : kind === 'tx' ? TX_COLUMNS : FTC_COLUMNS;

  const recent = series.slice(-15);
  const view   = [...recent].reverse();

  const changedDates = new Set();
  for (let i = 0; i < view.length - 1; i++) {
    const curr = view[i].match;
    const prev = view[i + 1].match;
    for (const c of cols) {
      const a = val(prev, kind, c.key);
      const b = val(curr, kind, c.key);
      const eq = c.isText ? String(a ?? '') === String(b ?? '') : Math.abs(Number(a ?? 0) - Number(b ?? 0)) < 0.01;
      if (!eq) { changedDates.add(view[i].date); break; }
    }
  }

  const present   = recent.filter(s => s.match);
  const firstSeen = present[0]?.date;
  const lastSeen  = present[present.length - 1]?.date;

  return (
    <div className="rounded-xl border overflow-hidden shadow-sm">
      {/* ── Clickable header ── */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-center gap-2 hover:bg-slate-100 transition-colors text-left"
      >
        <History className="size-4 text-slate-500 shrink-0" />
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700">
          Day-wise History · Last {expanded && recent.length > 0 ? recent.length : '…'} days
        </p>
        {expanded && present.length > 0 && (
          <span className="text-[10px] text-slate-500 ml-1">
            {present.length} of {recent.length} have this {kind === 'tx' ? 'element' : 'project'}
            {firstSeen && <> · first seen {fmtDate(firstSeen)}</>}
            {lastSeen && lastSeen !== firstSeen && <> · last {fmtDate(lastSeen)}</>}
          </span>
        )}
        {expanded && (
          <span className="ml-auto mr-2 inline-flex items-center gap-1 text-[10px] text-slate-500 shrink-0">
            <span className="inline-block size-2 rounded-full bg-amber-400" /> changed vs previous day
          </span>
        )}
        <ChevronDown
          className={`size-4 text-slate-400 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''} ${expanded ? '' : 'ml-auto'}`}
        />
      </button>

      {/* ── Expandable body ── */}
      {expanded && (
        loading ? (
          <div className="p-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading day-wise history…
          </div>
        ) : error ? (
          <div className="p-4 text-sm text-rose-700 bg-rose-50">Couldn't load history: {error}</div>
        ) : view.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No snapshots available.</div>
        ) : (
          <div className="overflow-auto" style={{ maxHeight: '58vh' }}>
            <table className="w-full border-collapse text-[11px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-100 text-slate-700 text-[10px] border-b border-slate-200">
                  <th className="sticky left-0 z-20 bg-slate-100 px-3 py-2 text-left font-bold border-r border-slate-200 whitespace-nowrap">Date</th>
                  {cols.map(c => (
                    <th key={c.key} className="px-3 py-2 text-right font-bold border-r border-slate-200 whitespace-nowrap">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.map((s, i) => {
                  const prev    = view[i + 1];
                  const hasIt   = !!s.match;
                  const changed = changedDates.has(s.date);
                  const bg      = changed ? 'bg-amber-50/50' : 'bg-white';
                  return (
                    <tr key={s.date} className={`border-t border-slate-100 hover:bg-slate-50/60 ${bg}`}>
                      <td className={`px-3 py-1.5 sticky left-0 z-10 border-r border-slate-100 ${bg} whitespace-nowrap`}>
                        <span className="font-mono text-[10px] text-slate-700">{fmtDate(s.date)}</span>
                        {changed && <span className="ml-1.5 inline-block size-1.5 rounded-full bg-amber-400" title="Changed from previous day" />}
                      </td>
                      {hasIt ? cols.map(c => {
                        const cur  = val(s.match, kind, c.key);
                        const prv  = val(prev?.match, kind, c.key);
                        const eqText = c.isText && String(cur ?? '') === String(prv ?? '');
                        const eqNum  = !c.isText && Math.abs(Number(cur ?? 0) - Number(prv ?? 0)) < 0.01;
                        const same   = eqText || eqNum;
                        const cellHi = prev?.match && !same ? 'bg-amber-100/60 font-semibold' : '';
                        return (
                          <td key={c.key} className={`px-3 py-1.5 text-right tabular-nums border-r border-slate-100 ${cellHi}`}>
                            <div className="flex items-center justify-end gap-1.5">
                              {c.isText
                                ? <span className="text-slate-700">{cur ?? '—'}</span>
                                : <span className="text-slate-700">{fmt(cur)}</span>}
                              {!c.isText && prev?.match && !same && <Delta from={prv} to={cur} />}
                            </div>
                          </td>
                        );
                      }) : (
                        <td colSpan={cols.length} className="px-3 py-1.5 text-center text-[10px] text-slate-400 italic">
                          Not present in this snapshot
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
