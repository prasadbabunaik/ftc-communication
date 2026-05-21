'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Zap, X, ArrowLeft, CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Contd4Card } from '@/components/grid/Contd4Card';
import { ProjectPhaseTimeline } from '@/components/grid/ProjectPhaseTimeline';
import { AddPhasesForm } from '@/components/grid/AddPhasesForm';
import { AuditFeed } from '@/components/grid/AuditFeed';
import { ProjectHistory } from '@/components/grid/ProjectHistory';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

const STATUS_COLORS = {
  PENDING:  'bg-amber-50 text-amber-700 border-amber-200',
  RECEIVED: 'bg-blue-50 text-blue-700 border-blue-200',
  CLEARED:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
};

function SummaryCard({ label, value, sub, color }) {
  const styles = {
    blue:    { wrap: 'bg-blue-50 border-blue-100',       val: 'text-blue-700' },
    emerald: { wrap: 'bg-emerald-50 border-emerald-100', val: 'text-emerald-700' },
    amber:   { wrap: 'bg-amber-50 border-amber-100',     val: 'text-amber-700' },
  };
  const s = styles[color];
  return (
    <div className={`rounded-xl border p-4 ${s.wrap}`}>
      <p className="text-xs text-muted-foreground font-medium">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${s.val}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
    </div>
  );
}

function BreakdownItem({ label, mw }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold text-sm">{Number(mw).toFixed(1)} MW</p>
    </div>
  );
}

