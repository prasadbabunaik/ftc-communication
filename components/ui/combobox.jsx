'use client';

import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useState, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';

// options: [{ value: string, label: string }]
// value: string (selected option value)
// onChange: (value: string) => void
export function Combobox({
  options = [],
  value,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No results found.',
  disabled,
  className,
  clearable = true,
  // When true, the search box doubles as free-text entry: if the typed value
  // doesn't match any option, an "Add «text»" row lets the user commit it.
  // onCreate(text) fires with the raw typed string; if omitted, onChange is
  // called with the text as the value.
  creatable = false,
  onCreate,
}) {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState('');
  // When the combobox lives inside a Radix Dialog, its scroll-lock
  // (react-remove-scroll) blocks wheel scrolling over content portaled to
  // <body>. Portal the list into the dialog instead so it sits inside the
  // scroll-allowed subtree; fall back to <body> when there's no dialog.
  const triggerRef = useRef(null);
  const [container, setContainer] = useState(null);

  const filtered = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  // For creatable mode, the displayed label falls back to the raw value when
  // it isn't one of the known options (a free-text entry).
  const selected = options.find((o) => o.value === value)
    ?? (creatable && value ? { value, label: value } : undefined);

  const trimmed = search.trim();
  const exactMatch = options.some((o) => o.label.toLowerCase() === trimmed.toLowerCase());
  const showCreate = creatable && trimmed.length > 0 && !exactMatch;

  function handleCreate() {
    if (onCreate) onCreate(trimmed); else onChange(trimmed);
    setOpen(false);
    setSearch('');
  }

  function handleSelect(val) {
    onChange(val);
    setOpen(false);
    setSearch('');
  }

  function handleClear(e) {
    e.stopPropagation();
    onChange('');
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        if (disabled) return;
        if (o) setContainer(triggerRef.current?.closest('[role="dialog"]') ?? null);
        setOpen(o);
        if (!o) setSearch('');
      }}
    >
      <Popover.Trigger asChild>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          className={cn(
            'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm',
            'ring-offset-background transition-colors hover:bg-muted/30',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected ? selected.label : placeholder}
          </span>
          <span className="flex items-center gap-1 shrink-0 ml-2">
            {clearable && selected && !disabled && (
              <span
                role="button"
                tabIndex={0}
                onClick={handleClear}
                onKeyDown={(e) => { if (e.key === 'Enter') handleClear(e); }}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="size-3.5" />
              </span>
            )}
            <ChevronDown className="size-4 text-muted-foreground" />
          </span>
        </button>
      </Popover.Trigger>

      <Popover.Portal container={container ?? undefined}>
        <Popover.Content
          align="start"
          sideOffset={6}
          onWheel={(e) => e.stopPropagation()}
          style={{ width: 'var(--radix-popover-trigger-width)' }}
          className="z-50 rounded-xl border border-border bg-popover shadow-xl overflow-hidden
                     data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95
                     data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
        >
          {/* Search input */}
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="size-3.5 text-muted-foreground shrink-0" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          {/* Options list */}
          <div className="max-h-[220px] overflow-y-auto py-1">
            {filtered.length === 0 && !showCreate ? (
              <p className="px-3 py-3 text-sm text-muted-foreground text-center">{emptyText}</p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => handleSelect(o.value)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors hover:bg-muted',
                    o.value === value && 'bg-muted/60',
                  )}
                >
                  <Check
                    className={cn(
                      'size-3.5 shrink-0 text-primary transition-opacity',
                      o.value === value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  {o.label}
                </button>
              ))
            )}
            {showCreate && (
              <button
                type="button"
                onClick={handleCreate}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors hover:bg-muted border-t"
              >
                <span className="inline-flex size-4 items-center justify-center rounded bg-blue-100 text-blue-700 text-xs font-bold shrink-0">+</span>
                <span>Add <span className="font-semibold">&ldquo;{trimmed}&rdquo;</span> <span className="text-muted-foreground">(not in master list)</span></span>
              </button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
