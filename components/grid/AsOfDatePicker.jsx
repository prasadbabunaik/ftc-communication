'use client';

import * as Popover from '@radix-ui/react-popover';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS   = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function toIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtShort(iso) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function AsOfDatePicker({ currentAsOf }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const todayStr = toIso(new Date());
  const selected = currentAsOf || todayStr;
  const isHistorical = !!currentAsOf && currentAsOf !== todayStr;

  const [open, setOpen]         = useState(false);
  const [viewDate, setViewDate] = useState(() => new Date(selected + 'T00:00:00'));

  function navigateTo(iso) {
    const params = new URLSearchParams(searchParams);
    if (!iso || iso === todayStr) params.delete('asOf');
    else                          params.set('asOf', iso);
    startTransition(() => {
      router.push(`/dashboard${params.toString() ? '?' + params.toString() : ''}`);
    });
    setOpen(false);
  }

  const year  = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="flex items-center gap-2">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={isPending}
            className={`relative flex items-center gap-3 pl-3.5 pr-3 h-11 rounded-lg border bg-white transition-colors cursor-pointer shadow-sm text-left ${
              isHistorical
                ? 'border-amber-300 bg-amber-50/40 hover:bg-amber-50'
                : 'border-slate-200 hover:bg-slate-50'
            }`}
          >
            <CalendarDays className={`size-[18px] ${isHistorical ? 'text-amber-600' : 'text-slate-500'}`} />
            <div className="flex flex-col leading-tight pr-1">
              <span className="text-[9px] uppercase tracking-wide font-semibold text-slate-500">
                {isHistorical ? 'Viewing as of' : 'Live · Today'}
              </span>
              <span className={`text-[13px] font-bold ${isHistorical ? 'text-amber-800' : 'text-slate-800'}`}>
                {fmtShort(selected)}
              </span>
            </div>
            {isPending && <Loader2 className="size-3.5 text-blue-600 animate-spin" />}
          </button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={8}
            className="z-50 w-[300px] rounded-xl border border-slate-200 bg-white p-3 shadow-xl
                       data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95
                       data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
          >
            {/* Month / year navigation */}
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={() => setViewDate(new Date(year, month - 1, 1))}
                className="flex size-8 items-center justify-center rounded-md hover:bg-slate-100 text-slate-600 transition-colors"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="text-sm font-semibold text-slate-800">
                {MONTHS[month]} {year}
              </span>
              <button
                type="button"
                onClick={() => setViewDate(new Date(year, month + 1, 1))}
                className="flex size-8 items-center justify-center rounded-md hover:bg-slate-100 text-slate-600 transition-colors"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>

            {/* Weekday headers */}
            <div className="grid grid-cols-7 mb-1">
              {DAYS.map((d) => (
                <div key={d} className="text-center text-[10px] font-semibold text-slate-400 py-1">
                  {d}
                </div>
              ))}
            </div>

            {/* Day cells */}
            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((day, idx) => {
                if (!day) return <div key={`e-${idx}`} />;
                const iso       = toIso(new Date(year, month, day));
                const isSel     = iso === selected;
                const isToday   = iso === todayStr;
                const inFuture  = iso > todayStr;
                return (
                  <button
                    key={day}
                    type="button"
                    disabled={inFuture}
                    onClick={() => navigateTo(iso)}
                    className={[
                      'flex size-9 mx-auto items-center justify-center rounded-md text-sm transition-colors',
                      isSel ? 'bg-blue-600 text-white font-semibold shadow-sm' : '',
                      !isSel && isToday ? 'border border-blue-500 text-blue-600 font-semibold' : '',
                      !isSel && !isToday && !inFuture ? 'hover:bg-slate-100 text-slate-700' : '',
                      inFuture ? 'text-slate-300 cursor-not-allowed' : '',
                    ].join(' ')}
                  >
                    {day}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
              <button
                type="button"
                onClick={() => navigateTo(todayStr)}
                className="px-2 py-1 rounded font-medium text-blue-600 hover:bg-blue-50 transition-colors"
              >
                Today
              </button>
              {isHistorical && (
                <span className="text-amber-600 font-medium">Viewing historical</span>
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {isHistorical && (
        <button
          type="button"
          onClick={() => navigateTo(todayStr)}
          title="Back to today"
          className="inline-flex items-center gap-1 h-11 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[12px] font-medium text-slate-700 transition-colors shadow-sm"
          disabled={isPending}
        >
          <X className="size-3.5" /> Today
        </button>
      )}
    </div>
  );
}
