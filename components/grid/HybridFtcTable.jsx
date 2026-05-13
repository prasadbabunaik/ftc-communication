'use client';

import { useState, useMemo } from 'react';
import { Search, ChevronsUpDown, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

function mw(val) {
  if (val == null) return '—';
  return Number(val).toFixed(1);
}

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
      case 'name':     cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }); break;
      case 'region':   cmp = a.region.code.localeCompare(b.region.code); break;
      case 'totalCap': cmp = n(a.totalCapacityMw) - n(b.totalCapacityMw); break;
      case 'wind':     cmp = n(a.windCapacityMw) - n(b.windCapacityMw); break;
      case 'solar':    cmp = n(a.solarCapacityMw) - n(b.solarCapacityMw); break;
      case 'bess':     cmp = n(a.bessCapacityMw) - n(b.bessCapacityMw); break;
      default: return 0;
    }
    return dir === 'asc' ? cmp : -cmp;
  });
}

export function HybridFtcTable({ projects, userRole, onView }) {
  const [search, setSearch]             = useState('');
  const [regionFilter, setRegionFilter] = useState('All');
  const [sortField, setSortField]       = useState('');
  const [sortDir, setSortDir]           = useState('asc');
  const [page, setPage]                 = useState(1);
  const PER_PAGE = 10;

  const regions = useMemo(() => ['All', ...new Set(projects.map((p) => p.region.code))], [projects]);

  function handleSort(field) {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
    setPage(1);
  }

  const filtered = useMemo(() => {
    let rows = [...projects];
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.poolingStation?.name?.toLowerCase().includes(q) ?? false) ||
          p.region.code.toLowerCase().includes(q),
      );
    }
    if (regionFilter !== 'All') rows = rows.filter((p) => p.region.code === regionFilter);
    return sortRows(rows, sortField, sortDir);
  }, [projects, search, regionFilter, sortField, sortDir]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paginated  = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const offset     = (page - 1) * PER_PAGE;

  const sp = { sortField, sortDir, onSort: handleSort };

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 p-4 border-b bg-muted/20">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            className="pl-9 h-9"
            placeholder="Search generating station or region…"
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
        <span className="text-sm text-muted-foreground self-center">
          {filtered.length} project{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 border-b">
            <tr>
              <Th label="Sr. No"                              className="w-[52px]" />
              <SortableTh label="Generating Station" field="name"     className="min-w-[180px]" {...sp} />
              <Th label="Pooling Station"                     className="min-w-[150px]" />
              <Th label="Plant Type"                          className="min-w-[150px]" />
              <SortableTh label="Region"            field="region"    className="w-[70px]"      {...sp} />
              <SortableTh label="Wind (MW)"         field="wind"      className="w-[90px]"      {...sp} />
              <SortableTh label="Solar (MW)"        field="solar"     className="w-[90px]"      {...sp} />
              <SortableTh label="BESS (MW)"         field="bess"      className="w-[90px]"      {...sp} />
              <SortableTh label="Total (MW)"        field="totalCap"  className="w-[90px]"      {...sp} />
              <Th label="Phases"                              className="w-[70px]" />
              <Th label="Actions"                             className="w-[70px]" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-12 text-center text-muted-foreground text-sm">
                  No cleared hybrid projects found.
                </td>
              </tr>
            ) : (
              paginated.map((p, i) => (
                <tr key={p.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-3 text-xs text-muted-foreground tabular-nums">{offset + i + 1}</td>
                  <td className="px-3 py-3 font-medium text-foreground">{p.name}</td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{p.poolingStation?.name ?? '—'}</td>
                  <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{p.plantType.label}</td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                      {p.region.code}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-mono text-sm tabular-nums text-sky-700">{mw(p.windCapacityMw)}</td>
                  <td className="px-3 py-3 font-mono text-sm tabular-nums text-amber-700">{mw(p.solarCapacityMw)}</td>
                  <td className="px-3 py-3 font-mono text-sm tabular-nums text-purple-700">{mw(p.bessCapacityMw)}</td>
                  <td className="px-3 py-3 font-mono text-sm tabular-nums">{mw(p.totalCapacityMw)}</td>
                  <td className="px-3 py-3 text-xs text-muted-foreground tabular-nums">
                    {p.phases.length === 0
                      ? <span className="text-muted-foreground/50 italic">none</span>
                      : p.phases.length}
                  </td>
                  <td className="px-3 py-3">
                    <button
                      onClick={() => onView?.(p)}
                      className="size-7 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      title="View details"
                    >
                      <Eye className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-muted/10">
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
