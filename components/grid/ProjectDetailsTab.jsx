'use client';

import { useState } from 'react';
import { getProjectSource, SOURCE_ORDER } from '@/lib/grid-computations';

function fmt(v) {
  if (v == null || Number(v) === 0) return '—';
  const n = Number(v);
  const parts = n.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const dec = parts[1]?.replace(/0+$/, '');
  return dec ? `${parts[0]}.${dec}` : parts[0];
}

function fmtDate(v) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return '—'; }
}

const SOURCE_BADGE = {
  WIND:   'bg-sky-100 text-sky-800',
  SOLAR:  'bg-amber-100 text-amber-800',
  BESS:   'bg-violet-100 text-violet-800',
  HYBRID: 'bg-teal-100 text-teal-800',
  COAL:   'bg-stone-100 text-stone-700',
  HYDRO:  'bg-blue-100 text-blue-800',
  PSP:    'bg-emerald-100 text-emerald-800',
};
const REGION_BADGE = {
  NR:  'bg-indigo-100 text-indigo-700',
  WR:  'bg-orange-100 text-orange-700',
  SR:  'bg-pink-100 text-pink-700',
  ER:  'bg-cyan-100 text-cyan-700',
  NER: 'bg-lime-100 text-lime-700',
};

function MilestoneDot({ done }) {
  return (
    <span className={`inline-block size-2 rounded-full mr-1 ${done ? 'bg-emerald-500' : 'bg-slate-200'}`} />
  );
}

