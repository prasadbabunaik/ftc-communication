'use client';

import { useState, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Trash2, ChevronsUpDown, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { deleteGenerationProject } from '@/app/actions/grid';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody,
} from '@/components/ui/dialog';

const STATUS_COLORS = {
  PENDING:  'bg-amber-50 text-amber-700 border-amber-200',
  RECEIVED: 'bg-blue-50 text-blue-700 border-blue-200',
  CLEARED:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
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
  return [...rows].sort((a, b) => {
    let av, bv;
    switch (field) {
      case 'developer':   av = a.developerName ?? ''; bv = b.developerName ?? ''; break;
      case 'name':        av = a.name;                bv = b.name;               break;
      case 'region':      av = a.region.code;         bv = b.region.code;        break;
      case 'type':        av = a.plantType.label;     bv = b.plantType.label;    break;
      case 'capacity':    av = Number(a.contd4?.capacityApr26Mw ?? a.totalCapacityMw); bv = Number(b.contd4?.capacityApr26Mw ?? b.totalCapacityMw); break;
      case 'status':      av = a.contd4?.status ?? ''; bv = b.contd4?.status ?? ''; break;
      default: return 0;
    }
    const cmp = typeof av === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' });
    return dir === 'asc' ? cmp : -cmp;
  });
}

export function Contd4ApplicationTable({ projects, userRole, onView }) {
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

  const canEdit = ['ADMIN', 'SRLDC', 'NRLDC', 'ERLDC', 'WRLDC', 'NERLDC'].includes(userRole);

  const regions = useMemo(() => ['All', ...new Set(projects.map((p) => p.region.code))], [projects]);
  const types   = useMemo(() => ['All', ...new Set(projects.map((p) => p.plantType.label))], [projects]);

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
          (p.developerName?.toLowerCase().includes(q) ?? false) ||
          (p.poolingStation?.name?.toLowerCase().includes(q) ?? false) ||
          p.region.code.toLowerCase().includes(q),
      );
    }
    if (regionFilter !== 'All') rows = rows.filter((p) => p.region.code === regionFilter);
    if (typeFilter   !== 'All') rows = rows.filter((p) => p.plantType.label === typeFilter);
    if (statusFilter !== 'All') rows = rows.filter((p) => (p.contd4?.status ?? 'NONE') === statusFilter);
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

  const sortProps = { sortField, sortDir, onSort: handleSort };

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 p-4 border-b bg-muted/20">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            className="pl-9 h-9"
            placeholder="Search developer, station, pooling station…"
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
          {types.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
        >
          {['All', 'PENDING', 'RECEIVED', 'CLEARED', 'REJECTED'].map((s) => (
            <option key={s} value={s}>{s === 'All' ? 'All Statuses' : s}</option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground self-center">
          {filtered.length} project{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 border-b">
            <tr>
              <Th label="Sr. No"  className="w-[52px]" />
              <SortableTh label="Name of Developer"  field="developer" className="min-w-[180px]" {...sortProps} />
              <SortableTh label="Generating Station" field="name"      className="min-w-[180px]" {...sortProps} />
              <SortableTh label="Region"             field="region"    className="w-[75px]"      {...sortProps} />
              <SortableTh label="Generation Type"    field="type"      className="min-w-[160px]" {...sortProps} />
              <SortableTh label="Declared Cap (MW)"  field="capacity"  className="w-[120px]"     {...sortProps} />
              <SortableTh label="Status"             field="status"    className="w-[110px]"     {...sortProps} />
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
                  <td className="px-3 py-3 text-sm font-medium text-foreground">{p.developerName ?? '—'}</td>
                  <td className="px-3 py-3 text-sm text-foreground">{p.name}</td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                      {p.region.code}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{p.plantType.label}</td>
                  <td className="px-3 py-3 tabular-nums">
                    {p.contd4?.capacityApr26Mw
                      ? <span className="font-mono text-sm font-semibold">{Number(p.contd4.capacityApr26Mw).toFixed(1)}</span>
                      : <span className="font-mono text-sm text-muted-foreground">{Number(p.totalCapacityMw).toFixed(1)}</span>}
                    <span className="block text-[10px] text-muted-foreground font-sans">of {Number(p.totalCapacityMw).toFixed(1)} MW</span>
                  </td>
                  <td className="px-3 py-3">
                    {p.contd4 ? (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${STATUS_COLORS[p.contd4.status] ?? ''}`}>
                        {p.contd4.status}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">No application</span>
                    )}
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
