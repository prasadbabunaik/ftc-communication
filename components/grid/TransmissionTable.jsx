'use client';

import { useState, useMemo, useTransition } from 'react';
import { Search, ChevronsUpDown, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { markTransmissionFtcDone } from '@/app/actions/grid';

const TYPE_COLORS = {
  LINE: 'bg-blue-50 text-blue-700 border-blue-200',
  ICT:  'bg-purple-50 text-purple-700 border-purple-200',
  GT:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  ST:   'bg-stone-50 text-stone-700 border-stone-200',
};

function SortableTh({ label, field, sortField, sortDir, onSort, className = '' }) {
  const active = sortField === field;
  return (
    <th
      onClick={() => onSort(field)}
      className={cn(
        'px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap',
        'cursor-pointer select-none hover:text-foreground transition-colors group',
        active && 'text-foreground',
        className,
      )}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active
          ? sortDir === 'asc'
            ? <ChevronUp className="size-3 text-primary" />
            : <ChevronDown className="size-3 text-primary" />
          : <ChevronsUpDown className="size-3 opacity-30 group-hover:opacity-60" />}
      </span>
    </th>
  );
}

function Th({ label, className = '' }) {
  return (
    <th className={`px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap ${className}`}>
      {label}
    </th>
  );
}

function sortRows(rows, field, dir) {
  if (!field) return rows;
  const n = (v) => (v == null ? -Infinity : Number(v));
  return [...rows].sort((a, b) => {
    let cmp = 0;
    switch (field) {
      case 'agency':   cmp = a.agencyOwner.localeCompare(b.agencyOwner, undefined, { sensitivity: 'base' }); break;
      case 'name':     cmp = a.elementName.localeCompare(b.elementName, undefined, { sensitivity: 'base' }); break;
      case 'region':   cmp = a.region.code.localeCompare(b.region.code); break;
      case 'type':     cmp = a.elementType.localeCompare(b.elementType); break;
      case 'voltage':  cmp = n(a.voltageRatingKv) - n(b.voltageRatingKv); break;
      case 'capacity': cmp = n(a.capacityMva) - n(b.capacityMva); break;
      default: return 0;
    }
    return dir === 'asc' ? cmp : -cmp;
  });
}

function MarkDoneButton({ elementId, canEdit }) {
  const [isPending, startTransition] = useTransition();
  if (!canEdit) return null;
  return (
    <button
      title="Mark FTC Done"
      disabled={isPending}
      onClick={(e) => {
        e.stopPropagation();
        startTransition(async () => {
          const res = await markTransmissionFtcDone(elementId);
          if (res?.error) toast.error(res.error);
          else toast.success('Marked as FTC done.');
        });
      }}
      className="size-7 rounded-md border border-emerald-200 flex items-center justify-center text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-40"
    >
      <CheckCircle2 className="size-3.5" />
    </button>
  );
}

