'use client';

import * as Popover from '@radix-ui/react-popover';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Globe, MapPin, Check, ChevronDown, Loader2 } from 'lucide-react';

// Multi-select region filter for the dashboard (ADMIN / NLDC only). Defaults to
// "All India"; ticking one or more regions narrows every table/card to those
// regions via a comma-separated ?region=ER,NR URL param. The popover stays open
// while toggling so several can be picked in one go.
export function RegionPicker({ regions = [], selectedRegions = [] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const allCodes = regions.map((r) => r.code);
  const selected = selectedRegions.filter((c) => allCodes.includes(c));

  function pushCodes(codes) {
    const ordered = allCodes.filter((c) => codes.includes(c)); // canonical order
    const params = new URLSearchParams(searchParams);
    if (!ordered.length) params.delete('region');
    else params.set('region', ordered.join(','));
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
    ? 'All India'
    : selected.length === 1
      ? `${selected[0]} — ${regions.find((r) => r.code === selected[0])?.name ?? ''}`
      : `${selected.length} regions`;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={isPending}
          className={`relative flex items-center gap-3 pl-3.5 pr-3 h-11 rounded-lg border bg-white transition-colors cursor-pointer shadow-sm text-left ${
            active ? 'border-blue-300 bg-blue-50/40 hover:bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
          }`}
        >
          {active
            ? <MapPin className="size-[18px] text-blue-600" />
            : <Globe className="size-[18px] text-slate-500" />}
          <div className="flex flex-col leading-tight pr-1 max-w-[160px]">
            <span className="text-[9px] uppercase tracking-wide font-semibold text-slate-500">Region</span>
            <span className={`text-[13px] font-bold truncate ${active ? 'text-blue-800' : 'text-slate-800'}`}>
              {label}
            </span>
          </div>
          {isPending ? <Loader2 className="size-3.5 text-blue-600 animate-spin" /> : <ChevronDown className="size-4 text-slate-400" />}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[240px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl
                     data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95
                     data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
        >
          <button
            type="button"
            onClick={clearAll}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-md text-left transition-colors hover:bg-slate-100 ${!active ? 'bg-slate-100/70' : ''}`}
          >
            <Check className={`size-3.5 text-blue-600 ${!active ? 'opacity-100' : 'opacity-0'}`} />
            <Globe className="size-3.5 text-slate-500" />
            <span className="font-medium">All India</span>
          </button>
          <div className="my-1 border-t border-slate-100" />
          {regions.map((r) => {
            const on = selected.includes(r.code);
            return (
              <button
                key={r.code}
                type="button"
                onClick={() => toggle(r.code)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-md text-left transition-colors hover:bg-slate-100 ${on ? 'bg-blue-50' : ''}`}
              >
                <span className={`flex items-center justify-center size-3.5 rounded-[4px] border ${on ? 'bg-blue-600 border-blue-600' : 'border-slate-300'}`}>
                  {on && <Check className="size-2.5 text-white" />}
                </span>
                <span className="inline-flex items-center justify-center min-w-[34px] px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">{r.code}</span>
                <span className="text-slate-700 truncate">{r.name}</span>
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
