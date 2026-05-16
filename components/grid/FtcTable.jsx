'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Search, ChevronsUpDown, ChevronUp, ChevronDown,
  ChevronLeft, ChevronRight, AlertCircle,
} from 'lucide-react';
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

function ThPink({ label, className = '' }) {
  return (
    <th className={`px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap bg-pink-50 ${className}`}>
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
      case 'name':       cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }); break;
      case 'region':     cmp = a.region.code.localeCompare(b.region.code); break;
      case 'totalCap':   cmp = n(a.totalCapacityMw)  - n(b.totalCapacityMw); break;
      case 'applied':    cmp = n(a._appliedMw)        - n(b._appliedMw); break;
      case 'approved':   cmp = n(a._approvedMw)       - n(b._approvedMw); break;
      case 'ftcPending': cmp = n(a._ftcPendingMw)     - n(b._ftcPendingMw); break;
      case 'tocIssued':  cmp = n(a._tocIssuedMw)      - n(b._tocIssuedMw); break;
      case 'codDeclared':cmp = n(a._codDeclaredMw)    - n(b._codDeclaredMw); break;
      default: return 0;
    }
    return dir === 'asc' ? cmp : -cmp;
  });
}

// COD Pending = TOC issued − COD declared − (capacity already in TOC process)
function codPendingFromPhase(ph) {
  const toc      = ph.tocIssuedMw         ?? 0;
  const cod      = ph.codDeclaredMw       ?? 0;
  const underToc = ph.capacityUnderTocMw  ?? 0;
  return Math.max(0, toc - cod - underToc);
}

function aggregateBySource(phases) {
  const map = {};
  for (const ph of phases) {
    if (!map[ph.sourceType]) {
      map[ph.sourceType] = {
        sourceType: ph.sourceType,
        applied: 0, ftcApproved: 0, ftcPending: 0,
        tocIssued: 0, tocPending: 0, codDeclared: 0, codPending: 0, expected: 0,
      };
    }
    const r = map[ph.sourceType];
    r.applied     += ph.capacityAppliedMw  ?? 0;
    r.ftcApproved += ph.ftcCompletedMw     ?? 0;
    r.ftcPending  += ph.capacityUnderFtcMw ?? 0;
    r.tocIssued   += ph.tocIssuedMw        ?? 0;
    r.tocPending  += ph.capacityUnderTocMw ?? 0;
    r.codDeclared += ph.codDeclaredMw      ?? 0;
    r.codPending  += codPendingFromPhase(ph);
    r.expected    += ph.expectedApr26Mw    ?? 0;
  }
  return Object.values(map);
}

