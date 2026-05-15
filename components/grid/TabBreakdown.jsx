'use client';

import { Fragment, useMemo, useState } from 'react';
import { ListTree, Search, X, ChevronRight } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { CONTD4_SOURCE_LABEL } from '@/lib/grid-computations';

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(v) {
  if (v == null) return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  if (n === 0) return '0';
  const p = n.toFixed(2).split('.');
  p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const d = p[1]?.replace(/0+$/, '');
  return d ? `${p[0]}.${d}` : p[0];
}

const REGION_BADGE = {
  NR:  'bg-indigo-100 text-indigo-700', WR: 'bg-orange-100 text-orange-700',
  SR:  'bg-pink-100 text-pink-700',     ER: 'bg-cyan-100 text-cyan-700',
  NER: 'bg-lime-100 text-lime-700',
};
const SOURCE_BADGE = {
  WIND:'bg-sky-100 text-sky-700', SOLAR:'bg-amber-100 text-amber-700',
  BESS:'bg-violet-100 text-violet-700', HYBRID:'bg-teal-100 text-teal-700',
  COAL:'bg-stone-100 text-stone-700', HYDRO:'bg-blue-100 text-blue-700',
  PSP: 'bg-emerald-100 text-emerald-700',
  HYBRID_WS:'bg-teal-100 text-teal-700', HYBRID_SB:'bg-teal-100 text-teal-700',
  HYBRID_WSB:'bg-teal-100 text-teal-700',
};

