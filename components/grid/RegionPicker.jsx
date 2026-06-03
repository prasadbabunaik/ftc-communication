'use client';

import * as Popover from '@radix-ui/react-popover';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Globe, MapPin, Check, ChevronDown, Loader2 } from 'lucide-react';

// Region filter for the dashboard header (ADMIN / NLDC only). Defaults to
// "All India"; selecting a region narrows every table/card to that region via
// the ?region=<CODE> URL param, mirroring AsOfDatePicker's navigation.
export function RegionPicker({ regions = [], selectedRegion }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const current = selectedRegion
    ? regions.find((r) => r.code === selectedRegion)
    : null;

  function navigateTo(code) {
    const params = new URLSearchParams(searchParams);
    if (!code) params.delete('region');
    else       params.set('region', code);
    startTransition(() => {
      router.push(`/dashboard${params.toString() ? '?' + params.toString() : ''}`);
    });
    setOpen(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={isPending}
          className={`relative flex items-center gap-3 pl-3.5 pr-3 h-11 rounded-lg border bg-white transition-colors cursor-pointer shadow-sm text-left ${
            current ? 'border-blue-300 bg-blue-50/40 hover:bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
          }`}
        >
          {current
            ? <MapPin className="size-[18px] text-blue-600" />
            : <Globe className="size-[18px] text-slate-500" />}
          <div className="flex flex-col leading-tight pr-1">
            <span className="text-[9px] uppercase tracking-wide font-semibold text-slate-500">Region</span>
            <span className={`text-[13px] font-bold ${current ? 'text-blue-800' : 'text-slate-800'}`}>
              {current ? `${current.code} — ${current.name}` : 'All India'}
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
            onClick={() => navigateTo(null)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-md text-left transition-colors hover:bg-slate-100 ${!current ? 'bg-slate-100/70' : ''}`}
          >
            <Check className={`size-3.5 text-blue-600 ${!current ? 'opacity-100' : 'opacity-0'}`} />
            <Globe className="size-3.5 text-slate-500" />
            <span className="font-medium">All India</span>
          </button>
          <div className="my-1 border-t border-slate-100" />
          {regions.map((r) => {
            const active = r.code === selectedRegion;
            return (
              <button
                key={r.code}
                type="button"
                onClick={() => navigateTo(r.code)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-md text-left transition-colors hover:bg-slate-100 ${active ? 'bg-blue-50' : ''}`}
              >
                <Check className={`size-3.5 text-blue-600 ${active ? 'opacity-100' : 'opacity-0'}`} />
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
