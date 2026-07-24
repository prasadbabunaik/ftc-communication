'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { SlidersHorizontal, RotateCcw } from 'lucide-react';

const STORAGE_PREFIX = 'ftc:cols:';

// Per-table column-visibility state, persisted to localStorage. We store the
// set of HIDDEN keys (not visible) so that any column added to the table later
// defaults to visible, and an empty store means "show everything".
//
//   columns: [{ key, label, locked? }]   — `locked` columns can never be hidden.
//   returns { hidden:Set, isVisible(key), toggle(key), reset(), ready }
export function useColumnVisibility(storageKey, columns) {
  const lockedKeys = columns.filter((c) => c.locked).map((c) => c.key);
  const [hidden, setHidden] = useState(() => new Set());
  const [ready, setReady] = useState(false);

  // Load persisted choice on mount (client only).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + storageKey);
      if (raw) {
        const keys = JSON.parse(raw);
        if (Array.isArray(keys)) {
          // Never persist a locked column as hidden (defensive).
          setHidden(new Set(keys.filter((k) => !lockedKeys.includes(k))));
        }
      }
    } catch { /* ignore malformed storage */ }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const persist = useCallback((next) => {
    setHidden(next);
    try { localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify([...next])); }
    catch { /* storage may be unavailable */ }
  }, [storageKey]);

  const isVisible = useCallback((key) => !hidden.has(key), [hidden]);

  const toggle = useCallback((key) => {
    if (lockedKeys.includes(key)) return;
    const next = new Set(hidden);
    next.has(key) ? next.delete(key) : next.add(key);
    persist(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden, persist]);

  const reset = useCallback(() => persist(new Set()), [persist]);

  return { hidden, isVisible, toggle, reset, ready };
}

// Dropdown control: a "Columns" button that opens a checkbox list of the
// toggleable columns. Closes on outside-click or Escape.
export function ColumnCustomizer({ columns, hidden, onToggle, onReset, size = 'sm' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const toggleable = columns.filter((c) => !c.locked);
  const hiddenCount = toggleable.filter((c) => hidden.has(c.key)).length;
  const h = size === 'sm' ? 'h-9' : 'h-11';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Show / hide columns"
        aria-label="Customize columns"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 ${h} rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground hover:bg-muted transition-colors`}
      >
        <SlidersHorizontal className="size-4 text-muted-foreground" />
        Columns
        {hiddenCount > 0 && (
          <span className="ml-0.5 inline-flex items-center justify-center rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 min-w-[18px] h-[18px]">
            {hiddenCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-1 z-50 w-60 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-2">
          <div className="flex items-center justify-between px-1 pb-1.5 mb-1 border-b border-border">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Show columns</span>
            <button
              type="button"
              onClick={onReset}
              disabled={hiddenCount === 0}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline disabled:cursor-default"
            >
              <RotateCcw className="size-3" /> Reset
            </button>
          </div>
          <div className="max-h-[320px] overflow-y-auto py-0.5">
            {toggleable.map((c) => {
              const visible = !hidden.has(c.key);
              return (
                <label
                  key={c.key}
                  className="flex items-center gap-2 px-1.5 py-1.5 rounded text-xs cursor-pointer hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    checked={visible}
                    onChange={() => onToggle(c.key)}
                    className="size-3.5 rounded border-input accent-primary"
                  />
                  <span className={visible ? 'text-foreground' : 'text-muted-foreground'}>{c.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
