'use client';

import { useState, useMemo } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useSettings } from '@/providers/settings-provider';

function fmtRefMonthLabel(ym) {
  if (!ym) return 'Target Cap (MW)';
  try {
    const d = new Date(`${ym}-01`);
    const month = d.toLocaleString('en-US', { month: 'short' });
    const year  = String(d.getFullYear()).slice(2);
    return `Cap. ${month}'${year} (MW)`;
  } catch { return 'Target Cap (MW)'; }
}

const STATUS_COLORS = {
  PENDING:  'bg-amber-50 text-amber-700 border-amber-200',
  RECEIVED: 'bg-blue-50 text-blue-700 border-blue-200',
  CLEARED:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
};

function fmt(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function SortIcon({ col, sortCol, sortDir }) {
  if (sortCol !== col) return <ChevronsUpDown className="size-3.5 text-muted-foreground/50" />;
  return sortDir === 'asc'
    ? <ChevronUp className="size-3.5 text-foreground" />
    : <ChevronDown className="size-3.5 text-foreground" />;
}

export function GenerationTable({ projects, userRole, onView }) {
  const { settings } = useSettings();
  const targetCapLabel = fmtRefMonthLabel(settings.referenceMonth);
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [sortCol, setSortCol] = useState('createdAt');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const PER_PAGE = 10;

  const regions = useMemo(() => ['All', ...new Set(projects.map((p) => p.region.code))], [projects]);
  const types   = useMemo(() => ['All', ...new Set(projects.map((p) => p.plantType.label))], [projects]);

  const filtered = useMemo(() => {
    let rows = [...projects];
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.region.code.toLowerCase().includes(q) ||
          (p.poolingStation?.name?.toLowerCase().includes(q) ?? false)
      );
    }
    if (regionFilter !== 'All') rows = rows.filter((p) => p.region.code === regionFilter);
    if (typeFilter  !== 'All') rows = rows.filter((p) => p.plantType.label === typeFilter);
    rows.sort((a, b) => {
      let va = a[sortCol], vb = b[sortCol];
      if (sortCol === 'totalCapacityMw') { va = Number(va); vb = Number(vb); }
      if (sortCol === 'region')          { va = a.region.code; vb = b.region.code; }
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return rows;
  }, [projects, search, regionFilter, typeFilter, sortCol, sortDir]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paginated  = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const offset     = (page - 1) * PER_PAGE;

  function toggleSort(col) {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('asc'); }
    setPage(1);
  }

  function Th({ col, label, className = '' }) {
    return (
      <th
        className={`px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer select-none hover:bg-muted/50 transition-colors whitespace-nowrap ${className}`}
        onClick={() => toggleSort(col)}
      >
        <div className="flex items-center gap-1">
          {label}
          <SortIcon col={col} sortCol={sortCol} sortDir={sortDir} />
        </div>
      </th>
    );
  }

  function PlainTh({ label, className = '' }) {
    return (
      <th className={`px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap ${className}`}>
        {label}
      </th>
    );
  }

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden flex flex-col min-h-0 flex-1">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 p-4 border-b bg-muted/20 shrink-0">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            className="pl-9 h-9"
            placeholder="Search projects..."
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
        <span className="text-sm text-muted-foreground self-center">
          {filtered.length} project{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 border-b">
            <tr>
              <PlainTh label="Sr. No"         className="w-[52px]" />
              <Th col="name"            label="Generating Station"  className="min-w-[200px]" />
              <Th col="region"          label="Region"               className="w-[80px]" />
              <Th col="totalCapacityMw" label="Capacity (MW)"        className="w-[100px]" />
              <PlainTh label="App. Date"       className="w-[105px]" />
              <PlainTh label="Proposed FTC"    className="w-[105px]" />
              <PlainTh label={targetCapLabel}  className="w-[110px]" />
              <PlainTh label="CONTD-4 Status"  className="w-[120px]" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground text-sm">
                  No projects found.
                </td>
              </tr>
            ) : (
              paginated.map((p, i) => (
                <tr
                  key={p.id}
                  onClick={() => onView?.(p)}
                  className="hover:bg-muted/30 transition-colors cursor-pointer"
                >
                  <td className="px-3 py-3 text-xs text-muted-foreground tabular-nums">{offset + i + 1}</td>
                  <td className="px-3 py-2.5 min-w-[200px]">
                    <div className="font-medium text-foreground truncate max-w-[260px]" title={p.name}>{p.name}</div>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="text-[10px] font-medium text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded border border-border/50 whitespace-nowrap">
                        {p.plantType.label}
                      </span>
                      {p.poolingStation?.name && (
                        <span className="text-[10px] text-muted-foreground truncate max-w-[160px]" title={p.poolingStation.name}>
                          {p.poolingStation.name}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                      {p.region.code}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-mono text-sm tabular-nums">{Number(p.totalCapacityMw).toFixed(1)}</td>
                  <td className="px-3 py-3 text-xs whitespace-nowrap">{fmt(p.contd4?.applicationDate)}</td>
                  <td className="px-3 py-3 text-xs whitespace-nowrap">{fmt(p.contd4?.proposedFtcDate)}</td>
                  <td className="px-3 py-3 font-mono text-sm tabular-nums">
                    {p.contd4?.capacityApr26Mw != null ? Number(p.contd4.capacityApr26Mw).toFixed(1) : '—'}
                  </td>
                  <td className="px-3 py-3">
                    {p.contd4 ? (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${STATUS_COLORS[p.contd4.status]}`}>
                        {p.contd4.status}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/10 text-sm text-muted-foreground">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-muted transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-muted transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
