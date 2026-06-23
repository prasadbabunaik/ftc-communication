'use client';

import { useEffect, useState } from 'react';
import { Activity, ChevronRight, Minus, Clock } from 'lucide-react';

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: '2-digit',
  });
}

export function LastChangesCard({ availableSnapshots, currentAsOf, onOpenRangeDiff }) {
  const [rows,    setRows]    = useState(null);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // Audit-time window. This card now reports what was ENTERED / EDITED (the
  // audit trail), not the milestone-state diff. Default: changes entered
  // since the start of yesterday through now. When the user picks a past
  // "as on" date, widen the window back to that date.
  const today     = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const from = currentAsOf ?? yesterday;
  const to   = today;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/grid/audit?from=${from}&to=${to}&limit=50`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        if (j.error) setError(j.error);
        else {
          setError(null);
          setRows(j.data ?? []);
          // True total (uncapped) drives the headline count; fall back to the
          // returned row count for older API responses.
          setTotal(j.total ?? (j.data?.length ?? 0));
        }
      })
      .catch(e => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [from, to]);

  const wrapper = 'rounded-lg border px-3 py-1.5 flex items-center gap-2 text-[12px]';

  if (loading) {
    return (
      <div className={`${wrapper} border-border bg-card text-muted-foreground animate-pulse`}>
        <Activity className="size-3.5 shrink-0" />
        <span>Loading changes {fmtDate(from)} → {fmtDate(to)}…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${wrapper} border-rose-200 bg-rose-50 text-rose-700`}>
        Couldn't load changes: {error}
      </div>
    );
  }

  const all = rows ?? [];

  if (total === 0) {
    return (
      <div className={`${wrapper} border-emerald-200 bg-emerald-50 text-emerald-800`}>
        <Minus className="size-3.5 shrink-0" />
        <span className="font-semibold">No changes recorded</span>
        <span className="text-emerald-700/80">between {fmtDate(from)} and {fmtDate(to)}</span>
      </div>
    );
  }

  // Compact preview — the most recent few entries, each "Entity · field".
  const preview = all.slice(0, 3);
  const fmtTime = (iso) => new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });

  return (
    <div className="rounded-lg border border-blue-200 bg-gradient-to-r from-blue-50 to-white px-3 py-1.5 flex items-center gap-2 flex-wrap text-[12px]">
      <div className="flex items-center gap-1.5 shrink-0">
        <Activity className="size-3.5 text-blue-700" />
        <span className="font-semibold text-blue-900">
          {total} change{total === 1 ? '' : 's'} recorded
        </span>
        <span className="text-blue-700">{fmtDate(from)} → {fmtDate(to)}</span>
      </div>

      <div className="flex items-center gap-x-2.5 gap-y-0.5 flex-wrap text-slate-600 pl-2 border-l border-blue-200">
        {preview.map((r) => (
          <span key={r.id} className="inline-flex items-center gap-1 whitespace-nowrap">
            <Clock className="size-2.5 text-slate-400" />
            <span className="text-slate-500">{fmtTime(r.effectiveDate ?? r.createdAt)}</span>
            <span className="font-semibold text-slate-700">{r.entityName}</span>
            {r.field && <span className="text-slate-500">· {r.field}</span>}
            {r.backDated && <span className="text-[9px] px-1 rounded bg-amber-100 text-amber-700 font-semibold">back-dated</span>}
          </span>
        ))}
        {total > preview.length && (
          <span className="text-slate-400">+{total - preview.length} more</span>
        )}
      </div>

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
