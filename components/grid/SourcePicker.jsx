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
//
// The "Hybrid" row also carries nested CHILD options — its constituent parts
// (Wind / Solar / BESS / PSP). Those are an INDEPENDENT sub-filter written to a
// separate ?hybridParts= param: they drop no projects and change no HYBRID
// total, they only narrow which sub-rows show when a HYBRID row is expanded in
// the FTC Pipeline bifurcation. `hybridParts` = the parts that actually exist.
export function SourcePicker({
  sources = [], selectedSources = [], disabled = false,
  hybridParts = [], selectedHybridParts = [], showParts = true,
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const selected = selectedSources.filter((c) => sources.includes(c));
  const selectedParts = selectedHybridParts.filter((c) => hybridParts.includes(c));

  // Push a params patch: `source` from srcCodes, `hybridParts` from partCodes.
  // Pass a value to override that key; omit to keep the current selection.
  function pushParams({ srcCodes = selected, partCodes = selectedParts } = {}) {
    const params = new URLSearchParams(searchParams);
    const orderedSrc = sources.filter((c) => srcCodes.includes(c));
    if (!orderedSrc.length) params.delete('source');
    else params.set('source', orderedSrc.join(','));
    const orderedParts = hybridParts.filter((c) => partCodes.includes(c));
    if (!orderedParts.length) params.delete('hybridParts');
    else params.set('hybridParts', orderedParts.join(','));
    startTransition(() => {
      router.push(`/dashboard${params.toString() ? '?' + params.toString() : ''}`);
    });
  }

  function toggle(code) {
    // Ticking "Hybrid" ON auto-selects ALL its constituent parts (the default
    // full view); ticking it OFF clears the parts selection. Unchecking an
    // individual part afterwards is what puts the bifurcation into "partial"
    // mode (name-only HYBRID row, only the chosen sub-rows shown).
    if (code === 'HYBRID') {
      const turningOn = !selected.includes(code);
      pushParams({
        srcCodes: turningOn ? [...selected, code] : selected.filter((c) => c !== code),
        partCodes: turningOn ? hybridParts.slice() : [],
      });
      return;
    }
    pushParams({ srcCodes: selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code] });
  }
  function togglePart(code) {
    pushParams({ partCodes: selectedParts.includes(code) ? selectedParts.filter((c) => c !== code) : [...selectedParts, code] });
  }
  // "All Sources" resets both the source and the hybrid-parts selection.
  function clearAll() { pushParams({ srcCodes: [], partCodes: [] }); setOpen(false); }

  const active = selected.length > 0 || selectedParts.length > 0;
  const label = selected.length === 0
    ? (selectedParts.length ? `Hybrid · ${selectedParts.length} part${selectedParts.length > 1 ? 's' : ''}` : 'All Sources')
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
              <div key={code}>
                <button
                  type="button"
                  onClick={() => toggle(code)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-md text-left transition-colors hover:bg-slate-100 ${on ? 'bg-violet-50' : ''}`}
                >
                  <span className={`flex items-center justify-center size-3.5 rounded-[4px] border ${on ? 'bg-violet-600 border-violet-600' : 'border-slate-300'}`}>
                    {on && <Check className="size-2.5 text-white" />}
                  </span>
                  <span className="text-slate-700">{SOURCE_LABELS[code] ?? code}</span>
                </button>

                {/* Nested constituent-part filters under Hybrid — independent
                    ?hybridParts= sub-filter for the pipeline bifurcation. */}
                {code === 'HYBRID' && showParts && hybridParts.length > 0 && (
                  <div className="ml-[19px] mt-0.5 mb-1 pl-2 border-l border-slate-200 space-y-0.5">
                    <p className="px-2 pt-1 pb-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                      Show parts in bifurcation
                    </p>
                    {hybridParts.map((pc) => {
                      const pon = selectedParts.includes(pc);
                      return (
                        <button
                          key={pc}
                          type="button"
                          onClick={() => togglePart(pc)}
                          className={`w-full flex items-center gap-2.5 px-2 py-1.5 text-[13px] rounded-md text-left transition-colors hover:bg-slate-100 ${pon ? 'bg-teal-50' : ''}`}
                        >
                          <span className={`flex items-center justify-center size-3.5 rounded-[4px] border ${pon ? 'bg-teal-600 border-teal-600' : 'border-slate-300'}`}>
                            {pon && <Check className="size-2.5 text-white" />}
                          </span>
                          <span className="text-slate-600">{SOURCE_LABELS[pc] ?? pc}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
