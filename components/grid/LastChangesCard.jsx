'use client';

import { useEffect, useState } from 'react';
import { ArrowUp, ArrowDown, Activity, ChevronRight, Minus } from 'lucide-react';

function fmt(v) {
  if (v == null) return '—';
  const n = Number(v);
  if (Math.abs(n) < 0.01) return '0';
  const sign = n < 0 ? '−' : '';
  const abs  = Math.abs(n);
  const parts = abs.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const dec = parts[1]?.replace(/0+$/, '');
  return sign + (dec ? `${parts[0]}.${dec}` : parts[0]);
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: '2-digit',
  });
}

// Pick the most material deltas across all pipeline cells.
function topDeltas(t2Changes, max = 3) {
  if (!t2Changes) return [];
  const FIELDS = [
    { key: 'codCompletedMw', label: 'COD' },
    { key: 'tocIssuedMw',    label: 'TOC' },
    { key: 'ftcApprovedMw',  label: 'FTC' },
    { key: 'appliedMw',      label: 'Applied' },
    { key: 'totalCapacityMw',label: 'Cap' },
  ];
  const all = [];
  for (const row of t2Changes) {
    for (const f of FIELDS) {
      const d = row[f.key]?.delta;
      if (d != null && Math.abs(d) >= 0.01) {
        all.push({ region: row.region, source: row.source, field: f.label, delta: d });
      }
    }
  }
  return all
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, max);
}

export function LastChangesCard({ availableSnapshots, currentAsOf, onOpenRangeDiff }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // The card always compares against TODAY:
  //   - default:        from = literal yesterday (today - 1 day)
  //   - asOf selected:  from = that historical date
  // We deliberately don't pick the "last change-point" anymore. The user wants
  // a day-over-day view by default — even if yesterday had no changes, the
  // "No changes" banner is the right answer. The compare API works for any
  // date that has a snapshot in DB; the dashboard auto-backfills daily.
  const today     = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const from = currentAsOf ?? yesterday;
  const to   = today;

  useEffect(() => {
    if (!from || !to || from === to) { setLoading(false); setData(null); return; }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/grid/snapshots/compare?from=${from}&to=${to}`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        if (j.error) setError(j.error);
        else { setError(null); setData(j.data); }
      })
      .catch(e => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [from, to]);

  // Compact single-row wrapper for empty/loading/error/no-change states.
  const wrapper = 'rounded-lg border px-3 py-1.5 flex items-center gap-2 text-[12px]';

  if (!from || !to || from === to) {
    return (
      <div className={`${wrapper} border-border bg-slate-50 text-slate-500`}>
        <Activity className="size-3.5 shrink-0" />
        <span>Pick a past date in the picker to see changes vs today.</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`${wrapper} border-border bg-card text-muted-foreground animate-pulse`}>
        <Activity className="size-3.5 shrink-0" />
        <span>Comparing {fmtDate(from)} → {fmtDate(to)}…</span>
      </div>
    );
  }

  // A missing snapshot on either end means we have no recording for that day,
  // which in practice means nothing was captured/changed — render the same
  // "No changes" banner instead of a red error.
  if (error) {
    if (/^No snapshot /.test(error)) {
      return (
        <div className={`${wrapper} border-emerald-200 bg-emerald-50 text-emerald-800`}>
          <Minus className="size-3.5 shrink-0" />
          <span className="font-semibold">No changes</span>
          <span className="text-emerald-700/80">between {fmtDate(from)} and {fmtDate(to)}</span>
        </div>
      );
    }
    return (
      <div className={`${wrapper} border-rose-200 bg-rose-50 text-rose-700`}>
        Couldn't load changes: {error}
      </div>
    );
  }

  const t2 = data?.t2 ?? [];
  const t3 = data?.t3 ?? [];
  const total = t2.length + t3.length + (data?.t1?.length ?? 0);
  const tops  = topDeltas(t2, 3);

  if (total === 0) {
    return (
      <div className={`${wrapper} border-emerald-200 bg-emerald-50 text-emerald-800`}>
        <Minus className="size-3.5 shrink-0" />
        <span className="font-semibold">No changes</span>
        <span className="text-emerald-700/80">between {fmtDate(from)} and {fmtDate(to)}</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-blue-200 bg-gradient-to-r from-blue-50 to-white px-3 py-1.5 flex items-center gap-2 flex-wrap text-[12px]">
      <div className="flex items-center gap-1.5 shrink-0">
        <Activity className="size-3.5 text-blue-700" />
        <span className="font-semibold text-blue-900">
          {total} change{total === 1 ? '' : 's'}
        </span>
        <span className="text-blue-700">{fmtDate(from)} → {fmtDate(to)}</span>
      </div>

      {tops.length > 0 && (
        <div className="flex items-center gap-x-2.5 gap-y-0.5 flex-wrap text-slate-600 pl-2 border-l border-blue-200">
          {tops.map((d, i) => {
            const Icon = d.delta > 0 ? ArrowUp : ArrowDown;
            const cls  = d.delta > 0 ? 'text-emerald-600' : 'text-rose-600';
            return (
              <span key={i} className="inline-flex items-center gap-0.5 whitespace-nowrap">
                <Icon className={`size-3 ${cls}`} />
                <span className={`font-bold tabular-nums ${cls}`}>
                  {d.delta > 0 ? '+' : ''}{fmt(d.delta)}
                </span>
                <span className="text-slate-500">{d.region}·{d.source}·{d.field}</span>
              </span>
            );
          })}
        </div>
      )}

      {onOpenRangeDiff && (
        <button
          type="button"
          onClick={onOpenRangeDiff}
          className="ml-auto inline-flex items-center gap-0.5 h-6 px-2 rounded border border-blue-300 bg-white hover:bg-blue-100 text-blue-700 text-[11px] font-semibold transition-colors shrink-0"
        >
          See all <ChevronRight className="size-3" />
        </button>
      )}
    </div>
  );
}
