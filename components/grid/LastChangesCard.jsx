'use client';

import { useEffect, useState } from 'react';
import { ArrowUp, ArrowDown, Activity, ChevronRight } from 'lucide-react';

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
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// Pick the most material deltas across all pipeline cells.
// Returns up to 4 (region, source, field, delta) entries sorted by |delta|.
function topDeltas(t2Changes) {
  if (!t2Changes) return [];
  const FIELDS = [
    { key: 'codCompletedMw', label: 'COD declared' },
    { key: 'tocIssuedMw',    label: 'TOC issued'   },
    { key: 'ftcApprovedMw',  label: 'FTC approved' },
    { key: 'appliedMw',      label: 'Applied'      },
    { key: 'totalCapacityMw',label: 'Capacity'     },
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
    .slice(0, 4);
}

export function LastChangesCard({ availableSnapshots, onOpenRangeDiff }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // Use the last two snapshot dates available.
  const snaps = availableSnapshots ?? [];
  const from  = snaps.length >= 2 ? snaps[snaps.length - 2].date : null;
  const to    = snaps.length >= 1 ? snaps[snaps.length - 1].date : null;

  useEffect(() => {
    if (!from || !to) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/grid/snapshots/compare?from=${from}&to=${to}`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        if (j.error) setError(j.error);
        else setData(j.data);
      })
      .catch(e => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [from, to]);

  if (!from || !to) {
    return (
      <div className="rounded-xl border border-border bg-slate-50 px-4 py-3 text-sm text-muted-foreground">
        Not enough snapshots to show recent changes. Capture a snapshot to start tracking day-over-day deltas.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground animate-pulse">
        Loading last changes…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        Couldn't load recent changes: {error}
      </div>
    );
  }

  const t2 = data?.t2 ?? [];
  const t3 = data?.t3 ?? [];
  const total = t2.length + t3.length + (data?.t1?.length ?? 0);
  const tops  = topDeltas(t2);

  return (
    <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-blue-100">
            <Activity className="size-3.5 text-blue-700" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-blue-900 leading-tight">
              {total === 0 ? 'No changes' : `${total} change${total === 1 ? '' : 's'}`}
              <span className="font-normal text-blue-700"> between {fmtDate(from)} and {fmtDate(to)}</span>
            </div>
            <div className="text-[10px] text-blue-700/80 mt-0.5">
              Pipeline cells changed: {t2.length} · Transmission: {t3.length}
            </div>
          </div>
        </div>
        {onOpenRangeDiff && (
          <button
            type="button"
            onClick={onOpenRangeDiff}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-blue-300 bg-white hover:bg-blue-100 text-blue-700 text-[11px] font-semibold transition-colors shrink-0"
          >
            See all <ChevronRight className="size-3" />
          </button>
        )}
      </div>

      {tops.length > 0 && (
        <ul className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
          {tops.map((d, i) => {
            const Icon = d.delta > 0 ? ArrowUp : ArrowDown;
            const cls  = d.delta > 0 ? 'text-emerald-600' : 'text-rose-600';
            return (
              <li key={i} className="flex items-center gap-1.5 text-[11px] text-slate-700">
                <Icon className={`size-3 shrink-0 ${cls}`} />
                <span className="font-semibold tabular-nums shrink-0">
                  <span className={cls}>{d.delta > 0 ? '+' : ''}{fmt(d.delta)} MW</span>
                </span>
                <span className="text-slate-500 truncate">
                  {d.region} · {d.source} · {d.field}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
