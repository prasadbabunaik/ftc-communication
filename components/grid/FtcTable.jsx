'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import {
  Search, ChevronsUpDown, ChevronUp, ChevronDown,
  ChevronLeft, ChevronRight, AlertCircle,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { contd4CapacityOf } from '@/lib/grid-computations';

function mw(val) {
  if (val == null) return '—';
  return Number(val).toFixed(1);
}

// Roll every hybrid sub-type (Hybrid (Wind+Solar), Hybrid (Solar+BESS) …) up
// into a single "Hybrid" option in the Plant Type filter — same behaviour as
// the CONTD-4 page; users filter "all hybrids" rather than each combination.
const displayType = (label) => (label?.toLowerCase().startsWith('hybrid') ? 'Hybrid' : label);

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

// Pending columns are derived as funnel GAPS (clamped ≥ 0) from the date-gated
// milestone totals — identical to the dashboard's computePipelineMatrix — so the
// FTC tracker and the dashboard always reconcile:
//   FTC Pending = Applied − FTC Approved
//   TOC Pending = FTC Approved − TOC Issued
//   COD Pending = TOC Issued − COD Declared
// The milestone inputs (ftcCompletedMw / tocIssuedMw / codDeclaredMw) are
// already date-gated server-side (ftc/page.jsx via milestoneAsOf), so a
// future-dated event no longer inflates "approved/issued/done".
const r3 = (x) => Math.round(x * 1000) / 1000;

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
    r.tocIssued   += ph.tocIssuedMw        ?? 0;
    r.codDeclared += ph.codDeclaredMw      ?? 0;
    r.expected    += ph.expectedApr26Mw    ?? 0;
  }
  for (const r of Object.values(map)) {
    r.ftcPending = Math.max(0, r3(r.applied     - r.ftcApproved));
    r.tocPending = Math.max(0, r3(r.ftcApproved - r.tocIssued));
    r.codPending = Math.max(0, r3(r.tocIssued   - r.codDeclared));
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

// Commissioning status — Commissioned (COD declared == total capacity, or a
// manual override) vs Under Process. Mirrors the dropdown filter values.
// `manual` flags a Commissioned status that came from the operator override
// rather than COD reaching total, shown with a trailing "·M" marker.
function StatusBadge({ status, manual = false }) {
  const commissioned = status === 'Commissioned';
  return (
    <span
      title={manual ? 'Manually marked Commissioned (COD below total capacity)' : undefined}
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border whitespace-nowrap ${
        commissioned
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-amber-50 text-amber-700 border-amber-200'
      }`}
    >
      {status}
    </span>
  );
}

export function FtcTable({ projects, userRole, onView, refMonthLabel = "Expected", onVisibleChange, highlightId = null, onHighlightDone }) {
  const [search, setSearch]             = useState('');
  const [regionFilter, setRegionFilter] = useState('All');
  const [typeFilter, setTypeFilter]     = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [sortField, setSortField]       = useState('');
  const [sortDir, setSortDir]           = useState('asc');
  const [page, setPage]                 = useState(1);
  const [expanded, setExpanded]         = useState({});
  const PER_PAGE = 10;

  const regions = useMemo(() => ['All', ...new Set(projects.map((p) => p.region.code))], [projects]);
  const types   = useMemo(() => ['All', ...new Set(projects.map((p) => displayType(p.plantType.label)))], [projects]);

  function handleSort(field) {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
    setPage(1);
  }

  function toggleExpand(id) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const enrichedRows = useMemo(() =>
    projects.map((p) => {
      // Milestone totals (date-gated server-side via milestoneAsOf).
      const appliedMw     = p.phases.reduce((s, ph) => s + (ph.capacityAppliedMw ?? 0), 0);
      const approvedMw    = p.phases.reduce((s, ph) => s + (ph.ftcCompletedMw    ?? 0), 0);
      const tocIssuedMw   = p.phases.reduce((s, ph) => s + (ph.tocIssuedMw       ?? 0), 0);
      const codDeclaredMw = p.phases.reduce((s, ph) => s + (ph.codDeclaredMw     ?? 0), 0);
      const totalCap      = Number(p.totalCapacityMw ?? 0);
      // Commissioned once the declared COD capacity reaches the project's total
      // capacity (small epsilon for float / rounding), OR when an operator has
      // manually marked it Commissioned. Anything else is still Under Process.
      const codComplete   = totalCap > 0 && codDeclaredMw >= totalCap - 0.01;
      const status        = (codComplete || p.manuallyCommissioned) ? 'Commissioned' : 'Under Process';
      // True only when the Commissioned status comes from the manual override
      // rather than COD reaching total — drives the "manual" marker on the badge.
      const manualCommission = !!p.manuallyCommissioned && !codComplete;
      return {
        ...p,
        _appliedMw:     appliedMw,
        _approvedMw:    approvedMw,
        // Pending = funnel gaps (clamped ≥ 0), same derivation as the dashboard
        // pipeline matrix — so the tracker and dashboard always reconcile.
        _ftcPendingMw:  Math.max(0, r3(appliedMw   - approvedMw)),
        _tocIssuedMw:   tocIssuedMw,
        _tocPendingMw:  Math.max(0, r3(approvedMw  - tocIssuedMw)),
        _codDeclaredMw: codDeclaredMw,
        _codPendingMw:  Math.max(0, r3(tocIssuedMw - codDeclaredMw)),
        _expectedMw:    p.phases.reduce((s, ph) => s + (ph.expectedApr26Mw    ?? 0), 0),
        // CONTD-4 issued capacity — null (shown as "—") when no CONTD-4 record is
        // linked; matches the project modal and the dashboard pipeline, which read
        // the SAME helper so the CONTD-4 (MW) columns can never disagree.
        _contd4Cap:     contd4CapacityOf(p),
        _sources:       [...new Set(p.phases.map((ph) => ph.sourceType))],
        _status:        status,
        _manualCommission: manualCommission,
        _isOverdue:     p.phases.some(ph =>
          ph.proposedFtcDate && !ph.ftcCompletedMw && new Date(ph.proposedFtcDate) < new Date()
        ),
      };
    }),
  [projects]);

  const filtered = useMemo(() => {
    let rows = [...enrichedRows];
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
    if (typeFilter !== 'All') {
      // "Hybrid" matches every hybrid sub-type; other types match exactly.
      rows = typeFilter === 'Hybrid'
        ? rows.filter((p) => p.plantType.label?.toLowerCase().startsWith('hybrid'))
        : rows.filter((p) => p.plantType.label === typeFilter);
    }
    if (statusFilter !== 'All') rows = rows.filter((p) => p._status === statusFilter);
    return sortRows(rows, sortField, sortDir);
  }, [enrichedRows, search, regionFilter, typeFilter, statusFilter, sortField, sortDir]);

  // Report the current filtered/sorted rows up so exports (PDF / Excel) match
  // exactly what the user is looking at — not the unfiltered project list.
  useEffect(() => {
    onVisibleChange?.(filtered);
  }, [filtered, onVisibleChange]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paginated  = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const offset     = (page - 1) * PER_PAGE;

  // Deep-link highlight (from the Change Log): clear filters so the project is
  // in the list, jump to its page, scroll it into view and flash it briefly.
  useEffect(() => {
    if (!highlightId) return;
    setSearch(''); setRegionFilter('All'); setTypeFilter('All'); setStatusFilter('All');
    const full = sortRows([...enrichedRows], sortField, sortDir);
    const idx = full.findIndex((p) => p.id === highlightId);
    if (idx >= 0) setPage(Math.floor(idx / PER_PAGE) + 1);
    const scroll = setTimeout(() => {
      document.querySelector(`[data-pid="${highlightId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    const clear = setTimeout(() => onHighlightDone?.(), 4000);
    return () => { clearTimeout(scroll); clearTimeout(clear); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightId]);

  const sp = { sortField, sortDir, onSort: handleSort };

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden flex flex-col min-h-0 flex-1">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 p-4 border-b bg-muted/20 shrink-0">
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
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          title="Filter by plant type"
        >
          {types.map((t) => <option key={t} value={t}>{t === 'All' ? 'All Types' : t}</option>)}
        </select>
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          title="Filter by commissioning status"
        >
          <option value="All">All statuses</option>
          <option value="Under Process">Under Process</option>
          <option value="Commissioned">Commissioned</option>
        </select>
        <span className="text-sm text-muted-foreground self-center">
          {filtered.length} project{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-auto flex-1 min-h-0">
        {/* table-fixed + colgroup: column widths are fixed by the colgroup (the
            grouped colSpan header row can't set per-column widths), so columns
            stay aligned no matter how rows are sorted / paged. */}
        <table className="w-full text-sm border-collapse table-fixed min-w-[1440px]">
          <colgroup>
            <col className="w-[44px]" />{/* # */}
            <col className="w-[200px]" />{/* Station */}
            <col className="w-[68px]" />{/* Region */}
            <col className="w-[86px]" />{/* Total */}
            <col className="w-[98px]" />{/* CONTD-4 */}
            <col className="w-[78px]" />{/* Applied */}
            <col className="w-[80px]" />{/* Approved */}
            <col className="w-[78px]" />{/* FTC Pending */}
            <col className="w-[75px]" />{/* TOC Issued */}
            <col className="w-[78px]" />{/* TOC Pending */}
            <col className="w-[75px]" />{/* COD Done */}
            <col className="w-[78px]" />{/* COD Pending */}
            <col className="w-[92px]" />{/* Expected */}
            <col className="w-[280px]" />{/* History */}
            <col className="w-[40px]" />{/* expand */}
          </colgroup>
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
                <td colSpan={15} className="px-4 py-12 text-center text-sm">
                  <p className="text-muted-foreground font-medium">
                    {search || regionFilter !== 'All' || typeFilter !== 'All' || statusFilter !== 'All'
                      ? 'No FTC-pipeline projects match your search / filters.'
                      : 'No projects in the FTC pipeline yet.'}
                  </p>
                  <p className="text-xs text-muted-foreground/80 mt-1.5 max-w-xl mx-auto">
                    This tracker lists only projects that have entered the FTC process. A newly created
                    project appears here once its first FTC / TOC / COD data is recorded — use{' '}
                    <span className="font-semibold text-foreground/70">Add Source / Component</span> (top right) to bring it in.
                  </p>
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
                    data-pid={p.id}
                    onClick={() => onView?.(p)}
                    className={`hover:bg-muted/20 transition-colors cursor-pointer ${
                      p.id === highlightId
                        ? 'ring-2 ring-inset ring-blue-400 bg-blue-100/70'
                        : p._isOverdue ? 'bg-red-50/30' : ''
                    }`}
                  >
                    <td className="px-3 py-3 text-xs text-muted-foreground tabular-nums">{offset + i + 1}</td>
                    <td className="px-3 py-2.5 min-w-[180px]">
                      <div className="font-medium text-foreground truncate max-w-[240px]" title={p.name}>{p.name}</div>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <StatusBadge status={p._status} manual={p._manualCommission} />
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
                      {hasPhases && isHybrid && (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleExpand(p.id); }}
                          className="size-6 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          title={isExpanded ? 'Collapse source breakdown' : 'Show source breakdown'}
                        >
                          {isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                        </button>
                      )}
                    </td>
                  </tr>
                );

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

                return [mainRow, ...expandedRows];
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
