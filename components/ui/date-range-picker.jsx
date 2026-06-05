'use client';

import * as Popover from '@radix-ui/react-popover';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function parseValue(value) {
  if (!value) return null;
  const d = new Date(value + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}
const fmt = (iso) => {
  const d = parseValue(iso);
  return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : null;
};

// A single date-range control. One popover, one calendar: click a start date,
// then an end date (clicking before the start restarts the selection). The
// range in between is highlighted.
//
// from / to: "YYYY-MM-DD" strings | ""
// onChange: ({ from, to }) => void   (to is "" until the second click)
export function DateRangePicker({ from, to, onChange, placeholder = 'Pick a date range', className }) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => parseValue(from) ?? parseValue(to) ?? new Date());
  // The first click of a new range is held LOCALLY (not pushed to the URL) so the
  // two-click flow doesn't round-trip through the page's date defaulting. We only
  // commit via onChange once BOTH ends are chosen.
  const [pendingFrom, setPendingFrom] = useState(null);
  const pickingEnd = pendingFrom != null;

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayISO = toISO(new Date());

  function prevMonth() { setViewDate(new Date(year, month - 1, 1)); }
  function nextMonth() { setViewDate(new Date(year, month + 1, 1)); }

  function onOpenChange(o) {
    setOpen(o);
    if (o) { setPendingFrom(null); setViewDate(parseValue(from) ?? parseValue(to) ?? new Date()); }
  }

  function pick(iso) {
    if (pendingFrom == null) {
      // first click — remember the start, wait for the end
      setPendingFrom(iso);
      return;
    }
    // second click — commit the ordered range in one navigation
    const a = iso < pendingFrom ? iso : pendingFrom;
    const b = iso < pendingFrom ? pendingFrom : iso;
    setPendingFrom(null);
    setOpen(false);
    onChange({ from: a, to: b });
  }
  function clear(e) { e.stopPropagation(); setPendingFrom(null); onChange({ from: '', to: '' }); }

  // While picking, highlight the in-progress start only; otherwise the committed range.
  const hlFrom = pendingFrom ?? from;
  const hlTo = pendingFrom != null ? '' : to;

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const label = pendingFrom != null
    ? `${fmt(pendingFrom)} → …`
    : (from ? (to ? `${fmt(from)} → ${fmt(to)}` : `${fmt(from)} → …`) : null);

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm',
            'ring-offset-background transition-colors hover:bg-muted/30',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
            className,
          )}
        >
          <span className={cn('flex items-center gap-2 truncate', !label && 'text-muted-foreground')}>
            <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
            {label ?? placeholder}
          </span>
          {(from || to) && (
            <span
              role="button"
              tabIndex={0}
              onClick={clear}
              onKeyDown={(e) => { if (e.key === 'Enter') clear(e); }}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="size-3.5" />
            </span>
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-[272px] rounded-xl border border-border bg-popover p-3 shadow-xl
                     data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95
                     data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
        >
          <div className="flex items-center justify-between mb-1">
            <button type="button" onClick={prevMonth} className="flex size-7 items-center justify-center rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-sm font-semibold text-foreground">{MONTHS[month]} {year}</span>
            <button type="button" onClick={nextMonth} className="flex size-7 items-center justify-center rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
              <ChevronRight className="size-4" />
            </button>
          </div>
          <p className="text-[10px] text-center text-muted-foreground mb-2">
            {pickingEnd ? 'Select the end date' : 'Select the start date'}
          </p>

          <div className="grid grid-cols-7 mb-1">
            {DAYS.map((d) => (
              <div key={d} className="text-center text-[10px] font-semibold text-muted-foreground py-1">{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((day, idx) => {
              if (!day) return <div key={`e-${idx}`} />;
              const iso = toISO(new Date(year, month, day));
              const isStart = iso === hlFrom;
              const isEnd = iso === hlTo;
              const inRange = hlFrom && hlTo && iso > hlFrom && iso < hlTo;
              const isToday = iso === todayISO;
              return (
                <div
                  key={day}
                  className={cn(
                    'flex justify-center',
                    inRange && 'bg-primary/10',
                    isStart && hlTo && 'bg-primary/10 rounded-l-md',
                    isEnd && 'bg-primary/10 rounded-r-md',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => pick(iso)}
                    className={cn(
                      'flex size-8 items-center justify-center rounded-md text-sm transition-colors',
                      (isStart || isEnd) && 'bg-primary text-primary-foreground font-semibold shadow-sm',
                      !isStart && !isEnd && inRange && 'text-primary font-medium',
                      !isStart && !isEnd && !inRange && isToday && 'border border-primary/60 text-primary font-semibold',
                      !isStart && !isEnd && !inRange && !isToday && 'hover:bg-muted text-foreground',
                    )}
                  >
                    {day}
                  </button>
                </div>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
