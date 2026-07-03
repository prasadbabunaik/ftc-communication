'use client';

import { useState, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Trash2, ChevronsUpDown, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, AlertTriangle, CalendarClock, X as XIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { deleteGenerationProject } from '@/app/actions/grid';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody,
} from '@/components/ui/dialog';
import { CONTD4_STATUS_LABEL, CONTD4_STATUS_BADGE as STATUS_COLORS, contd4CapacityOf } from '@/lib/grid-computations';

const STATUS_OPTIONS = ['UNDER_PROCESS', 'CLEARED', 'REJECTED'];

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
  return [...rows].sort((a, b) => {
    let av, bv;
    switch (field) {
      case 'name':        av = a.name;                bv = b.name;               break;
      case 'region':      av = a.region.code;         bv = b.region.code;        break;
      case 'type':        av = a.plantType.label;     bv = b.plantType.label;    break;
      case 'capacity':    av = Number(contd4CapacityOf(a) ?? 0); bv = Number(contd4CapacityOf(b) ?? 0); break;
      case 'status':      av = a.contd4?.status ?? ''; bv = b.contd4?.status ?? ''; break;
      default: return 0;
    }
    const cmp = typeof av === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' });
    return dir === 'asc' ? cmp : -cmp;
  });
}

export function Contd4ApplicationTable({ projects, userRole, onView, asOf }) {
  const [search, setSearch]             = useState('');
  const [regionFilter, setRegionFilter] = useState('All');
  const [typeFilter, setTypeFilter]     = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [sortField, setSortField]       = useState('');
  const [sortDir, setSortDir]           = useState('asc');
  const [page, setPage]                 = useState(1);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isPending, startTransition]    = useTransition();
  const router = useRouter();
  const PER_PAGE = 10;

  const canEdit = ['ADMIN', 'NLDC', 'SRLDC', 'NRLDC', 'ERLDC', 'WRLDC', 'NERLDC'].includes(userRole);

  const regions = useMemo(() => ['All', ...new Set(projects.map((p) => p.region.code))], [projects]);
  // Roll up every hybrid sub-type (Hybrid (Wind+Solar), Hybrid (Solar+BESS),
  // Hybrid (Wind+Solar+BESS), Hybrid (Solar+PSP) …) into a single "Hybrid"
  // option in the type filter — users typically want to filter "all hybrids"
  // rather than each combination separately.
  const displayType = (label) => (label?.toLowerCase().startsWith('hybrid') ? 'Hybrid' : label);
  const types = useMemo(
    () => ['All', ...new Set(projects.map((p) => displayType(p.plantType.label)))],
    [projects],
  );

  function handleSort(field) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
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
    if (typeFilter   !== 'All') {
      // When the user picks "Hybrid", match every hybrid sub-type.
      rows = typeFilter === 'Hybrid'
        ? rows.filter((p) => p.plantType.label?.toLowerCase().startsWith('hybrid'))
        : rows.filter((p) => p.plantType.label === typeFilter);
    }
    if (statusFilter !== 'All') rows = rows.filter((p) => (p.contd4?.status ?? 'NONE') === statusFilter);
    // If no explicit sort is chosen, default-order by status priority so the
    // active (Under Process) applications surface above the completed ones.
    if (!sortField) {
      const STATUS_RANK = { UNDER_PROCESS: 0, REJECTED: 2, CLEARED: 3, NONE: 4 };
      return [...rows].sort((a, b) => {
        const ra = STATUS_RANK[a.contd4?.status ?? 'NONE'] ?? 99;
        const rb = STATUS_RANK[b.contd4?.status ?? 'NONE'] ?? 99;
        if (ra !== rb) return ra - rb;
        // Tie-break by region then name for a stable order.
        const rc = String(a.region.code).localeCompare(String(b.region.code));
        if (rc !== 0) return rc;
        return String(a.name).localeCompare(String(b.name));
      });
    }
    return sortRows(rows, sortField, sortDir);
  }, [projects, search, regionFilter, typeFilter, statusFilter, sortField, sortDir]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paginated  = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const offset     = (page - 1) * PER_PAGE;

  function confirmDelete() {
    if (!deleteTarget) return;
    startTransition(async () => {
      const result = await deleteGenerationProject(deleteTarget.id);
      setDeleteTarget(null);
      if (result?.error) toast.error(result.error);
      else { toast.success(`"${deleteTarget.name}" deleted.`); router.refresh(); }
    });
  }

  const filtersActive = !!(search || regionFilter !== 'All' || typeFilter !== 'All' || statusFilter !== 'All' || asOf);

  // ── As-of date filter — drives a URL navigation so the server-side query
  //   re-fetches projects active on that date plus their phases up to that
  //   date. The local state mirrors `asOf` so the picker stays in sync.
  function setAsOfDate(yyyymmdd) {
    const url = new URL(window.location.href);
    if (yyyymmdd) url.searchParams.set('asOf', yyyymmdd);
    else          url.searchParams.delete('asOf');
    router.push(url.pathname + url.search);
  }


  const sortProps = { sortField, sortDir, onSort: handleSort };

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden flex flex-col min-h-0 flex-1">
      {/* As-of-date snapshot banner */}
      {asOf && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-[12px] text-amber-800">
          <CalendarClock className="size-3.5 text-amber-700 shrink-0" />
          <span>
            Snapshot view — showing CONTD-4 applications as they stood on{' '}
            <strong>
              {new Date(asOf + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </strong>
            . Status is reconstructed from the audit trail; phases declared after this date are hidden; total declared capacity reflects only the phases visible on that date.
          </span>
          <button
            type="button"
            onClick={() => setAsOfDate(null)}
            className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 border border-amber-300 transition-colors shrink-0"
          >
            <XIcon className="size-3" /> Back to current
          </button>
        </div>
      )}

      {/* Filters — each field carries a small uppercase label above the
          input so the meaning of each dropdown is obvious at a glance. */}
      <div className="flex flex-wrap items-end gap-3 p-4 border-b bg-muted/20">
        {/* Search */}
        <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            Search
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              className="pl-9 h-9"
              placeholder="Station, pooling station, region…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>

        {/* Region */}
        {(userRole === 'NLDC' || userRole === 'ADMIN') && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              Region
            </label>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[90px]"
              value={regionFilter}
              onChange={(e) => { setRegionFilter(e.target.value); setPage(1); }}
            >
              {regions.map((r) => (
                <option key={r} value={r}>{r === 'All' ? 'All Regions' : r}</option>
              ))}
            </select>
          </div>
        )}

        {/* Plant Type */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            Plant Type
          </label>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[120px]"
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          >
            {types.map((t) => (
              <option key={t} value={t}>{t === 'All' ? 'All Types' : t}</option>
            ))}
          </select>
        </div>

        {/* Status */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            Status
          </label>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[120px]"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          >
            {['All', ...STATUS_OPTIONS].map((s) => (
              <option key={s} value={s}>{s === 'All' ? 'All Statuses' : CONTD4_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>

        {/* As-of date picker — view CONTD-4 list as it stood on any past date */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1">
            <CalendarClock className="size-3" />
            As-of Date
          </label>
          <div className="flex items-center gap-1">
            <div className="w-[170px]">
              <DatePicker
                value={asOf ?? ''}
                onChange={(v) => setAsOfDate(v || null)}
                placeholder="Pick a past date…"
                className="h-9"
              />
            </div>
            {asOf && (
              <button
                type="button"
                onClick={() => setAsOfDate(null)}
                className="text-slate-400 hover:text-rose-600 transition-colors"
                title="Clear date filter (return to current view)"
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Count */}
        <div className="flex flex-col gap-1 ml-auto">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            Results
          </label>
          <span className="text-sm text-muted-foreground self-start h-9 inline-flex items-center">
            {filtered.length} project{filtered.length !== 1 ? 's' : ''}
            {filtersActive && <span className="ml-1 text-amber-700">· filtered</span>}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-auto flex-1 min-h-0">
        {/* table-fixed: column widths come from the header only, so they stay
            uniform regardless of sort order / which rows are on the page. */}
        <table className="w-full text-sm table-fixed min-w-[1080px]">
          <thead className="bg-card border-b sticky top-0 z-20 shadow-sm">
            <tr>
              <Th label="Sr. No"  className="w-[52px]" />
              <SortableTh label="Generating Station" field="name"      className="w-[240px]"  {...sortProps} />
              <SortableTh label="Region"             field="region"    className="w-[75px]"   {...sortProps} />
              <SortableTh label="Generation Type"    field="type"      className="w-[160px]"  {...sortProps} />
              <SortableTh label="Declared Cap (MW)"  field="capacity"  className="w-[140px]"  {...sortProps} />
              <SortableTh label="Status"             field="status"    className="w-[110px]"  {...sortProps} />
              <Th label="Remarks"                                       className="w-[300px]" />
              <Th label="Actions" className="w-[110px] text-right pr-4" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground text-sm">
                  No CONTD-4 applications found.
                </td>
              </tr>
            ) : (
              paginated.map((p, i) => (
                <tr key={p.id} onClick={() => onView?.(p)} className="hover:bg-muted/20 transition-colors cursor-pointer">
                  <td className="px-3 py-3 text-xs text-muted-foreground tabular-nums">{offset + i + 1}</td>
                  <td className="px-3 py-3 text-sm font-medium text-foreground truncate" title={p.name}>{p.name}</td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                      {p.region.code}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground truncate" title={p.plantType.label}>{p.plantType.label}</td>
                  <td className="px-3 py-3 tabular-nums">
                    {!p.contd4
                      ? <span className="font-mono text-sm text-muted-foreground">—</span>
                      : p.contd4.capacityApr26Mw != null
                        ? <span className="font-mono text-sm font-semibold">{Number(p.contd4.capacityApr26Mw).toFixed(1)}</span>
                        : <span className="font-mono text-sm text-muted-foreground">{Number(p.totalCapacityMw).toFixed(1)}</span>}
                    <span className="block text-[10px] text-muted-foreground font-sans">of {Number(p.totalCapacityMw).toFixed(1)} MW</span>
                  </td>
                  <td className="px-3 py-3">
                    {p.contd4 ? (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${STATUS_COLORS[p.contd4.status] ?? ''}`}>
                        {CONTD4_STATUS_LABEL[p.contd4.status] ?? p.contd4.status}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">No application</span>
                    )}
                  </td>
                  {/* Remarks column — phase-wise stack of dated remarks, plus
                      the application-level remark (if any). Ordered most recent
                      first so the latest update is the first thing the user sees. */}
                  <td className="px-3 py-3 text-xs text-muted-foreground align-top">
                    {(() => {
                      const phaseRemarks = (p.contd4?.phases ?? [])
                        .filter(ph => (ph.remarks ?? '').trim())
                        .map(ph => ({
                          date: ph.declaredDate ? new Date(ph.declaredDate) : null,
                          text: ph.remarks,
                        }));
                      if (p.contd4?.remarks?.trim()) {
                        // Use remarksUpdatedAt (set only when the remarks field
                        // itself changes) — not updatedAt, which gets bumped by
                        // other writes like phase additions.
                        const appRemarkDate = p.contd4.remarksUpdatedAt
                          || p.contd4.applicationDate
                          || p.contd4.createdAt;
                        phaseRemarks.push({
                          date: appRemarkDate ? new Date(appRemarkDate) : null,
                          text: p.contd4.remarks,
                          isAppLevel: true,
                        });
                      }
                      phaseRemarks.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
                      if (phaseRemarks.length === 0) return <span className="text-muted-foreground/60">—</span>;
                      return (
                        <div
                          className="space-y-1 max-w-[300px]"
                          title={phaseRemarks.map(r => (r.date ? r.date.toISOString().slice(0,10) + ': ' : '') + r.text).join('\n')}
                        >
                          {phaseRemarks.slice(0, 3).map((r, idx) => (
                            <div key={idx} className="leading-snug">
                              {r.date && (
                                <span className="inline-block mr-1.5 text-[9px] font-mono font-semibold text-slate-500 tabular-nums">
                                  {r.date.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'2-digit' })}
                                </span>
                              )}
                              <span className={`${r.isAppLevel ? 'italic text-slate-500' : 'text-slate-700'} line-clamp-2`}>
                                {r.text}
                              </span>
                            </div>
                          ))}
                          {phaseRemarks.length > 3 && (
                            <p className="text-[10px] text-slate-400 italic">+ {phaseRemarks.length - 3} more — open project for full history</p>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-3">
                    {canEdit && (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(p); }}
                          disabled={isPending}
                          title="Delete"
                          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Delete confirm modal */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4" /> Delete Project
            </DialogTitle>
            <DialogDescription>
              This will permanently delete <span className="font-semibold text-foreground">"{deleteTarget?.name}"</span> and all associated CONTD-4 data, phases, and notes. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)} disabled={isPending}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={confirmDelete} disabled={isPending}>
                {isPending ? 'Deleting…' : 'Delete Project'}
              </Button>
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>

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
            return pages.map((p, i) =>
              typeof p === 'string'
                ? <span key={`e${i}`} className="size-7 flex items-center justify-center text-xs text-muted-foreground">…</span>
                : <button key={p} onClick={() => setPage(p)}
                    className={`size-7 rounded-md border text-xs font-medium transition-colors ${p === page ? 'border-primary bg-primary text-white' : 'border-border hover:bg-accent text-foreground'}`}>
                    {p}
                  </button>
            );
          })()}
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="size-7 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:pointer-events-none transition-colors">
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