function Chip({ label, cls }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${cls ?? 'bg-slate-100 text-slate-700'}`}>
      {label}
    </span>
  );
}

// Classify a project's source like grid-computations.getProjectSource()
function projectSource(p) {
  if (p.plantType?.isHybrid) return 'HYBRID';
  if ((p.phases ?? []).length > 0) return p.phases[0].sourceType;
  const l = (p.plantType?.label ?? '').toUpperCase();
  if (l.includes('WIND'))                            return 'WIND';
  if (l.includes('SOLAR'))                           return 'SOLAR';
  if (l.includes('BESS') || l.includes('BATTERY'))   return 'BESS';
  if (l.includes('COAL') || l.includes('THERMAL'))   return 'COAL';
  if (l.includes('HYDRO'))                           return 'HYDRO';
  if (l.includes('PSP')  || l.includes('PUMP'))      return 'PSP';
  return 'OTHER';
}

function contd4StudySource(p) {
  return p.plantType?.isHybrid ? p.plantType.code : projectSource(p);
}

// ── Builders: one per tab — return [{ region, source, label, contributors: [...] }] ─

function buildPipelineGroups(projects) {
  const cleared = projects.filter(p => p.contd4?.status === 'CLEARED');
  const groups = {};
  for (const p of cleared) {
    const region = p.region.code;
    const source = projectSource(p);
    const key = `${region}|${source}`;
    if (!groups[key]) groups[key] = { region, source, contributors: [] };
    const ph = (p.phases ?? [])[0] ?? {};
    groups[key].contributors.push({
      id: p.id, name: p.name, plantType: p.plantType?.label, region,
      total:   Number(p.totalCapacityMw) || 0,
      contd4:  Number(p.contd4?.capacityApr26Mw) || 0,
      applied: Number(ph.capacityAppliedMw) || 0,
      ftc:     Number(ph.ftcCompletedMw) || 0,
      uftc:    Number(ph.capacityUnderFtcMw) || 0,
      toc:     Number(ph.tocIssuedMw) || 0,
      utoc:    Number(ph.capacityUnderTocMw) || 0,
      cod:     Number(ph.codDeclaredMw) || 0,
      pendcod: Number(ph.capacityPendingCodMw) || 0,
      exp:     Number(ph.expectedApr26Mw) || 0,
    });
  }
  return Object.values(groups).sort((a, b) =>
    (a.region.localeCompare(b.region) || a.source.localeCompare(b.source)),
  );
}

function buildContd4Groups(projects) {
  const active = projects.filter(p => p.contd4 && !['CLEARED','REJECTED'].includes(p.contd4.status));
  const groups = {};
  for (const p of active) {
    const region = p.region.code;
    const source = contd4StudySource(p);
    const key = `${region}|${source}`;
    if (!groups[key]) groups[key] = { region, source, contributors: [] };
    groups[key].contributors.push({
      id: p.id, name: p.name, plantType: p.plantType?.label, region,
      total:   Number(p.totalCapacityMw) || 0,
      capInMonth: Number(p.contd4?.capacityApr26Mw) || 0,
      month:   p.contd4?.capacityMonth || '—',
      status:  p.contd4?.status,
      appDate: p.contd4?.applicationDate ? new Date(p.contd4.applicationDate).toISOString().slice(0,10) : '—',
    });
  }
  return Object.values(groups).sort((a, b) =>
    (a.region.localeCompare(b.region) || a.source.localeCompare(b.source)),
  );
}

function buildHybridGroups(projects) {
  const hybrids = projects.filter(p => p.plantType?.isHybrid && p.contd4?.status === 'CLEARED');
  const groups = {};
  for (const p of hybrids) {
    const region = p.region.code;
    const ht     = p.plantType.label;
    const key = `${region}|${ht}`;
    if (!groups[key]) groups[key] = { region, source: ht, contributors: [] };
    for (const ph of (p.phases ?? [])) {
      groups[key].contributors.push({
        id: `${p.id}|${ph.sourceType}`, name: p.name, plantType: ht, region,
        component: ph.sourceType,
        total:   Number(p.totalCapacityMw) || 0,
        applied: Number(ph.capacityAppliedMw) || 0,
        ftc:     Number(ph.ftcCompletedMw) || 0,
        toc:     Number(ph.tocIssuedMw) || 0,
        cod:     Number(ph.codDeclaredMw) || 0,
        exp:     Number(ph.expectedApr26Mw) || 0,
      });
    }
  }
  return Object.values(groups).sort((a, b) =>
    (a.region.localeCompare(b.region) || a.source.localeCompare(b.source)),
  );
}

function buildTransmissionGroups(txElements) {
  const CAT_LABELS = {
    LINE_RE:'Line — RE Pocket', LINE_NONRE:'Line — Non-RE',
    ICT_RE: 'ICT — RE Pocket',  ICT_NONRE: 'ICT — Non-RE',
    GT: 'GT', ST: 'ST',
  };
  function cat(el) {
    if (el.elementType === 'LINE') return el.isRe ? 'LINE_RE' : 'LINE_NONRE';
    if (el.elementType === 'ICT')  return el.isRe ? 'ICT_RE'  : 'ICT_NONRE';
    return el.elementType;
  }
  const groups = {};
  for (const e of txElements) {
    const region = e.region.code;
    const c      = cat(e);
    const key = `${region}|${c}`;
    if (!groups[key]) groups[key] = { region, source: CAT_LABELS[c] ?? c, contributors: [] };
    groups[key].contributors.push({
      id: e.id, name: e.elementName, plantType: e.elementType, region,
      agency: e.agencyOwner, voltage: e.voltageRatingKv,
      cap:     Number(e.capacityMva) || 0,
      length:  Number(e.lineLengthKm) || 0,
      pendCap: Number(e.capacityApr26Mva) || 0,
      pendLen: Number(e.lineLengthApr26Km) || 0,
      pending: !!e.pendingFtc,
    });
  }
  return Object.values(groups).sort((a, b) =>
    (a.region.localeCompare(b.region) || a.source.localeCompare(b.source)),
  );
}

function buildMonthlyCodGroups(projects, fromMonth, toMonth) {
  const cleared = projects.filter(p => p.contd4?.status === 'CLEARED');
  const fromD = fromMonth ? new Date(fromMonth + '-01') : null;
  const toD   = toMonth   ? new Date(toMonth + '-01')   : null;
  const groups = {};
  for (const p of cleared) {
    for (const ph of (p.phases ?? [])) {
      const mw = Number(ph.codDeclaredMw) || 0;
      if (mw <= 0 || !ph.codDeclaredDate) continue;
      const d = new Date(ph.codDeclaredDate);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (fromD && d < fromD) continue;
      if (toD) {
        const lastOfTo = new Date(toD.getFullYear(), toD.getMonth() + 1, 0);
        if (d > lastOfTo) continue;
      }
      const key = `${ym}|${p.region.code}|${ph.sourceType}`;
      if (!groups[key]) groups[key] = { region: p.region.code, source: ph.sourceType, month: ym, contributors: [] };
      groups[key].contributors.push({
        id: `${p.id}|${ph.sourceType}|${ph.codDeclaredDate}`, name: p.name,
        region: p.region.code, plantType: p.plantType?.label,
        month: ym, codDate: ph.codDeclaredDate.slice(0, 10),
        cod: mw,
      });
    }
  }
  // Re-key so the group label shows month + region + source
  return Object.values(groups)
    .map(g => ({ ...g, source: `${g.month} · ${g.source}` }))
    .sort((a, b) =>
      (a.month?.localeCompare(b.month) || a.region.localeCompare(b.region) || a.source.localeCompare(b.source)),
    );
}

// ── Per-tab column definitions ────────────────────────────────────────────────

const COLUMNS = {
  pipeline: [
    { key: 'name',     label: 'Project',     align: 'left',  flex: 'flex-1 min-w-[200px]' },
    { key: 'plantType',label: 'Type',        align: 'left',  flex: 'min-w-[120px]' },
    { key: 'total',    label: 'Total',       align: 'right', flex: 'w-20', isNum: true },
    { key: 'applied',  label: 'Applied',     align: 'right', flex: 'w-20', isNum: true },
    { key: 'ftc',      label: 'FTC',         align: 'right', flex: 'w-20', isNum: true },
    { key: 'uftc',     label: '↳ U.FTC',     align: 'right', flex: 'w-20', isNum: true },
    { key: 'toc',      label: 'TOC',         align: 'right', flex: 'w-20', isNum: true },
    { key: 'utoc',     label: '↳ U.TOC',     align: 'right', flex: 'w-20', isNum: true },
    { key: 'cod',      label: 'COD',         align: 'right', flex: 'w-20', isNum: true },
    { key: 'exp',      label: 'Expected',    align: 'right', flex: 'w-20', isNum: true },
  ],
  contd4: [
    { key: 'name',     label: 'Project',         align: 'left',  flex: 'flex-1 min-w-[200px]' },
    { key: 'plantType',label: 'Type',            align: 'left',  flex: 'min-w-[120px]' },
    { key: 'status',   label: 'Status',          align: 'left',  flex: 'w-24' },
    { key: 'month',    label: 'Target Mo.',      align: 'left',  flex: 'w-24' },
    { key: 'appDate',  label: 'Applied',         align: 'left',  flex: 'w-28' },
    { key: 'total',    label: 'Total MW',        align: 'right', flex: 'w-24', isNum: true },
    { key: 'capInMonth', label: 'In Month MW',   align: 'right', flex: 'w-24', isNum: true },
  ],
  hybrid: [
    { key: 'name',     label: 'Project',     align: 'left',  flex: 'flex-1 min-w-[200px]' },
    { key: 'plantType',label: 'Hybrid Type', align: 'left',  flex: 'min-w-[160px]' },
    { key: 'component',label: 'Component',   align: 'left',  flex: 'w-20' },
    { key: 'total',    label: 'Total',       align: 'right', flex: 'w-20', isNum: true },
    { key: 'applied',  label: 'Applied',     align: 'right', flex: 'w-20', isNum: true },
    { key: 'ftc',      label: 'FTC',         align: 'right', flex: 'w-20', isNum: true },
    { key: 'toc',      label: 'TOC',         align: 'right', flex: 'w-20', isNum: true },
    { key: 'cod',      label: 'COD',         align: 'right', flex: 'w-20', isNum: true },
    { key: 'exp',      label: 'Expected',    align: 'right', flex: 'w-20', isNum: true },
  ],
  transmission: [
    { key: 'name',     label: 'Element',     align: 'left',  flex: 'flex-1 min-w-[220px]' },
    { key: 'agency',   label: 'Agency',      align: 'left',  flex: 'min-w-[140px]' },
    { key: 'plantType',label: 'Type',        align: 'left',  flex: 'w-16' },
    { key: 'voltage',  label: 'kV',          align: 'right', flex: 'w-14', isNum: true },
    { key: 'cap',      label: 'MVA',         align: 'right', flex: 'w-20', isNum: true },
    { key: 'length',   label: 'km',          align: 'right', flex: 'w-20', isNum: true },
    { key: 'pendCap',  label: 'Pend MVA',    align: 'right', flex: 'w-24', isNum: true },
    { key: 'pendLen',  label: 'Pend km',     align: 'right', flex: 'w-24', isNum: true },
    { key: 'pending',  label: 'Pend FTC',    align: 'left',  flex: 'w-16' },
  ],
  monthlycod: [
    { key: 'name',     label: 'Project',     align: 'left',  flex: 'flex-1 min-w-[220px]' },
    { key: 'plantType',label: 'Plant Type',  align: 'left',  flex: 'min-w-[140px]' },
    { key: 'codDate',  label: 'COD Date',    align: 'left',  flex: 'w-28' },
    { key: 'cod',      label: 'COD MW',      align: 'right', flex: 'w-24', isNum: true },
  ],
};

const TAB_META = {
  pipeline:     { title: 'FTC Pipeline — Contributors',     subtitle: 'CLEARED projects grouped by Region × Source. Each row contributes to its group totals in the Pipeline tab.' },
  contd4:       { title: 'CONTD-4 Study — Contributors',    subtitle: 'Active (PENDING / RECEIVED) applications grouped by Region × Source.' },
  hybrid:       { title: 'Hybrid Breakdown — Contributors', subtitle: 'CLEARED hybrid projects, split by their constituent source components.' },
  sourcewise:   { title: 'Source-wise Pipeline — Contributors', subtitle: 'Same CLEARED projects as FTC Pipeline, grouped by Source × Region.' },
  transmission: { title: 'Transmission — Contributors',     subtitle: 'Transmission elements grouped by Region × Element Type.' },
  monthlycod:   { title: 'Monthly COD — Contributors',      subtitle: 'Each row is a commissioning phase that declared COD inside the chosen month range.' },
};

// ── Component ────────────────────────────────────────────────────────────────

export function TabBreakdown({ open, onOpenChange, activeTab, projects, txElements, fromMonth, toMonth }) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState({});

  const tabKey = activeTab === 'sourcewise' ? 'pipeline' : activeTab;
  const meta   = TAB_META[activeTab] ?? TAB_META.pipeline;
  const cols   = COLUMNS[tabKey === 'sourcewise' ? 'pipeline' : tabKey] ?? COLUMNS.pipeline;

  const groups = useMemo(() => {
    if (!open) return [];
    if (activeTab === 'pipeline' || activeTab === 'sourcewise') return buildPipelineGroups(projects);
    if (activeTab === 'contd4')       return buildContd4Groups(projects);
    if (activeTab === 'hybrid')       return buildHybridGroups(projects);
    if (activeTab === 'transmission') return buildTransmissionGroups(txElements ?? []);
    if (activeTab === 'monthlycod')   return buildMonthlyCodGroups(projects, fromMonth, toMonth);
    return [];
  }, [open, activeTab, projects, txElements, fromMonth, toMonth]);

  const filtered = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups
      .map(g => ({
        ...g,
        contributors: g.contributors.filter(c =>
          (c.name ?? '').toLowerCase().includes(q)
          || (c.plantType ?? '').toLowerCase().includes(q)
          || (c.agency ?? '').toLowerCase().includes(q),
        ),
      }))
      .filter(g => g.contributors.length > 0);
  }, [groups, search]);

  // Default: groups read as open via `expanded[key] ?? true`. So the toggle
  // must respect that default — otherwise the first click flips
  // `undefined → true` (the default-open state) and nothing visibly changes.
  function toggle(key) {
    setExpanded(s => ({ ...s, [key]: !(s[key] ?? true) }));
  }

  function expandAll() {
    setExpanded(Object.fromEntries(filtered.map(g => [`${g.region}|${g.source}`, true])));
  }
  // Set every visible group explicitly to false so the `?? true` fallback
  // can't re-open them.
  function collapseAll() {
    setExpanded(Object.fromEntries(filtered.map(g => [`${g.region}|${g.source}`, false])));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl p-0 overflow-hidden" showClose={false}>
        <DialogHeader className="px-5 py-3 border-b bg-slate-50">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                <ListTree className="size-4 text-slate-500" />
                {meta.title}
              </DialogTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">{meta.subtitle}</p>
            </div>
            <button onClick={() => onOpenChange(false)} className="rounded p-1 text-slate-500 hover:text-foreground hover:bg-slate-200 transition-colors" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>

          <div className="flex items-center gap-2 mt-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by project, type, or agency…"
                className="w-full h-8 pl-8 pr-3 text-xs rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
            <button onClick={expandAll}   className="text-[11px] font-semibold text-slate-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-slate-100">Expand all</button>
            <button onClick={collapseAll} className="text-[11px] font-semibold text-slate-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-slate-100">Collapse all</button>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {filtered.reduce((s, g) => s + g.contributors.length, 0)} contributors · {filtered.length} groups
            </span>
          </div>
        </DialogHeader>

        <div className="overflow-auto" style={{ maxHeight: '70vh' }}>
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No contributors match your search.</div>
          ) : filtered.map((g) => {
            const key = `${g.region}|${g.source}`;
            const isOpen = expanded[key] ?? true;
            // Group-level totals (sum of numeric contributor fields)
            const totals = {};
            for (const c of cols) if (c.isNum) {
              totals[c.key] = g.contributors.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
            }
            return (
              <div key={key} className="border-b border-slate-200 last:border-b-0">
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  className="w-full flex items-center gap-3 px-4 py-2 bg-slate-50/60 hover:bg-slate-100 transition-colors text-left"
                >
                  <ChevronRight className={`size-3.5 text-slate-500 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  <Chip label={g.region} cls={REGION_BADGE[g.region]} />
                  <Chip label={CONTD4_SOURCE_LABEL[g.source] ?? g.source} cls={SOURCE_BADGE[g.source] ?? 'bg-slate-100 text-slate-700'} />
                  <span className="text-[10px] text-slate-500">{g.contributors.length} project{g.contributors.length !== 1 ? 's' : ''}</span>
                  <span className="ml-auto flex items-center gap-3 text-[11px] text-slate-600 tabular-nums">
                    {cols.filter(c => c.isNum).slice(0, 4).map(c => (
                      <span key={c.key}><span className="text-slate-400 mr-1">{c.label}:</span><span className="font-semibold">{fmt(totals[c.key])}</span></span>
                    ))}
                  </span>
                </button>

                {isOpen && (
                  <div className="bg-white">
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                            {cols.map(c => (
                              <th key={c.key} className={`px-3 py-1.5 font-semibold whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'} ${c.flex}`}>{c.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {g.contributors.map((c, i) => (
                            <tr key={c.id ?? i} className="border-b border-slate-100 last:border-b-0 hover:bg-blue-50/30">
                              {cols.map(col => (
                                <td key={col.key} className={`px-3 py-1.5 ${col.align === 'right' ? 'text-right tabular-nums' : 'text-left'} ${col.flex}`}>
                                  {col.isNum
                                    ? <span className={Number(c[col.key]) > 0 ? 'text-slate-800' : 'text-slate-300'}>{fmt(c[col.key])}</span>
                                    : col.key === 'pending'
                                    ? (c.pending
                                        ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">Yes</span>
                                        : <span className="text-[10px] text-slate-400">No</span>)
                                    : col.key === 'status'
                                    ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">{c.status}</span>
                                    : <span className="text-slate-700">{c[col.key] ?? '—'}</span>}
                                </td>
                              ))}
                            </tr>
                          ))}
                          {cols.some(c => c.isNum) && (
                            <tr className="bg-slate-50 border-t border-slate-200 font-semibold">
                              {cols.map((col, i) => (
                                <td key={col.key} className={`px-3 py-1.5 ${col.align === 'right' ? 'text-right tabular-nums' : 'text-left'} ${col.flex}`}>
                                  {i === 0 ? <span className="text-[10px] uppercase tracking-wide text-slate-500">Group total</span>
                                    : col.isNum ? <span className="text-slate-800">{fmt(totals[col.key])}</span>
                                    : null}
                                </td>
                              ))}
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