const SOURCE_COLORS = {
  WIND:  'bg-sky-50 text-sky-700 border-sky-200',
  SOLAR: 'bg-amber-50 text-amber-700 border-amber-200',
  BESS:  'bg-violet-50 text-violet-700 border-violet-200',
  COAL:  'bg-stone-100 text-stone-700 border-stone-300',
  HYDRO: 'bg-teal-50 text-teal-700 border-teal-200',
  PSP:   'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function SourceBadge({ source }) {
  const cls = SOURCE_COLORS[source] ?? 'bg-muted text-muted-foreground border-border';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${cls}`}>
      {source}
    </span>
  );
}

// Per-event detail panel rendered inside an expanded project row.
// Shows every FTC / TOC / COD event for every phase as one row each:
//   Milestone · Date · Capacity (MW) · Source · Remarks
// Plus the running cumulative MW at the bottom of each milestone group.
function fmtEventDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function EventTimeline({ phases }) {
  // Flatten all events from all phases, tag with milestone + source.
  const rows = [];
  for (const ph of phases ?? []) {
    for (const e of (ph.ftcEvents ?? [])) rows.push({ kind: 'FTC', date: e.eventDate, mw: e.capacityMw, remarks: e.remarks, source: ph.sourceType, id: 'f' + e.id });
    for (const e of (ph.tocEvents ?? [])) rows.push({ kind: 'TOC', date: e.eventDate, mw: e.capacityMw, remarks: e.remarks, source: ph.sourceType, id: 't' + e.id });
    for (const e of (ph.codEvents ?? [])) rows.push({ kind: 'COD', date: e.eventDate, mw: e.capacityMw, remarks: e.remarks, source: ph.sourceType, id: 'c' + e.id });
  }
  if (rows.length === 0) return null;

  // Sort by date asc, then by kind (FTC < TOC < COD) so within the same day
  // the milestones appear in pipeline order.
  const ORDER = { FTC: 0, TOC: 1, COD: 2 };
  rows.sort((a, b) => {
    const cmpDate = new Date(a.date) - new Date(b.date);
    if (cmpDate !== 0) return cmpDate;
    return ORDER[a.kind] - ORDER[b.kind];
  });

  // Running cumulative per milestone (for the right-most "Cumulative" column).
  const cum = { FTC: 0, TOC: 0, COD: 0 };

  const kindTone = {
    FTC: 'bg-blue-100 text-blue-800 border-blue-200',
    TOC: 'bg-violet-100 text-violet-800 border-violet-200',
    COD: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  };

  // Per-kind totals for the header strip.
  const total = { FTC: 0, TOC: 0, COD: 0 };
  for (const r of rows) total[r.kind] += Number(r.mw || 0);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">Phased commissioning history</span>
        <span className="text-[10px] text-slate-500">{rows.length} events</span>
        <span className="text-[10px] inline-flex items-center gap-1">
          <span className={`inline-block size-2 rounded-full bg-blue-500`}></span>
          <span className="text-slate-600 font-medium">FTC</span>
          <span className="font-mono font-semibold text-blue-700">{total.FTC.toFixed(2)} MW</span>
        </span>
        <span className="text-[10px] inline-flex items-center gap-1">
          <span className={`inline-block size-2 rounded-full bg-violet-500`}></span>
          <span className="text-slate-600 font-medium">TOC</span>
          <span className="font-mono font-semibold text-violet-700">{total.TOC.toFixed(2)} MW</span>
        </span>
        <span className="text-[10px] inline-flex items-center gap-1">
          <span className={`inline-block size-2 rounded-full bg-emerald-500`}></span>
          <span className="text-slate-600 font-medium">COD</span>
          <span className="font-mono font-semibold text-emerald-700">{total.COD.toFixed(2)} MW</span>
        </span>
      </div>
      <div className="rounded-md border border-border bg-white overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-border">
            <tr className="text-[10px] text-slate-600 uppercase tracking-wide">
              <th className="px-3 py-2 text-left font-semibold">Milestone</th>
              <th className="px-3 py-2 text-left font-semibold">Date</th>
              <th className="px-3 py-2 text-right font-semibold">Capacity (MW)</th>
              <th className="px-3 py-2 text-right font-semibold">Cumulative</th>
              <th className="px-3 py-2 text-left font-semibold">Source</th>
              <th className="px-3 py-2 text-left font-semibold">Remarks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              cum[r.kind] += Number(r.mw || 0);
              return (
                <tr key={r.id} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${kindTone[r.kind]}`}>
                      {r.kind}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-700 tabular-nums">{fmtEventDate(r.date)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                    {Number(r.mw || 0).toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-500 tabular-nums">
                    {cum[r.kind].toFixed(2)}
                  </td>
                  <td className="px-3 py-2">
                    <SourceBadge source={r.source} />
                  </td>
                  <td className="px-3 py-2 text-slate-600 max-w-[420px]">
                    {r.remarks ? <span className="line-clamp-2" title={r.remarks}>{r.remarks}</span> : <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function FtcTable({ projects, userRole, onView, refMonthLabel = "Expected" }) {
  const [search, setSearch]             = useState('');
  const [regionFilter, setRegionFilter] = useState('All');
  const [sortField, setSortField]       = useState('');
  const [sortDir, setSortDir]           = useState('asc');
  const [page, setPage]                 = useState(1);
  const [expanded, setExpanded]         = useState({});
  const PER_PAGE = 10;

  const regions = useMemo(() => ['All', ...new Set(projects.map((p) => p.region.code))], [projects]);

  function handleSort(field) {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
    setPage(1);
  }

  function toggleExpand(id) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const enrichedRows = useMemo(() =>
    projects.map((p) => ({
      ...p,
      _appliedMw:     p.phases.reduce((s, ph) => s + (ph.capacityAppliedMw  ?? 0), 0),
      _approvedMw:    p.phases.reduce((s, ph) => s + (ph.ftcCompletedMw     ?? 0), 0),
      _ftcPendingMw:  p.phases.reduce((s, ph) => s + (ph.capacityUnderFtcMw ?? 0), 0),
      _tocIssuedMw:   p.phases.reduce((s, ph) => s + (ph.tocIssuedMw        ?? 0), 0),
      _tocPendingMw:  p.phases.reduce((s, ph) => s + (ph.capacityUnderTocMw ?? 0), 0),
      _codDeclaredMw: p.phases.reduce((s, ph) => s + (ph.codDeclaredMw      ?? 0), 0),
      _codPendingMw:  p.phases.reduce((s, ph) => s + codPendingFromPhase(ph), 0),
      _expectedMw:    p.phases.reduce((s, ph) => s + (ph.expectedApr26Mw    ?? 0), 0),
      _contd4Cap:     p.contd4?.capacityApr26Mw ?? p.totalCapacityMw,
      _sources:       [...new Set(p.phases.map((ph) => ph.sourceType))],
      _eventCount:    p.phases.reduce((s, ph) =>
        s + (ph.ftcEvents?.length ?? 0) + (ph.tocEvents?.length ?? 0) + (ph.codEvents?.length ?? 0), 0),
      _isOverdue:     p.phases.some(ph =>
        ph.proposedFtcDate && !ph.ftcCompletedMw && new Date(ph.proposedFtcDate) < new Date()
      ),
    })),
  [projects]);

  const filtered = useMemo(() => {
    let rows = [...enrichedRows];
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
    return sortRows(rows, sortField, sortDir);
  }, [enrichedRows, search, regionFilter, sortField, sortDir]);

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
            placeholder="Search station, developer, pooling station…"
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
        <table className="w-full text-sm border-collapse">
          <thead className="bg-muted/30 border-b">
            {/* Group header row */}
            <tr className="border-b border-border/40">
              <th colSpan={5} className="px-3 py-1.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-widest border-r border-border/40">
                Project
              </th>
              <th colSpan={3} className="px-3 py-1.5 text-center text-[10px] font-semibold uppercase tracking-widest border-r border-border/40 bg-blue-50/60 text-blue-700">
                FTC
              </th>
              <th colSpan={2} className="px-3 py-1.5 text-center text-[10px] font-semibold uppercase tracking-widest border-r border-border/40 bg-violet-50/60 text-violet-700">
                TOC
              </th>
              <th colSpan={2} className="px-3 py-1.5 text-center text-[10px] font-semibold uppercase tracking-widest border-r border-border/40 bg-emerald-50/60 text-emerald-700">
                COD
              </th>
              <th className="px-3 py-1.5 text-center text-[10px] font-semibold uppercase tracking-widest text-amber-700 bg-amber-50/60 border-r border-border/40" />
              {/* Remarks group */}
              <th className="px-3 py-1.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-widest border-r border-border/40">
                Remarks
              </th>
              <th className="w-[40px]" />
            </tr>
            {/* Column labels */}
            <tr>
              <Th label="#"                  className="w-[44px]" />
              <SortableTh label="Station"    field="name"      className="min-w-[180px]" {...sp} />
              <SortableTh label="Region"     field="region"    className="w-[68px]"      {...sp} />
              <SortableTh label="Total (MW)" field="totalCap"  className="w-[80px]"      {...sp} />
              <ThPink label="CONTD-4 (MW)"   className="w-[80px] border-r border-border/40" />
              <SortableTh label="Applied"    field="applied"    className="w-[75px] bg-blue-50/30"  {...sp} />
              <SortableTh label="Approved"   field="approved"   className="w-[75px] bg-blue-50/30"  {...sp} />
              <SortableTh label="Pending"    field="ftcPending" className="w-[75px] bg-blue-50/30 border-r border-border/40" {...sp} />
              <Th label="Issued"             className="w-[75px] bg-violet-50/30" />
              <Th label="Pending"            className="w-[75px] bg-violet-50/30 border-r border-border/40" />
              <SortableTh label="Done"       field="codDeclared" className="w-[75px] bg-emerald-50/30" {...sp} />
              <Th label="Pending"            className="w-[75px] bg-emerald-50/30 border-r border-border/40" />
              <Th label={refMonthLabel}      className="w-[80px] bg-amber-50/30 border-r border-border/40" />
              <Th label="History"            className="min-w-[260px]" />
              <Th label=""                   className="w-[40px]" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={15} className="px-4 py-12 text-center text-muted-foreground text-sm">
                  No cleared projects found.
                </td>
              </tr>
            ) : (
              paginated.flatMap((p, i) => {
                const isHybrid   = p.plantType.isHybrid;
                const hasPhases  = p.phases.length > 0;
                const isExpanded = !!expanded[p.id];
                const subRows    = isHybrid && hasPhases ? aggregateBySource(p.phases) : [];

                const numCell = (val, cls = '') => (
                  <td className={`px-2 py-3 font-mono text-xs tabular-nums text-right ${cls}`}>
                    {hasPhases ? (val > 0 ? mw(val) : <span className="text-muted-foreground/40">—</span>) : <span className="text-muted-foreground/40">—</span>}
                  </td>
                );

                const mainRow = (
                  <tr
                    key={p.id}
                    onClick={() => onView?.(p)}
                    className={`hover:bg-muted/20 transition-colors cursor-pointer ${p._isOverdue ? 'bg-red-50/30' : ''}`}
                  >
                    <td className="px-3 py-3 text-xs text-muted-foreground tabular-nums">{offset + i + 1}</td>
                    <td className="px-3 py-2.5 min-w-[180px]">
                      <div className="font-medium text-foreground truncate max-w-[240px]" title={p.name}>{p.name}</div>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className="text-[10px] font-medium text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded border border-border/50 whitespace-nowrap">
                          {p.plantType.label}
                        </span>
                        {p.poolingStation?.name && (
                          <span className="text-[10px] text-muted-foreground truncate max-w-[140px]" title={p.poolingStation.name}>
                            {p.poolingStation.name}
                          </span>
                        )}
                        {p._isOverdue && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-red-600">
                            <AlertCircle className="size-2.5" /> Overdue
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                        {p.region.code}
                      </span>
                    </td>
                    <td className="px-2 py-3 font-mono text-xs tabular-nums text-right">{mw(p.totalCapacityMw)}</td>
                    <td className="px-2 py-3 font-mono text-xs tabular-nums text-right bg-pink-50/40 border-r border-border/30">{mw(p._contd4Cap)}</td>
                    {/* FTC */}
                    <td className="px-2 py-3 font-mono text-xs tabular-nums text-right bg-blue-50/20">
                      {hasPhases ? mw(p._appliedMw) : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className={`px-2 py-3 font-mono text-xs tabular-nums text-right bg-blue-50/20 ${p._approvedMw > 0 ? 'text-blue-700' : ''}`}>
                      {hasPhases ? (p._approvedMw > 0 ? mw(p._approvedMw) : <span className="text-muted-foreground/40">—</span>) : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-2 py-3 font-mono text-xs tabular-nums text-right bg-blue-50/20 border-r border-border/30">
                      {hasPhases && p._ftcPendingMw > 0 ? <span className="text-blue-500">{mw(p._ftcPendingMw)}</span> : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    {/* TOC */}
                    {numCell(p._tocIssuedMw, 'bg-violet-50/20')}
                    <td className="px-2 py-3 font-mono text-xs tabular-nums text-right bg-violet-50/20 border-r border-border/30">
                      {hasPhases && p._tocPendingMw > 0 ? <span className="text-amber-600">{mw(p._tocPendingMw)}</span> : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    {/* COD */}
                    <td className={`px-2 py-3 font-mono text-xs tabular-nums text-right bg-emerald-50/20 ${p._codDeclaredMw > 0 ? 'text-emerald-700' : ''}`}>
                      {hasPhases ? (p._codDeclaredMw > 0 ? mw(p._codDeclaredMw) : <span className="text-muted-foreground/40">—</span>) : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-2 py-3 font-mono text-xs tabular-nums text-right bg-emerald-50/20 border-r border-border/30">
                      {hasPhases && p._codPendingMw > 0 ? <span className="text-orange-600">{mw(p._codPendingMw)}</span> : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    {/* Expected */}
                    <td className="px-2 py-3 font-mono text-xs tabular-nums text-right bg-amber-50/20 border-r border-border/30">
                      {hasPhases && p._expectedMw > 0 ? <span className="text-amber-700 font-semibold">{mw(p._expectedMw)}</span> : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    {/* Remarks — per-phase dated history, same pattern as the CONTD-4 list */}
                    <td
                      className="px-3 py-2 text-xs text-muted-foreground align-top border-r border-border/30"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {(() => {
                        const entries = (p.phases ?? []).flatMap((ph) => {
                          const items = [];
                          if (ph.delayRemarks?.trim()) {
                            items.push({
                              date: ph.updatedAt ? new Date(ph.updatedAt) : null,
                              text: ph.delayRemarks,
                              source: ph.sourceType,
                              kind: 'Delay',
                            });
                          }
                          if (ph.otherRemarks?.trim()) {
                            items.push({
                              date: ph.updatedAt ? new Date(ph.updatedAt) : null,
                              text: ph.otherRemarks,
                              source: ph.sourceType,
                              kind: 'Note',
                            });
                          }
                          return items;
                        });
                        entries.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
                        if (entries.length === 0) return <span className="text-muted-foreground/60">—</span>;
                        return (
                          <div
                            className="space-y-1 max-w-[300px]"
                            title={entries
                              .map((r) => `${r.date ? r.date.toISOString().slice(0,10) : ''} [${r.source} · ${r.kind}]: ${r.text}`)
                              .join('\n')}
                          >
                            {entries.slice(0, 3).map((r, idx) => (
                              <div key={idx} className="leading-snug">
                                {r.date && (
                                  <span className="inline-block mr-1.5 text-[9px] font-mono font-semibold text-slate-500 tabular-nums">
                                    {r.date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
                                  </span>
                                )}
                                <span className="inline-block mr-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                                  {r.source}
                                </span>
                                <span className={`line-clamp-2 ${r.kind === 'Delay' ? 'text-rose-700' : 'text-slate-700'}`}>
                                  {r.text}
                                </span>
                              </div>
                            ))}
                            {entries.length > 3 && (
                              <p className="text-[10px] text-slate-400 italic">+ {entries.length - 3} more — open project for full history</p>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-2 py-3">
                      {hasPhases && (isHybrid || p._eventCount > 0) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleExpand(p.id); }}
                          className="size-6 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          title={isExpanded ? 'Collapse details' : (isHybrid ? `Show source breakup + ${p._eventCount} dated events` : `Show ${p._eventCount} dated events`)}
                        >
                          {isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                        </button>
                      )}
                    </td>
                  </tr>
                );

                // Per-event detail panel — one row spanning all columns, listing
                // every FTC / TOC / COD event for every phase in date order.
                const eventDetailRow = isExpanded && p._eventCount > 0 ? (
                  <tr key={`${p.id}-events`} className="bg-slate-50/60 border-l-2 border-primary/40">
                    <td />
                    <td colSpan={14} className="px-4 py-3">
                      <EventTimeline phases={p.phases} />
                    </td>
                  </tr>
                ) : null;
                const expandedRows = (isExpanded && subRows.length > 0)
                  ? subRows.map((sr) => (
                      <tr key={`${p.id}-${sr.sourceType}`} className="bg-muted/10 border-l-2 border-primary/30">
                        <td />
                        <td className="px-3 py-2 pl-8">
                          <SourceBadge source={sr.sourceType} />
                        </td>
                        <td /><td />
                        <td className="bg-pink-50/20 border-r border-border/30" />
                        <td className="px-2 py-2 font-mono text-xs tabular-nums text-right text-muted-foreground bg-blue-50/10">{mw(sr.applied)}</td>
                        <td className="px-2 py-2 font-mono text-xs tabular-nums text-right text-blue-600 bg-blue-50/10">{mw(sr.ftcApproved)}</td>
                        <td className="px-2 py-2 font-mono text-xs tabular-nums text-right text-blue-500 bg-blue-50/10 border-r border-border/30">{sr.ftcPending > 0 ? mw(sr.ftcPending) : '—'}</td>
                        <td className="px-2 py-2 font-mono text-xs tabular-nums text-right text-violet-600 bg-violet-50/10">{mw(sr.tocIssued)}</td>
                        <td className="px-2 py-2 font-mono text-xs tabular-nums text-right text-amber-600 bg-violet-50/10 border-r border-border/30">{sr.tocPending > 0 ? mw(sr.tocPending) : '—'}</td>
                        <td className="px-2 py-2 font-mono text-xs tabular-nums text-right text-emerald-600 bg-emerald-50/10">{mw(sr.codDeclared)}</td>
                        <td className="px-2 py-2 font-mono text-xs tabular-nums text-right text-orange-600 bg-emerald-50/10 border-r border-border/30">{sr.codPending > 0 ? mw(sr.codPending) : '—'}</td>
                        <td className="px-2 py-2 font-mono text-xs tabular-nums text-right text-amber-700 bg-amber-50/10 border-r border-border/30">{sr.expected > 0 ? mw(sr.expected) : '—'}</td>
                        <td />  {/* Remarks column placeholder for expanded sub-row */}
                        <td />
                      </tr>
                    ))
                  : [];

                return [mainRow, ...(eventDetailRow ? [eventDetailRow] : []), ...expandedRows];
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-muted/10">
        <span className="text-xs text-muted-foreground">
          {filtered.length === 0
            ? '0 records'
            : `${(page - 1) * PER_PAGE + 1}–${Math.min(page * PER_PAGE, filtered.length)} of ${filtered.length} records`}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="size-7 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          {(() => {
            const pages = [];
            for (let i = Math.max(1, page - 1); i <= Math.min(totalPages, page + 1); i++) pages.push(i);
            if (pages[0] > 2) pages.unshift('…');
            if (pages[0] > 1) pages.unshift(1);
            if (pages[pages.length - 1] < totalPages - 1) pages.push('…');
            if (pages[pages.length - 1] < totalPages) pages.push(totalPages);
            return pages.map((pg, idx) =>
              typeof pg === 'string'
                ? <span key={`e${idx}`} className="size-7 flex items-center justify-center text-xs text-muted-foreground">…</span>
                : <button key={pg} onClick={() => setPage(pg)}
                    className={`size-7 rounded-md border text-xs font-medium transition-colors ${pg === page ? 'border-primary bg-primary text-white' : 'border-border hover:bg-accent text-foreground'}`}>
                    {pg}
                  </button>
            );
          })()}
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || totalPages === 0}
            className="size-7 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