function ProjectTable({ projects, source }) {
  if (!projects.length) return null;
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-xs min-w-[900px]">
        <thead>
          <tr className="bg-slate-700 text-white text-[10px]">
            <th className="px-2 py-2 text-left font-bold whitespace-nowrap w-6">#</th>
            <th className="px-3 py-2 text-left font-bold whitespace-nowrap">Project</th>
            <th className="px-2 py-2 text-center font-bold whitespace-nowrap">Region</th>
            <th className="px-2 py-2 text-center font-bold whitespace-nowrap">Pooling Stn.</th>
            <th className="px-2 py-2 text-right font-bold whitespace-nowrap">Total MW</th>
            <th className="px-2 py-2 text-right font-bold whitespace-nowrap">Applied MW</th>
            <th className="px-2 py-2 text-right font-bold whitespace-nowrap">FTC OK</th>
            <th className="px-2 py-2 text-center font-bold whitespace-nowrap">FTC Date</th>
            <th className="px-2 py-2 text-right font-bold whitespace-nowrap">FTC Pend</th>
            <th className="px-2 py-2 text-right font-bold whitespace-nowrap">TOC OK</th>
            <th className="px-2 py-2 text-center font-bold whitespace-nowrap">TOC Date</th>
            <th className="px-2 py-2 text-right font-bold whitespace-nowrap">TOC Pend</th>
            <th className="px-2 py-2 text-right font-bold whitespace-nowrap">COD OK</th>
            <th className="px-2 py-2 text-center font-bold whitespace-nowrap">COD Date</th>
            <th className="px-2 py-2 text-right font-bold whitespace-nowrap">COD Pend</th>
            <th className="px-2 py-2 text-right font-bold whitespace-nowrap">Expected</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p, i) => {
            const ph = p.phases?.[0] ?? {};
            const codPend = Math.max(0, Number(ph.tocIssuedMw ?? 0) - Number(ph.codDeclaredMw ?? 0));
            return (
              <tr key={p.id ?? i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                <td className="px-2 py-1.5 text-slate-400 font-mono">{i + 1}</td>
                <td className="px-3 py-1.5 font-medium text-slate-800 max-w-[220px]">
                  <div className="truncate" title={p.name}>{p.name}</div>
                  {p.phases?.length > 1 && (
                    <div className="text-[9px] text-slate-400">{p.phases.length} phases</div>
                  )}
                </td>
                <td className="px-2 py-1.5 text-center">
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${REGION_BADGE[p.region?.code] ?? 'bg-slate-100'}`}>
                    {p.region?.code}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-center text-slate-600 text-[10px] max-w-[100px] truncate" title={p.poolingStation?.name}>
                  {p.poolingStation?.name ?? '—'}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">{fmt(p.totalCapacityMw)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{fmt(ph.capacityAppliedMw)}</td>
                <td className="px-2 py-1.5 text-right font-mono text-emerald-700">{fmt(ph.ftcCompletedMw)}</td>
                <td className="px-2 py-1.5 text-center text-slate-500">{fmtDate(ph.ftcCompletedDate)}</td>
                <td className="px-2 py-1.5 text-right font-mono text-amber-700">{fmt(ph.capacityUnderFtcMw)}</td>
                <td className="px-2 py-1.5 text-right font-mono text-emerald-700">{fmt(ph.tocIssuedMw)}</td>
                <td className="px-2 py-1.5 text-center text-slate-500">{fmtDate(ph.tocIssuedDate)}</td>
                <td className="px-2 py-1.5 text-right font-mono text-amber-700">{fmt(ph.capacityUnderTocMw)}</td>
                <td className="px-2 py-1.5 text-right font-mono text-emerald-700">{fmt(ph.codDeclaredMw)}</td>
                <td className="px-2 py-1.5 text-center text-slate-500">{fmtDate(ph.codDeclaredDate)}</td>
                <td className="px-2 py-1.5 text-right font-mono text-amber-700">{codPend > 0.01 ? fmt(codPend) : '—'}</td>
                <td className="px-2 py-1.5 text-right font-mono text-blue-700">{fmt(ph.expectedApr26Mw)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-slate-100 font-semibold border-t-2 border-slate-300">
            <td colSpan={4} className="px-3 py-1.5 text-xs text-slate-600">Total ({projects.length} projects)</td>
            <td className="px-2 py-1.5 text-right text-xs font-mono">{fmt(projects.reduce((s,p)=>s+Number(p.totalCapacityMw??0),0))}</td>
            <td className="px-2 py-1.5 text-right text-xs font-mono">{fmt(projects.reduce((s,p)=>s+Number(p.phases?.[0]?.capacityAppliedMw??0),0))}</td>
            <td className="px-2 py-1.5 text-right text-xs font-mono">{fmt(projects.reduce((s,p)=>s+Number(p.phases?.[0]?.ftcCompletedMw??0),0))}</td>
            <td />
            <td className="px-2 py-1.5 text-right text-xs font-mono">{fmt(projects.reduce((s,p)=>s+Number(p.phases?.[0]?.capacityUnderFtcMw??0),0))}</td>
            <td className="px-2 py-1.5 text-right text-xs font-mono">{fmt(projects.reduce((s,p)=>s+Number(p.phases?.[0]?.tocIssuedMw??0),0))}</td>
            <td />
            <td className="px-2 py-1.5 text-right text-xs font-mono">{fmt(projects.reduce((s,p)=>s+Number(p.phases?.[0]?.capacityUnderTocMw??0),0))}</td>
            <td className="px-2 py-1.5 text-right text-xs font-mono">{fmt(projects.reduce((s,p)=>s+Number(p.phases?.[0]?.codDeclaredMw??0),0))}</td>
            <td />
            <td className="px-2 py-1.5 text-right text-xs font-mono">
              {fmt(projects.reduce((s,p)=>s+Math.max(0,Number(p.phases?.[0]?.tocIssuedMw??0)-Number(p.phases?.[0]?.codDeclaredMw??0)),0))}
            </td>
            <td className="px-2 py-1.5 text-right text-xs font-mono">{fmt(projects.reduce((s,p)=>s+Number(p.phases?.[0]?.expectedApr26Mw??0),0))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function ProjectDetailsTab({ projects, refMonthLabel }) {
  const [activeSource, setActiveSource] = useState(SOURCE_ORDER[0]);

  // Group FTC-cleared projects by source
  const cleared = (projects ?? []).filter(p => p.contd4?.status === 'CLEARED');
  const bySource = {};
  for (const src of SOURCE_ORDER) bySource[src] = [];
  for (const p of cleared) {
    const src = getProjectSource(p);
    if (bySource[src]) bySource[src].push(p);
  }

  const availableSources = SOURCE_ORDER.filter(s => bySource[s].length > 0);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Project-wise FTC Pipeline Details</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Individual project rows for all CONTD-4 cleared projects, grouped by source type. Mirrors the Summary sheet project tables.</p>
      </div>

      {/* Source tabs */}
      <div className="flex flex-wrap gap-1">
        {availableSources.map(src => (
          <button
            key={src}
            onClick={() => setActiveSource(src)}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              activeSource === src
                ? (SOURCE_BADGE[src] ?? 'bg-slate-100 text-slate-700') + ' ring-2 ring-offset-1 ring-current'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            {src} <span className="ml-1 opacity-70">({bySource[src].length})</span>
          </button>
        ))}
      </div>

      {/* Table for active source */}
      {availableSources.includes(activeSource) ? (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-foreground">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold mr-2 ${SOURCE_BADGE[activeSource]}`}>{activeSource}</span>
              {bySource[activeSource].length} Projects
            </h3>
          </div>
          <ProjectTable projects={bySource[activeSource]} source={activeSource} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No data for selected source.</p>
      )}
    </div>
  );
}
