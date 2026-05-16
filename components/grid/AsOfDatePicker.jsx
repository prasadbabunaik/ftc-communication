'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { CalendarDays, X, Loader2 } from 'lucide-react';

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

/**
 * Drop-down date picker driven by available snapshots.
 * Selecting a date sets ?asOf=YYYY-MM-DD on the dashboard URL; the server
 * component re-renders all tables filtered to that point in time.
 */
export function AsOfDatePicker({ availableSnapshots, currentAsOf }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const snaps = availableSnapshots ?? [];
  const latest = snaps.length ? snaps[snaps.length - 1].date : null;
  const currentDate = currentAsOf || latest;
  const isLatest    = !currentAsOf || currentAsOf === latest;

  function navigateTo(date) {
    const params = new URLSearchParams(searchParams);
    if (!date) params.delete('asOf');
    else       params.set('asOf', date);
    startTransition(() => {
      router.push(`/dashboard${params.toString() ? '?' + params.toString() : ''}`);
    });
  }

  if (snaps.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 px-2.5 h-9 rounded-md border border-border bg-white">
        <CalendarDays className="size-3.5 text-slate-500 shrink-0" />
        <span className="text-[11px] font-medium text-slate-600 whitespace-nowrap">As on</span>
        <select
          value={currentDate ?? ''}
          onChange={(e) => navigateTo(e.target.value)}
          className="text-xs font-semibold text-foreground bg-transparent border-0 outline-none focus:ring-0 cursor-pointer py-0 pr-1 pl-0"
          disabled={isPending}
        >
          {snaps.slice().reverse().map((s) => (
            <option key={s.date} value={s.date}>
              {fmtDate(s.date)}
              {s.date === latest ? ' (latest)' : ''}
            </option>
          ))}
        </select>
        {isPending && <Loader2 className="size-3.5 text-blue-600 animate-spin" />}
      </div>

      {!isLatest && (
        <button
          type="button"
          onClick={() => navigateTo(null)}
          title="Back to latest"
          className="inline-flex items-center gap-1 h-9 px-2 rounded-md border border-border bg-white hover:bg-slate-50 text-[11px] font-medium text-slate-600 transition-colors"
          disabled={isPending}
        >
          <X className="size-3" />
          Latest
        </button>
      )}

      {!isLatest && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold border border-amber-200 whitespace-nowrap">
          historical
        </span>
      )}
    </div>
  );
}