// Per-component (Solar / Wind / BESS / PSP) breakdown for hybrid projects,
// sourced from the Excel's "Source wise Segregation of hybrid Generation
// Capacity" sheet (stored on GenerationProject.hybridComponentsJson by the
// seed + backfill scripts). Replaces the old single-line capacity stat so
// the operator can see the milestone split per component, matching the
// Google Sheet exactly.
function fmtMw(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '0';
  // Strip trailing zeros after up to 2 decimal places.
  const s = n.toFixed(2);
  return s.replace(/\.?0+$/, '') || '0';
}
const COMPONENT_TABLE_SRC_ORDER = ['SOLAR', 'WIND', 'BESS', 'PSP', 'HYDRO', 'COAL'];
function HybridComponentTable({ components, hybridType }) {
  // Order the rows like the Google Sheet (Solar → Wind → BESS → PSP).
  const ordered = [...components].sort((a, b) => {
    const ai = COMPONENT_TABLE_SRC_ORDER.indexOf(a.sourceType);
    const bi = COMPONENT_TABLE_SRC_ORDER.indexOf(b.sourceType);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  const totals = ordered.reduce((acc, c) => {
    acc.totalMw    += Number(c.totalMw    ?? 0);
    acc.appliedMw  += Number(c.appliedMw  ?? 0);
    acc.ftcMw      += Number(c.ftcMw      ?? 0);
    acc.tocMw      += Number(c.tocMw      ?? 0);
    acc.codMw      += Number(c.codMw      ?? 0);
    acc.expectedMw += Number(c.expectedMw ?? 0);
    return acc;
  }, { totalMw: 0, appliedMw: 0, ftcMw: 0, tocMw: 0, codMw: 0, expectedMw: 0 });

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b bg-slate-50 flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Hybrid Capacity Breakdown
        </p>
        {hybridType && (
          <p className="text-[11px] text-slate-500 truncate max-w-[70%]" title={hybridType}>
            {hybridType}
          </p>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-slate-50/70 text-slate-600 border-b border-slate-200">
              <th className="px-3 py-2 text-left font-semibold">Source</th>
              <th className="px-3 py-2 text-right font-semibold">Total (MW)</th>
              <th className="px-3 py-2 text-right font-semibold">Applied</th>
              <th className="px-3 py-2 text-right font-semibold bg-blue-50/70 text-blue-700">FTC</th>
              <th className="px-3 py-2 text-right font-semibold bg-violet-50/70 text-violet-700">TOC</th>
              <th className="px-3 py-2 text-right font-semibold bg-emerald-50/70 text-emerald-700">COD</th>
              <th className="px-3 py-2 text-right font-semibold bg-amber-50/70 text-amber-700">Expected</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((c, i) => (
              <tr key={`${c.sourceType}-${i}`} className="border-b border-slate-100 last:border-b-0 hover:bg-blue-50/20">
                <td className="px-3 py-2"><SourceBadge source={c.sourceType} /></td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMw(c.totalMw)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMw(c.appliedMw)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-blue-800">{fmtMw(c.ftcMw)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-violet-800">{fmtMw(c.tocMw)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-800">{fmtMw(c.codMw)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-amber-800">{fmtMw(c.expectedMw)}</td>
              </tr>
            ))}
            <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold">
              <td className="px-3 py-2 text-[10px] uppercase tracking-wide text-slate-700">Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtMw(totals.totalMw)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtMw(totals.appliedMw)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtMw(totals.ftcMw)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtMw(totals.tocMw)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtMw(totals.codMw)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtMw(totals.expectedMw)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
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

function fmtEventDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const KIND_TONE = {
  FTC: 'bg-blue-100 text-blue-800 border-blue-200',
  TOC: 'bg-violet-100 text-violet-800 border-violet-200',
  COD: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};
const KIND_DOT = {
  FTC: 'bg-blue-500',
  TOC: 'bg-violet-500',
  COD: 'bg-emerald-500',
};
const KIND_TEXT = {
  FTC: 'text-blue-700',
  TOC: 'text-violet-700',
  COD: 'text-emerald-700',
};

function EventTable({ rows }) {
  if (rows.length === 0) return (
    <p className="py-6 text-center text-sm text-slate-400">No events recorded.</p>
  );
  return (
    <div className="rounded-lg border border-border bg-white overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 border-b border-border">
          <tr className="text-[10px] text-slate-500 uppercase tracking-wide">
            <th className="px-3 py-2 text-left font-semibold w-[70px]">Milestone</th>
            <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Date</th>
            <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Capacity (MW)</th>
            <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Cumulative</th>
            <th className="px-3 py-2 text-left font-semibold">Source</th>
            <th className="px-3 py-2 text-left font-semibold">Remarks</th>
            <th className="px-3 py-2 text-left font-semibold whitespace-nowrap" title="When this event was recorded in the system">Entered</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50/60">
              <td className="px-3 py-2">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${KIND_TONE[r.kind]}`}>
                  {r.kind}
                </span>
              </td>
              <td className="px-3 py-2 font-mono text-slate-700 tabular-nums whitespace-nowrap">{fmtEventDate(r.date)}</td>
              <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                {Number(r.mw || 0).toFixed(2)}
              </td>
              <td className="px-3 py-2 text-right font-mono text-slate-500 tabular-nums">
                {r.cumulative.toFixed(2)}
              </td>
              <td className="px-3 py-2"><SourceBadge source={r.source} /></td>
              <td className="px-3 py-2 text-slate-600 max-w-[280px]">
                {r.remarks
                  ? <span className="line-clamp-2" title={r.remarks}>{r.remarks}</span>
                  : <span className="text-slate-400">—</span>}
              </td>
              <td className="px-3 py-2 text-[10px] text-slate-500 font-mono whitespace-nowrap" title={r.createdAt ?? ''}>
                {r.createdAt ? fmtEntryStamp(r.createdAt) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Audit-trail timestamp: "21 May 14:32" — short enough to fit the column,
// detailed enough to disambiguate same-day saves. Full ISO is in the
// row's title attr.
function fmtEntryStamp(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function CommissioningTimeline({ phases }) {
  const [activeTab, setActiveTab] = useState('ALL');

  // Per-source totals used by the Progress tab. Compute from phases (not
  // event rows) so we get capacityAppliedMw + capacityUnderXxxMw too.
  const perSource = {};
  for (const ph of phases ?? []) {
    const s = ph.sourceType;
    if (!perSource[s]) perSource[s] = {
      applied: 0, ftc: 0, toc: 0, cod: 0,
      underFtc: 0, underToc: 0,
    };
    perSource[s].applied  += Number(ph.capacityAppliedMw  ?? 0);
    perSource[s].ftc      += (ph.ftcEvents ?? []).reduce((a, e) => a + Number(e.capacityMw ?? 0), 0);
    perSource[s].toc      += (ph.tocEvents ?? []).reduce((a, e) => a + Number(e.capacityMw ?? 0), 0);
    perSource[s].cod      += (ph.codEvents ?? []).reduce((a, e) => a + Number(e.capacityMw ?? 0), 0);
    perSource[s].underFtc += Number(ph.capacityUnderFtcMw ?? 0);
    perSource[s].underToc += Number(ph.capacityUnderTocMw ?? 0);
  }

  // Build flat list of all events
  const allRows = [];
  for (const ph of phases ?? []) {
    for (const e of (ph.ftcEvents ?? [])) allRows.push({ kind: 'FTC', date: e.eventDate, mw: e.capacityMw, remarks: e.remarks, source: ph.sourceType, id: 'f' + e.id, createdAt: e.createdAt });
    for (const e of (ph.tocEvents ?? [])) allRows.push({ kind: 'TOC', date: e.eventDate, mw: e.capacityMw, remarks: e.remarks, source: ph.sourceType, id: 't' + e.id, createdAt: e.createdAt });
    for (const e of (ph.codEvents ?? [])) allRows.push({ kind: 'COD', date: e.eventDate, mw: e.capacityMw, remarks: e.remarks, source: ph.sourceType, id: 'c' + e.id, createdAt: e.createdAt });
  }
  if (allRows.length === 0) return null;

  // Sort ascending to compute running cumulative correctly
  const ORDER = { FTC: 0, TOC: 1, COD: 2 };
  allRows.sort((a, b) => {
    const d = new Date(a.date) - new Date(b.date);
    return d !== 0 ? d : ORDER[a.kind] - ORDER[b.kind];
  });

  // Attach cumulative to each row (ascending pass)
  const cumAcc = { FTC: 0, TOC: 0, COD: 0 };
  for (const r of allRows) {
    cumAcc[r.kind] += Number(r.mw || 0);
    r.cumulative = cumAcc[r.kind];
  }

  const total = { FTC: cumAcc.FTC, TOC: cumAcc.TOC, COD: cumAcc.COD };

  // Available tabs (only show kind tabs that have data)
  const tabs = [
    { key: 'ALL',      label: 'All',      count: allRows.length },
    { key: 'FTC',      label: 'FTC',      count: allRows.filter(r => r.kind === 'FTC').length },
    { key: 'TOC',      label: 'TOC',      count: allRows.filter(r => r.kind === 'TOC').length },
    { key: 'COD',      label: 'COD',      count: allRows.filter(r => r.kind === 'COD').length },
    // Progress tab is a separate visualization, not a row filter. Its count
    // is the number of source rows it'll show.
    { key: 'PROGRESS', label: 'Progress', count: Object.keys(perSource).length, isViz: true },
  ].filter(t => t.count > 0 || t.key === 'ALL');

  // Filter by active tab then reverse for descending display
  const displayRows = allRows
    .filter(r => activeTab === 'ALL' || r.kind === activeTab)
    .slice()
    .reverse();

  return (
    <div className="space-y-3">
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-t-md border-b-2 transition-colors -mb-px ${
              activeTab === t.key
                ? t.key === 'ALL'
                  ? 'border-slate-700 text-slate-700'
                  : t.key === 'FTC'
                  ? 'border-blue-600 text-blue-700'
                  : t.key === 'TOC'
                  ? 'border-violet-600 text-violet-700'
                  : t.key === 'COD'
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-amber-600 text-amber-700'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            <span className="flex items-center gap-1.5">
              {t.key !== 'ALL' && t.key !== 'PROGRESS' && (
                <span className={`inline-block size-1.5 rounded-full ${KIND_DOT[t.key]}`} />
              )}
              {t.label}
              <span className={`text-[10px] font-normal px-1 py-0.5 rounded ${
                activeTab === t.key ? 'bg-slate-100 text-slate-600' : 'bg-slate-100 text-slate-400'
              }`}>
                {t.count}
              </span>
            </span>
          </button>
        ))}

        {/* Totals on the right */}
        <div className="ml-auto flex items-center gap-3 pr-1 pb-1.5">
          {['FTC', 'TOC', 'COD'].map((k) => total[k] > 0 && (
            <span key={k} className="text-[10px] inline-flex items-center gap-1">
              <span className={`inline-block size-1.5 rounded-full ${KIND_DOT[k]}`} />
              <span className="text-slate-500">{k}</span>
              <span className={`font-mono font-semibold ${KIND_TEXT[k]}`}>{total[k].toFixed(1)} MW</span>
            </span>
          ))}
        </div>
      </div>

      {activeTab === 'PROGRESS'
        ? <PhaseProgressBars perSource={perSource} />
        : <EventTable rows={displayRows} />}
    </div>
  );
}

// Per-source funnel visualization. Each row shows the project's commissioning
// pipeline for ONE source: COD (done) → TOC (issued, awaiting COD) → FTC
// (approved, awaiting TOC) → Applied-but-pending. Segment lengths are
// proportional to MW so the eye can compare progress at a glance.
function PhaseProgressBars({ perSource }) {
  const entries = Object.entries(perSource);
  if (entries.length === 0) {
    return <div className="text-sm text-muted-foreground py-6 text-center">No phases recorded yet.</div>;
  }
  return (
    <div className="space-y-4">
      {entries.map(([source, s]) => {
        const applied = Math.max(0, s.applied);
        if (applied === 0) return null;
        // Compute funnel segments. Sum can't exceed Applied by invariant.
        const cod        = Math.min(s.cod, applied);
        const tocPending = Math.max(0, Math.min(s.toc, applied) - cod);
        const ftcPending = Math.max(0, Math.min(s.ftc, applied) - cod - tocPending);
        const remaining  = Math.max(0, applied - cod - tocPending - ftcPending);
        const pct = (v) => `${(v / applied) * 100}%`;
        return (
          <div key={source} className="rounded-lg border border-border bg-card p-3 space-y-2">
            {/* Header: source badge + Applied total */}
            <div className="flex items-center justify-between text-xs">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${SOURCE_BADGE[source] ?? 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                {source}
              </span>
              <span className="font-mono text-slate-600">
                Applied <span className="font-semibold text-foreground">{applied.toFixed(1)} MW</span>
              </span>
            </div>

            {/* Stacked funnel bar */}
            <div className="h-6 w-full rounded-md overflow-hidden bg-slate-100 flex">
              {cod > 0 && (
                <div
                  className="bg-emerald-500 h-full flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ width: pct(cod) }}
                  title={`COD: ${cod.toFixed(1)} MW`}
                >
                  {cod / applied >= 0.08 ? cod.toFixed(0) : ''}
                </div>
              )}
              {tocPending > 0 && (
                <div
                  className="bg-violet-400 h-full flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ width: pct(tocPending) }}
                  title={`TOC pending COD: ${tocPending.toFixed(1)} MW`}
                >
                  {tocPending / applied >= 0.08 ? tocPending.toFixed(0) : ''}
                </div>
              )}
              {ftcPending > 0 && (
                <div
                  className="bg-blue-400 h-full flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ width: pct(ftcPending) }}
                  title={`FTC pending TOC: ${ftcPending.toFixed(1)} MW`}
                >
                  {ftcPending / applied >= 0.08 ? ftcPending.toFixed(0) : ''}
                </div>
              )}
              {remaining > 0 && (
                <div
                  className="bg-slate-200 h-full flex items-center justify-center text-[10px] font-bold text-slate-600"
                  style={{ width: pct(remaining) }}
                  title={`Pending FTC: ${remaining.toFixed(1)} MW`}
                >
                  {remaining / applied >= 0.08 ? remaining.toFixed(0) : ''}
                </div>
              )}
            </div>

            {/* Stage table — % + MW for each */}
            <div className="grid grid-cols-4 gap-2 text-[11px] pt-1">
              <ProgressStat color="emerald" label="COD done" mw={cod} applied={applied} />
              <ProgressStat color="violet"  label="TOC issued" mw={s.toc} applied={applied} />
              <ProgressStat color="blue"    label="FTC approved" mw={s.ftc} applied={applied} />
              <ProgressStat color="slate"   label="Pending FTC" mw={remaining} applied={applied} />
            </div>
          </div>
        );
      })}

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground pt-1">
        <span className="inline-flex items-center gap-1"><span className="inline-block size-2 rounded-sm bg-emerald-500" />COD</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block size-2 rounded-sm bg-violet-400" />TOC pending COD</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block size-2 rounded-sm bg-blue-400" />FTC pending TOC</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block size-2 rounded-sm bg-slate-200 border border-slate-300" />Pending FTC</span>
      </div>
    </div>
  );
}

function ProgressStat({ color, label, mw, applied }) {
  const pct = applied > 0 ? (mw / applied) * 100 : 0;
  const COLOR = {
    emerald: 'text-emerald-700',
    violet:  'text-violet-700',
    blue:    'text-blue-700',
    slate:   'text-slate-600',
  }[color] ?? 'text-slate-700';
  return (
    <div className="space-y-0.5">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`font-mono font-semibold ${COLOR}`}>
        {mw.toFixed(1)} MW <span className="text-[10px] text-muted-foreground font-normal">· {pct.toFixed(0)}%</span>
      </p>
    </div>
  );
}

const SOURCE_BADGE = {
  WIND:   'bg-sky-100 text-sky-700 border-sky-200',
  SOLAR:  'bg-amber-100 text-amber-700 border-amber-200',
  BESS:   'bg-violet-100 text-violet-700 border-violet-200',
  COAL:   'bg-stone-100 text-stone-700 border-stone-200',
  HYDRO:  'bg-blue-100 text-blue-700 border-blue-200',
  PSP:    'bg-emerald-100 text-emerald-700 border-emerald-200',
};

export function ProjectDetailModal({ project, open, onOpenChange, canEdit, userRole }) {
  const [view, setView] = useState('detail'); // 'detail' | 'add-phase'
  const router = useRouter();

  if (!project) return null;

  const commissionedMw    = project.phases.reduce((s, p) => s + (p.codDeclaredMw ?? 0), 0);
  const pendingCapacityMw = project.totalCapacityMw - commissionedMw;

  const sourceUsed = project.phases.reduce((acc, p) => {
    acc[p.sourceType] = (acc[p.sourceType] ?? 0) + (p.capacityAppliedMw ?? 0);
    return acc;
  }, {});

  function handleClose() {
    onOpenChange(false);
    setView('detail');
  }

  function handlePhaseSuccess() {
    handleClose();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-4xl" showClose={false}>

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-start gap-3">
            {view === 'add-phase' && (
              <button
                onClick={() => setView('detail')}
                className="mt-0.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="size-5" />
              </button>
            )}
            <div className="flex items-start gap-3">
              <div className="size-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0 mt-0.5">
                <Zap className="size-5 text-blue-600" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-foreground leading-tight">
                  {view === 'add-phase' ? 'Add Commissioning Phase' : project.name}
                </DialogTitle>
                {view === 'detail' ? (
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                      {project.region.code}
                    </span>
                    <span className="text-xs text-muted-foreground">{project.plantType.label}</span>
                    {project.poolingStation && (
                      <span className="text-xs text-muted-foreground">· {project.poolingStation.name}</span>
                    )}
                    {project.contd4 && (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${STATUS_COLORS[project.contd4.status]}`}>
                        CONTD-4: {project.contd4.status}
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {project.name} · {project.region.code} · {project.plantType.label}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {view === 'detail' && canEdit && (
              <Button size="sm" onClick={() => setView('add-phase')}>
                <Plus className="size-3.5 mr-1.5" />
                Add Commissioning Phase
              </Button>
            )}
            <button
              onClick={handleClose}
              className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="px-6 py-5 overflow-y-auto max-h-[75vh]">

          {view === 'detail' && (
            <div className="space-y-5">
              {/* Capacity summary */}
              <div className="grid grid-cols-3 gap-3">
                <SummaryCard
                  label="Total Capacity"
                  value={`${project.totalCapacityMw.toFixed(1)} MW`}
                  sub={project.plantType.label}
                  color="blue"
                />
                <SummaryCard
                  label="Commissioned (COD)"
                  value={`${commissionedMw.toFixed(1)} MW`}
                  sub={`${Math.round((commissionedMw / project.totalCapacityMw) * 100) || 0}% complete`}
                  color="emerald"
                />
                <SummaryCard
                  label="Pending COD"
                  value={`${Math.max(0, pendingCapacityMw).toFixed(1)} MW`}
                  sub={pendingCapacityMw <= 0 ? 'Fully commissioned' : 'Remaining'}
                  color={pendingCapacityMw <= 0 ? 'emerald' : 'amber'}
                />
              </div>

              {/* Hybrid breakdown — full per-component view from the Excel's
                  "Source wise Segregation" sheet (stored in
                  hybridComponentsJson). Falls back to the compact 3-stat
                  layout when only the legacy capacity fields are present. */}
              {project.plantType.isHybrid && (
                project.hybridComponentsJson?.components?.length ? (
                  <HybridComponentTable components={project.hybridComponentsJson.components} hybridType={project.hybridComponentsJson.hybridType ?? project.plantType.label} />
                ) : (
                  <div className="rounded-xl border bg-card p-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                      Hybrid Capacity Breakdown
                    </p>
                    <div className="flex gap-8">
                      {project.windCapacityMw  && <BreakdownItem label="Wind"  mw={project.windCapacityMw} />}
                      {project.solarCapacityMw && <BreakdownItem label="Solar" mw={project.solarCapacityMw} />}
                      {project.bessCapacityMw  && <BreakdownItem label="BESS"  mw={project.bessCapacityMw} />}
                      {project.pspCapacityMw   && <BreakdownItem label="PSP"   mw={project.pspCapacityMw} />}
                    </div>
                  </div>
                )
              )}

              {/* CONTD-4 */}
              <Contd4Card contd4={project.contd4} projectId={project.id} canEdit={canEdit} notes={project.notes ?? []} />

              {/* Commissioning Phases */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-3">Commissioning Phases</h3>
                {project.phases.length === 0 ? (
                  <div className="rounded-xl border border-dashed bg-muted/10 p-8 text-center">
                    <Zap className="size-7 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No commissioning phases yet.</p>
                    {canEdit && (
                      <Button size="sm" className="mt-3" onClick={() => setView('add-phase')}>
                        Add First Phase
                      </Button>
                    )}
                  </div>
                ) : (
                  <ProjectPhaseTimeline
                    phases={project.phases}
                    projectId={project.id}
                    canEdit={canEdit}
                    onEditSuccess={handleClose}
                  />
                )}
              </div>

              {/* Phased Commissioning Timeline */}
              {(() => {
                const totalEvents = (project.phases ?? []).reduce((s, ph) =>
                  s + (ph.ftcEvents?.length ?? 0) + (ph.tocEvents?.length ?? 0) + (ph.codEvents?.length ?? 0), 0);
                if (totalEvents === 0) return null;
                return (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <CalendarClock className="size-4 text-blue-600" />
                      <h3 className="text-sm font-semibold text-foreground">Phased Commissioning History</h3>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100 text-[10px] font-semibold">
                        {totalEvents} events
                      </span>
                    </div>
                    <CommissioningTimeline phases={project.phases} />
                  </div>
                );
              })()}

              {/* Day-wise History */}
              <ProjectHistory name={project.name} region={project.region.code} kind="ftc" />

              {/* Engineering Audit Feed */}
              <div className="rounded-xl border bg-card p-4">
                <AuditFeed
                  projectId={project.id}
                  notes={project.notes ?? []}
                  canAdd={true}
                />
              </div>
            </div>
          )}

          {view === 'add-phase' && (
            <AddPhasesForm
              projectId={project.id}
              totalCapacityMw={project.totalCapacityMw}
              existingCodMw={commissionedMw}
              plantType={project.plantType}
              windCapacityMw={project.windCapacityMw}
              solarCapacityMw={project.solarCapacityMw}
              bessCapacityMw={project.bessCapacityMw}
              pspCapacityMw={project.pspCapacityMw}
              existingPhases={project.phases}
              sourceUsed={sourceUsed}
              userRole={userRole}
              onSuccess={handlePhaseSuccess}
              onCancel={() => setView('detail')}
            />
          )}

        </div>
      </DialogContent>
    </Dialog>
  );
}
