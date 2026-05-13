'use client';

import * as Popover from '@radix-ui/react-popover';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// value: "YYYY-MM" string | "" | null
// onChange: (value: string) => void
export function MonthPicker({ value, onChange, placeholder = 'Pick a month', disabled, className }) {
  const parsed = value ? value.split('-') : null;
  const selectedYear  = parsed ? parseInt(parsed[0]) : null;
  const selectedMonth = parsed ? parseInt(parsed[1]) - 1 : null; // 0-indexed

  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => selectedYear ?? new Date().getFullYear());

  function displayValue() {
    if (!value || !parsed) return null;
    return `${MONTHS_SHORT[selectedMonth]} ${selectedYear}`;
  }

  function select(monthIdx) {
    const m = String(monthIdx + 1).padStart(2, '0');
    onChange(`${viewYear}-${m}`);
    setOpen(false);
  }

  function clear(e) {
    e.stopPropagation();
    onChange('');
  }

  return (
    <Popover.Root open={open} onOpenChange={(o) => setOpen(disabled ? false : o)}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm',
            'ring-offset-background transition-colors hover:bg-muted/30',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        >
          <span className={cn('flex items-center gap-2', !value && 'text-muted-foreground')}>
            <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
            {displayValue() ?? placeholder}
          </span>
          {value && !disabled && (
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
          className="z-50 w-[220px] rounded-xl border border-border bg-popover p-3 shadow-xl
                     data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95
                     data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
        >
          {/* Year navigation */}
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={() => setViewYear(y => y - 1)}
              className="flex size-7 items-center justify-center rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-sm font-semibold text-foreground">{viewYear}</span>
            <button
              type="button"
              onClick={() => setViewYear(y => y + 1)}
              className="flex size-7 items-center justify-center rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          {/* Month grid */}
          <div className="grid grid-cols-3 gap-1">
            {MONTHS_SHORT.map((m, idx) => {
              const isSel = selectedYear === viewYear && selectedMonth === idx;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => select(idx)}
                  className={cn(
                    'rounded-md py-1.5 text-xs font-medium transition-colors',
                    isSel  && 'bg-primary text-primary-foreground shadow-sm',
                    !isSel && 'hover:bg-muted text-foreground',
                  )}
                >
                  {m}
                </button>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
