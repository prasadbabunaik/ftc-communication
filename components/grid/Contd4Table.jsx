'use client';

import { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

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

export function Contd4Table({ applications, userRole, onView }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [regionFilter, setRegionFilter] = useState('All');
  const [page, setPage] = useState(1);
  const PER_PAGE = 12;

  const regions  = useMemo(() => ['All', ...new Set(applications.map((a) => a.project.region.code))], [applications]);

  const filtered = useMemo(() => {
    let rows = [...applications];
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (a) =>
          a.project.name.toLowerCase().includes(q) ||
          (a.project.poolingStation?.name?.toLowerCase().includes(q) ?? false) ||
          (a.remarks?.toLowerCase().includes(q) ?? false)
      );
    }
    if (statusFilter !== 'All') rows = rows.filter((a) => a.status === statusFilter);
    if (regionFilter !== 'All') rows = rows.filter((a) => a.project.region.code === regionFilter);
    return rows;
  }, [applications, search, statusFilter, regionFilter]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paginated  = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 p-4 border-b bg-muted/20">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            className="pl-9 h-9"
            placeholder="Search by project or remarks..."
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
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
        >
          {['All', 'PENDING', 'RECEIVED', 'CLEARED', 'REJECTED'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <span className="text-sm text-muted-foreground self-center">{filtered.length} applications</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 border-b">
            <tr>
              {['Sr. No', 'Generating Station', 'Region', 'Capacity (MW)', 'Application Date', 'Proposed FTC', "Cap. Apr'26 (MW)", 'Status'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground text-sm">
                  No applications found.
                </td>
              </tr>
            ) : (
              paginated.map((a, i) => (
                <tr key={a.id} onClick={() => onView?.(a)} className="hover:bg-muted/30 transition-colors cursor-pointer">
                  <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">{(page - 1) * PER_PAGE + i + 1}</td>
                  <td className="px-4 py-2.5 min-w-[200px]">
                    <div className="font-medium text-foreground truncate max-w-[260px]" title={a.project.name}>{a.project.name}</div>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="text-[10px] font-medium text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded border border-border/50 whitespace-nowrap">
                        {a.project.plantType.label}
                      </span>
                      {a.project.poolingStation?.name && (
                        <span className="text-[10px] text-muted-foreground truncate max-w-[160px]" title={a.project.poolingStation.name}>
                          {a.project.poolingStation.name}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                      {a.project.region.code}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-sm">{Number(a.project.totalCapacityMw).toFixed(1)}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">{fmt(a.applicationDate)}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">{fmt(a.proposedFtcDate)}</td>
                  <td className="px-4 py-3 font-mono text-sm">{a.capacityApr26Mw ? Number(a.capacityApr26Mw).toFixed(1) : '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${STATUS_COLORS[a.status]}`}>
                      {a.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/10 text-sm text-muted-foreground">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-muted transition-colors">Previous</button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-muted transition-colors">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
