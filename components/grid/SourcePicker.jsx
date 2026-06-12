'use client';

import * as Popover from '@radix-ui/react-popover';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Layers, Zap, Check, ChevronDown, Loader2 } from 'lucide-react';

// Friendly labels for the source-bucket codes used by getProjectSource /
// SOURCE_ORDER. Keep in sync with lib/grid-computations.js.
const SOURCE_LABELS = {
  WIND: 'Wind', SOLAR: 'Solar', BESS: 'BESS', HYBRID: 'Hybrid',
  COAL: 'Coal', HYDRO: 'Hydro', PSP: 'PSP',
};

// Multi-select source filter for the dashboard's tab-level filter bar. Defaults
// to "All Sources"; ticking one or more narrows every generation table/card via
// a comma-separated ?source=SOLAR,HYBRID URL param. Stays open while toggling.
export function SourcePicker({ sources = [], selectedSources = [], disabled = false }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const selected = selectedSources.filter((c) => sources.includes(c));

  function pushCodes(codes) {
    const ordered = sources.filter((c) => codes.includes(c)); // canonical order
    const params = new URLSearchParams(searchParams);
    if (!ordered.length) params.delete('source');
    else params.set('source', ordered.join(','));
    startTransition(() => {
      router.push(`/dashboard${params.toString() ? '?' + params.toString() : ''}`);
    });
  }

  function toggle(code) {
    pushCodes(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code]);
  }
  function clearAll() { pushCodes([]); setOpen(false); }

  const active = selected.length > 0;
  const label = selected.length === 0
    ? 'All Sources'
    : selected.length === 1
      ? (SOURCE_LABELS[selected[0]] ?? selected[0])
      : `${selected.length} sources`;

  return (
    <Popover.Root open={disabled ? false : open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={isPending || disabled}
          title={disabled ? 'Source filter does not apply to this tab' : undefined}
          className={`relative flex items-center gap-3 pl-3.5 pr-3 h-11 rounded-lg border bg-white transition-colors shadow-sm text-left ${
            disabled
              ? 'border-slate-200 opacity-50 cursor-not-allowed'
              : active
              ? 'border-violet-300 bg-violet-50/40 hover:bg-violet-50 cursor-pointer'
              : 'border-slate-200 hover:bg-slate-50 cursor-pointer'
          }`}
        >
          {active
            ? <Zap className="size-[18px] text-violet-600" />
            : <Layers className="size-[18px] text-slate-500" />}
          <div className="flex flex-col leading-tight pr-1 max-w-[150px]">
            <span className="text-[9px] uppercase tracking-wide font-semibold text-slate-500">Source</span>
            <span className={`text-[13px] font-bold truncate ${active ? 'text-violet-800' : 'text-slate-800'}`}>
              {label}
            </span>
          </div>
          {isPending ? <Loader2 className="size-3.5 text-violet-600 animate-spin" /> : <ChevronDown className="size-4 text-slate-400" />}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[220px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl
                     data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95
                     data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
        >
          <button
            type="button"
            onClick={clearAll}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-md text-left transition-colors hover:bg-slate-100 ${!active ? 'bg-slate-100/70' : ''}`}
          >
            <Check className={`size-3.5 text-violet-600 ${!active ? 'opacity-100' : 'opacity-0'}`} />
            <Layers className="size-3.5 text-slate-500" />
            <span className="font-medium">All Sources</span>
          </button>
          <div className="my-1 border-t border-slate-100" />
          {sources.map((code) => {
            const on = selected.includes(code);
            return (
              <button
                key={code}
                type="button"
                onClick={() => toggle(code)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-md text-left transition-colors hover:bg-slate-100 ${on ? 'bg-violet-50' : ''}`}
              >
                <span className={`flex items-center justify-center size-3.5 rounded-[4px] border ${on ? 'bg-violet-600 border-violet-600' : 'border-slate-300'}`}>
                  {on && <Check className="size-2.5 text-white" />}
                </span>
                <span className="text-slate-700">{SOURCE_LABELS[code] ?? code}</span>
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