export function TransmissionTable({ elements, userRole, onView }) {
  const [search, setSearch]             = useState('');
  const [regionFilter, setRegionFilter] = useState('All');
  const [typeFilter, setTypeFilter]     = useState('All');
  const [pendingOnly, setPendingOnly]   = useState(false);
  const [sortField, setSortField]       = useState('');
  const [sortDir, setSortDir]           = useState('asc');
  const [page, setPage]                 = useState(1);
  const PER_PAGE = 10;

  const regions = useMemo(() => ['All', ...new Set(elements.map((e) => e.region.code))], [elements]);

  function handleSort(field) {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
    setPage(1);
  }

  const filtered = useMemo(() => {
    let rows = [...elements];
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (e) =>
          e.elementName.toLowerCase().includes(q) ||
          e.agencyOwner.toLowerCase().includes(q) ||
          e.region.code.toLowerCase().includes(q),
      );
    }
    if (regionFilter !== 'All') rows = rows.filter((e) => e.region.code === regionFilter);
    if (typeFilter   !== 'All') rows = rows.filter((e) => e.elementType === typeFilter);
    if (pendingOnly)             rows = rows.filter((e) => e.pendingFtc);
    return sortRows(rows, sortField, sortDir);
  }, [elements, search, regionFilter, typeFilter, pendingOnly, sortField, sortDir]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paginated  = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const offset     = (page - 1) * PER_PAGE;

  const sp = { sortField, sortDir, onSort: handleSort };

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden flex flex-col min-h-0 flex-1">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 p-4 border-b bg-muted/20 shrink-0">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            className="pl-9 h-9"
            placeholder="Search by name, agency…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        {(userRole === 'NLDC' || userRole === 'ADMIN') && (
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={regionFilter}
            onChange={(e) => { setRegionFilter(e.target.value); setPage(1); }}
          >
            {regions.map((r) => <option key={r}>{r}</option>)}
          </select>
        )}
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
        >
          {['All', 'LINE', 'ICT', 'GT', 'ST'].map((t) => <option key={t}>{t}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm cursor-pointer self-center">
          <input
            type="checkbox"
            checked={pendingOnly}
            onChange={(e) => { setPendingOnly(e.target.checked); setPage(1); }}
            className="rounded"
          />
          Pending FTC only
        </label>
        <span className="text-sm text-muted-foreground self-center">{filtered.length} elements</span>
      </div>

      <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 border-b sticky top-0 z-10">
            <tr>
              <Th label="Sr. No"                               className="w-[52px]" />
              <SortableTh label="Agency / Owner"  field="agency"    className="min-w-[140px]" {...sp} />
              <SortableTh label="Element Name"    field="name"      className="min-w-[180px]" {...sp} />
              <SortableTh label="Region"          field="region"    className="w-[70px]"      {...sp} />
              <SortableTh label="Type"            field="type"      className="w-[80px]"      {...sp} />
              <SortableTh label="Voltage (kV)"    field="voltage"   className="w-[95px]"      {...sp} />
              <SortableTh label="Capacity (MVA)"  field="capacity"  className="w-[105px]"     {...sp} />
              <Th label="FTC Status"                            className="w-[130px]" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground text-sm">
                  No elements found.
                </td>
              </tr>
            ) : (
              paginated.map((e, i) => (
                <tr key={e.id} onClick={() => onView?.(e)} className="hover:bg-muted/20 transition-colors cursor-pointer">
                  <td className="px-3 py-3 text-xs text-muted-foreground tabular-nums">{offset + i + 1}</td>
                  <td className="px-3 py-3 font-medium text-foreground whitespace-nowrap">{e.agencyOwner}</td>
                  <td className="px-3 py-2.5">
                    <div className="text-sm">{e.elementName}</div>
                    {e.isRe && (
                      <span className="inline-flex items-center mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-green-50 text-green-700 border-green-200">RE</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                      {e.region.code}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${TYPE_COLORS[e.elementType]}`}>
                      {e.elementType}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-mono text-sm tabular-nums">{e.voltageRatingKv ?? '—'}</td>
                  <td className="px-3 py-3 font-mono text-sm tabular-nums">{e.capacityMva ? Number(e.capacityMva).toFixed(1) : '—'}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      {e.pendingFtc
                        ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border bg-amber-50 text-amber-700 border-amber-200">Pending</span>
                        : <span className="text-xs text-muted-foreground">Done</span>}
                      {e.pendingFtc && (
                        <MarkDoneButton
                          elementId={e.id}
                          canEdit={['ADMIN','SRLDC','NRLDC','ERLDC','WRLDC','NERLDC'].includes(userRole)}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-muted/10 shrink-0">
        <span className="text-xs text-muted-foreground">
          {filtered.length === 0 ? '0 records' : `${(page - 1) * PER_PAGE + 1}–${Math.min(page * PER_PAGE, filtered.length)} of ${filtered.length} records`}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="size-7 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:pointer-events-none transition-colors">
            <ChevronLeft className="size-3.5" />
          </button>
          {(() => {
            const pages = [];
            for (let i = Math.max(1, page - 1); i <= Math.min(totalPages, page + 1); i++) pages.push(i);
            if (pages[0] > 2) pages.unshift('…');
            if (pages[0] > 1) pages.unshift(1);
            if (pages[pages.length - 1] < totalPages - 1) pages.push('…');
            if (pages[pages.length - 1] < totalPages) pages.push(totalPages);
            return pages.map((p, idx) =>
              typeof p === 'string'
                ? <span key={`e${idx}`} className="size-7 flex items-center justify-center text-xs text-muted-foreground">…</span>
                : <button key={p} onClick={() => setPage(p)}
                    className={`size-7 rounded-md border text-xs font-medium transition-colors ${p === page ? 'border-primary bg-primary text-white' : 'border-border hover:bg-accent text-foreground'}`}>
                    {p}
                  </button>
            );
          })()}
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages || totalPages === 0}
            className="size-7 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:pointer-events-none transition-colors">
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
