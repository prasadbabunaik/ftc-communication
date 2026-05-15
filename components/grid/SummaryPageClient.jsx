'use client';

import { useState } from 'react';
import { BarChart3, GitBranch, Grid3x3, Layers, TrendingUp, Zap, Cable, CalendarDays, Download, History, ListTree } from 'lucide-react';
import { useSettings } from '@/providers/settings-provider';
import { SnapshotCompareTab } from '@/components/grid/SnapshotCompareTab';
import { ProjectDetailsTab } from '@/components/grid/ProjectDetailsTab';
import { TabBreakdown } from '@/components/grid/TabBreakdown';
import { CONTD4_SOURCE_LABEL } from '@/lib/grid-computations';

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtRefMonthShort(ym) {
  if (!ym) return 'Expected';
  try {
    const d = new Date(`${ym}-01`);
    return `Exp. ${d.toLocaleString('en-US', { month: 'short' })}'${String(d.getFullYear()).slice(2)}`;
  } catch { return 'Expected'; }
}

function fmt(v) {
  if (v == null) return '—';
  const n = Number(v);
  if (n === 0) return '0';
  const parts = n.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const dec = parts[1]?.replace(/0+$/, '');
  return dec ? `${parts[0]}.${dec}` : parts[0];
}

function fmtMonth(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m) - 1]}'${y.slice(2)}`;
}

// ── constants ─────────────────────────────────────────────────────────────────

const REGION_ORDER = ['NR', 'WR', 'SR', 'ER', 'NER'];
const SOURCE_ORDER = ['WIND', 'SOLAR', 'BESS', 'HYBRID', 'COAL', 'HYDRO', 'PSP'];

const HYBRID_BADGE = 'bg-teal-100 text-teal-800 border border-teal-200';
const SOURCE_BADGE = {
  WIND:   'bg-sky-100 text-sky-800 border border-sky-200',
  SOLAR:  'bg-amber-100 text-amber-800 border border-amber-200',
  BESS:   'bg-violet-100 text-violet-800 border border-violet-200',
  HYBRID: HYBRID_BADGE,
  HYBRID_WS:  HYBRID_BADGE, HYBRID_SB: HYBRID_BADGE, HYBRID_WSB: HYBRID_BADGE,
  HYBRID_WB:  HYBRID_BADGE, HYBRID_WP: HYBRID_BADGE, HYBRID_HP:  HYBRID_BADGE,
  HYBRID_SP:  HYBRID_BADGE,
  COAL:   'bg-stone-100 text-stone-700 border border-stone-200',
  HYDRO:  'bg-blue-100 text-blue-800 border border-blue-200',
  PSP:    'bg-emerald-100 text-emerald-800 border border-emerald-200',
  Total:  'bg-slate-100 text-slate-600 border border-slate-200',
};

const REGION_BADGE = {
  NR:  'bg-indigo-100 text-indigo-800 border border-indigo-200',
  WR:  'bg-orange-100 text-orange-800 border border-orange-200',
  SR:  'bg-pink-100 text-pink-800 border border-pink-200',
  ER:  'bg-cyan-100 text-cyan-800 border border-cyan-200',
  NER: 'bg-lime-100 text-lime-800 border border-lime-200',
};

function Chip({ label, colorCls }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${colorCls ?? 'bg-muted text-foreground'}`}>
      {label}
    </span>
  );
}

// Inline "View Breakup" button — rendered inside each tab's section header.
function ViewBreakupBtn({ onClick }) {
  if (!onClick) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-semibold transition-colors shrink-0"
      title="See which projects/elements contribute to the numbers in this tab"
    >
      <ListTree className="size-3" />
      View Breakup
    </button>
  );
}

// ── Shared table primitives ────────────────────────────────────────────────────

// Dark two-row grouped header used by Pipeline (Tables 2 & 5)
function PipelineHead({ isRegionPrimary, refMonthLabel }) {
  return (
    <thead className="sticky top-0 z-20 text-[10px]">
      <tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
        <th rowSpan={2} className="sticky left-0 z-30 bg-slate-100 px-3 py-2 text-left font-bold border-r border-slate-200 whitespace-nowrap" style={{ minWidth: 76 }}>
          {isRegionPrimary ? 'Region' : 'Source'}
        </th>
        <th rowSpan={2} className="sticky z-30 bg-slate-100 px-3 py-2 text-left font-bold border-r border-slate-200 whitespace-nowrap" style={{ left: 76, minWidth: 80 }}>
          {isRegionPrimary ? 'Source' : 'Region'}
        </th>
        <th rowSpan={2} className="px-3 py-2 text-right font-bold border-r border-slate-200 whitespace-nowrap">Total Cap (MW)</th>
        <th rowSpan={2} className="px-3 py-2 text-right font-bold border-r border-slate-200 whitespace-nowrap text-slate-400">CONTD-4 (MW)</th>
        <th rowSpan={2} className="px-3 py-2 text-right font-bold border-r border-slate-200 whitespace-nowrap">Applied (MW)</th>
        <th colSpan={2} className="px-3 py-1 text-center font-bold bg-blue-50 text-blue-700 border-r border-blue-200 whitespace-nowrap">FTC (MW)</th>
        <th colSpan={2} className="px-3 py-1 text-center font-bold bg-violet-50 text-violet-700 border-r border-violet-200 whitespace-nowrap">TOC (MW)</th>
        <th colSpan={2} className="px-3 py-1 text-center font-bold bg-emerald-50 text-emerald-700 border-r border-emerald-200 whitespace-nowrap">COD (MW)</th>
        <th rowSpan={2} className="px-3 py-2 text-center font-bold bg-amber-50 text-amber-700 border-l border-amber-200 whitespace-nowrap">{refMonthLabel}</th>
      </tr>
      <tr className="text-[10px]">
        <th className="px-3 py-1 text-right font-semibold bg-blue-100 text-blue-700 border-r border-blue-200 whitespace-nowrap">Approved</th>
        <th className="px-3 py-1 text-right font-semibold bg-blue-50 text-blue-500 border-r border-slate-200 whitespace-nowrap">Pending</th>
        <th className="px-3 py-1 text-right font-semibold bg-violet-100 text-violet-700 border-r border-violet-200 whitespace-nowrap">Issued</th>
        <th className="px-3 py-1 text-right font-semibold bg-violet-50 text-violet-400 border-r border-slate-200 whitespace-nowrap">Pending</th>
        <th className="px-3 py-1 text-right font-semibold bg-emerald-100 text-emerald-700 border-r border-emerald-200 whitespace-nowrap">Done</th>
        <th className="px-3 py-1 text-right font-semibold bg-emerald-50 text-emerald-500 border-r border-slate-200 whitespace-nowrap">Pending</th>
      </tr>
    </thead>
  );
}

function PipelineRow({ row, i, rows, isRegionPrimary }) {
  const isTotal          = row.isTotal;
  const isSubtotal       = row.isSubtotal && !isTotal;
  const isAllIndia       = row.isAllIndiaBreakdown;
  const primary    = isRegionPrimary ? row.region : row.source;
  const secondary  = isRegionPrimary ? row.source : row.region;

  const prevRow   = rows[i - 1];
  const sameGroup = !isSubtotal && !isTotal && prevRow &&
    !prevRow.isSubtotal && !prevRow.isTotal &&
    (isRegionPrimary ? prevRow.region === row.region : prevRow.source === row.source);

  const isFirstAllIndia = isAllIndia && !prevRow?.isAllIndiaBreakdown;

  // All India rows live in a sticky <tfoot>, so they MUST use fully-opaque
  // backgrounds (no slash-opacity) — otherwise scrolled body content shows
  // through.
  const bg = isTotal
    ? 'bg-slate-100'
    : isAllIndia
    ? 'bg-slate-50'
    : isSubtotal
    ? 'bg-slate-50/80'
    : 'bg-white';

  const rowCls = isTotal
    ? 'border-t border-slate-300 text-[11px] font-bold'
    : isSubtotal
    ? 'border-t border-slate-200 text-[11px]'
    : isFirstAllIndia
    ? 'border-t-2 border-slate-300 text-[11px] transition-colors'
    : isAllIndia
    ? 'border-t border-slate-200 text-[11px]'
    : 'border-t border-gray-100 hover:bg-blue-50/20 text-[11px] transition-colors';

  const bold = isSubtotal || isTotal;

  // Sticky <tfoot> rows: force every cell to an OPAQUE inline background.
  // Tailwind class-based bgs (incl. `bg-slate-50` solid) can be undermined
  // by translucent column tints (`bg-blue-50/30`, etc.) and by the fact
  // that <tr> backgrounds don't always paint reliably in all browsers
  // under `border-collapse: collapse`. Setting the bg directly on every
  // <td> via inline style guarantees no bleed-through.
  const isFooterRow = isAllIndia || isTotal;
  const SOLID = isTotal ? '#f1f5f9' /* slate-100 */ : '#f8fafc' /* slate-50 */;
  const stripBg = (cls) => cls.replace(/\bbg-[\w/-]+/g, '').trim();
  const cellStyle = isFooterRow ? { backgroundColor: SOLID } : undefined;

  const N = ({ v, cls = '' }) => {
    const cleanCls = isFooterRow ? stripBg(cls) : cls;
    return (
      <td
        style={cellStyle}
        className={`px-3 py-2 text-right tabular-nums ${bold ? 'font-bold' : ''} ${cleanCls}`}
      >
        {fmt(v)}
      </td>
    );
  };

  return (
    <tr className={`${rowCls} ${bg}`}>
      <td
        style={cellStyle}
        className={`px-3 py-2 sticky left-0 border-r border-gray-200 z-10 ${bg}`}
      >
        {/* Region/source chip — only on first row of a group. For the
            All India breakdown the label appears once (on the first
            breakdown row); the grand-total row at the bottom acts as
            that section's subtotal (matches per-region layout). */}
        {!isTotal && !isSubtotal && !sameGroup && (
          isAllIndia
            ? <span className="text-[11px] font-bold text-slate-600">All India</span>
            : <Chip label={primary} colorCls={isRegionPrimary ? REGION_BADGE[primary] : SOURCE_BADGE[primary]} />
        )}
      </td>
      <td
        style={{ ...cellStyle, left: 76 }}
        className={`px-3 py-2 sticky border-r border-gray-200 z-10 ${bg}`}
      >
        {isSubtotal || isTotal
          ? <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Total</span>
          : <Chip label={secondary} colorCls={isRegionPrimary ? SOURCE_BADGE[secondary] : REGION_BADGE[secondary]} />}
      </td>
      <N v={row.totalCapacityMw}  cls="border-r border-gray-100" />
      <N v={row.contd4CapacityMw} cls="border-r border-gray-100 text-slate-400" />
      <N v={row.appliedMw}        cls="border-r border-slate-200" />
      <N v={row.ftcApprovedMw}    cls="border-r border-blue-100 bg-blue-50/30 text-blue-800" />
      <N v={row.ftcPendingMw}     cls="border-r border-slate-200 bg-blue-50/10 text-amber-700" />
      <N v={row.tocIssuedMw}      cls="border-r border-violet-100 bg-violet-50/30 text-violet-800" />
      <N v={row.tocPendingMw}     cls="border-r border-slate-200 bg-violet-50/10 text-amber-700" />
      <N v={row.codCompletedMw}   cls="border-r border-emerald-100 bg-emerald-50/30 text-emerald-800" />
      <N v={row.codPendingMw}     cls="border-r border-slate-200 bg-emerald-50/10 text-rose-700" />
      <N v={row.expectedMw}       cls="bg-amber-50/30 text-amber-800" />
    </tr>
  );
}

// ── Table 2 / 5 — FTC Pipeline ────────────────────────────────────────────────

function PipelineTable({ rows, primaryKey, refMonthLabel = 'Expected', title, desc, onViewBreakup }) {
  if (!rows?.length) return <Empty />;
  const isRegionPrimary = primaryKey === 'region';

  // Split off the All India block (breakdown rows + grand total) so it can
  // be pinned to the bottom of the scroll container.
  const regionRows = rows.filter((r) => !r.isAllIndiaBreakdown && !r.isTotal);
  const footerRows = rows.filter((r) =>  r.isAllIndiaBreakdown ||  r.isTotal);

  return (
    <div className="rounded-xl border overflow-hidden shadow-sm">
      {title && (
        <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700">{title}</p>
            {desc && <p className="text-[10px] text-slate-500 mt-0.5">{desc}</p>}
          </div>
          <ViewBreakupBtn onClick={onViewBreakup} />
        </div>
      )}
      <div className="overflow-auto" style={{ maxHeight: '62vh' }}>
        <table className="w-full border-collapse">
          <PipelineHead isRegionPrimary={isRegionPrimary} refMonthLabel={refMonthLabel} />
          <tbody>
            {regionRows.map((row, i) => (
              <PipelineRow key={i} row={row} i={i} rows={regionRows} isRegionPrimary={isRegionPrimary} />
            ))}
          </tbody>
          {footerRows.length > 0 && (
            <tfoot style={{ backgroundColor: "#ffffff" }} className="sticky bottom-0 z-20 bg-white shadow-[0_-2px_6px_rgba(0,0,0,0.05)]">
              {footerRows.map((row, i) => (
                <PipelineRow key={`f${i}`} row={row} i={i} rows={footerRows} isRegionPrimary={isRegionPrimary} />
              ))}
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ── Table 1 — CONTD-4 Study ────────────────────────────────────────────────────

function Contd4Row({ row, prev, isAllIndiaSection, isFirstAllIndiaBreakdown, allMonths }) {
  const isTotal    = row.isTotal;
  const isSubtotal = row.isSubtotal && !isTotal;
  const isAllIndiaBreakdown = row.isAllIndiaBreakdown;
  const sameRegion = !isSubtotal && !isTotal && !isAllIndiaBreakdown && prev
    && !prev.isSubtotal && !prev.isTotal && !prev.isAllIndiaBreakdown
    && prev.region === row.region;

  const bg = isAllIndiaSection
    ? (isTotal ? 'bg-slate-100' : 'bg-slate-50')
    : isSubtotal ? 'bg-slate-50/80'
    : 'bg-white';

  // Sticky <tfoot> rows: paint every cell with an OPAQUE inline background
  // so scrolling body content cannot bleed through (Tailwind class-based
  // bgs alone are unreliable on <tr>/<td> with border-collapse: collapse).
  const cellStyle = isAllIndiaSection
    ? { backgroundColor: isTotal ? '#f1f5f9' /* slate-100 */ : '#f8fafc' /* slate-50 */ }
    : undefined;

  const rowCls = isSubtotal
    ? 'border-t border-slate-200 font-semibold'
    : isFirstAllIndiaBreakdown
    ? 'border-t-2 border-slate-300'
    : isAllIndiaBreakdown
    ? 'border-t border-slate-200'
    : isTotal
    ? 'border-t border-slate-300 font-bold'
    : 'border-t border-gray-100 hover:bg-blue-50/20 transition-colors';

  return (
    <tr className={`${rowCls} ${bg}`}>
      <td
        style={cellStyle}
        className={`px-3 py-2 sticky left-0 z-10 border-r border-gray-200 ${bg}`}
      >
        {!sameRegion && !isSubtotal && !isTotal && !isAllIndiaBreakdown && <Chip label={row.region} colorCls={REGION_BADGE[row.region]} />}
        {isFirstAllIndiaBreakdown && <span className="text-[11px] font-bold text-slate-600">All India</span>}
      </td>
      <td
        style={{ ...cellStyle, left: 76 }}
        className={`px-3 py-2 sticky z-10 border-r border-gray-200 ${bg}`}
      >
        {isSubtotal || isTotal
          ? <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Total</span>
          : <Chip label={CONTD4_SOURCE_LABEL[row.source] ?? row.source} colorCls={SOURCE_BADGE[row.source]} />}
      </td>
      <td
        style={cellStyle}
        className={`px-3 py-2 text-right tabular-nums border-r border-gray-100 ${bg}`}
      >
        {fmt(row.totalMw)}
      </td>
      {allMonths.map(m => {
        const v = row.months?.[m] ?? 0;
        return (
          <td
            key={m}
            style={cellStyle}
            className={`px-3 py-2 text-right tabular-nums border-r border-gray-100 ${bg} ${v > 0 ? 'text-blue-700' : 'text-slate-300'}`}
          >
            {v > 0 ? fmt(v) : '0'}
          </td>
        );
      })}
    </tr>
  );
}

function Contd4StudyTable({ contd4Study, onViewBreakup }) {
  const { rows, allMonths, referenceMonth, carriedTotal } = contd4Study ?? {};
  if (!rows?.length) return <Empty />;

  // Split off the All India block (breakdown + grand total) so it can be
  // pinned to the bottom of the scroll container — only regions scroll.
  const regionRows = rows.filter(r => !r.isAllIndiaBreakdown && !r.isTotal);
  const footerRows = rows.filter(r =>  r.isAllIndiaBreakdown ||  r.isTotal);

  return (
    <div className="rounded-xl border overflow-hidden shadow-sm">
      <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700">Total Capacity (MW) Under CONTD-4 Study</p>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Active (PENDING / RECEIVED) applications — expected completion by month
            {carriedTotal > 0 && referenceMonth && (
              <span className="ml-2 inline-flex items-center gap-1 text-amber-700 font-medium">
                · {fmt(carriedTotal)} MW carried forward into {fmtMonth(referenceMonth)}
              </span>
            )}
          </p>
        </div>
        <ViewBreakupBtn onClick={onViewBreakup} />
      </div>
      <div className="overflow-auto" style={{ maxHeight: '58vh' }}>
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-20">
            <tr className="bg-slate-100 text-slate-700 text-[10px] border-b border-slate-200">
              <th className="sticky left-0 z-30 bg-slate-100 px-3 py-2 text-left font-bold border-r border-slate-200 whitespace-nowrap" style={{ minWidth: 76 }}>Region</th>
              <th className="sticky z-30 bg-slate-100 px-3 py-2 text-left font-bold border-r border-slate-200 whitespace-nowrap" style={{ left: 76, minWidth: 200 }}>Source</th>
              <th className="px-3 py-2 text-right font-bold border-r border-slate-200 whitespace-nowrap">Total Cap (MW)</th>
              {allMonths.map(m => (
                <th key={m} className="px-3 py-2 text-right font-bold border-r border-blue-200 whitespace-nowrap bg-blue-50 text-blue-700">
                  {fmtMonth(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {regionRows.map((row, i) => (
              <Contd4Row key={i} row={row} prev={regionRows[i - 1]} allMonths={allMonths}
                isAllIndiaSection={false} isFirstAllIndiaBreakdown={false} />
            ))}
          </tbody>
          {footerRows.length > 0 && (
            <tfoot style={{ backgroundColor: "#ffffff" }} className="sticky bottom-0 z-20 bg-white shadow-[0_-2px_6px_rgba(0,0,0,0.05)]">
              {footerRows.map((row, i) => (
                <Contd4Row key={`f${i}`} row={row} prev={footerRows[i - 1]} allMonths={allMonths}
                  isAllIndiaSection={true}
                  isFirstAllIndiaBreakdown={i === 0 && row.isAllIndiaBreakdown} />
              ))}
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ── Table 3 — Transmission ─────────────────────────────────────────────────────

const CAT_LABELS = {
  LINE_RE:    'Transmission Line (RE Pocket)',
  LINE_NONRE: 'Transmission Line (Non-RE Pocket)',
  ICT_RE:     'ICT (RE Pocket)',
  ICT_NONRE:  'ICT (Non-RE Pocket)',
  GT:         'GT (Generator Transformer)',
  ST:         'ST (Station Transformer)',
};

function TransmissionSummaryTable({ transmissionRows, refMonthLabel = 'Expected', onViewBreakup }) {
  if (!transmissionRows?.length) return <Empty />;

  return (
    <div className="rounded-xl border overflow-hidden shadow-sm">
      <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700">Transmission Elements — FTC Status</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Lines, ICTs and transformers by region and type · {refMonthLabel} column shows commissioning expected by reference month</p>
        </div>
        <ViewBreakupBtn onClick={onViewBreakup} />
      </div>
      <div className="overflow-auto" style={{ maxHeight: '58vh' }}>
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-20">
            <tr className="bg-slate-100 text-slate-700 text-[10px] border-b border-slate-200">
              <th className="sticky left-0 z-30 bg-slate-100 px-3 py-2 text-left font-bold border-r border-slate-200" style={{ minWidth: 76 }}>Region</th>
              <th className="px-3 py-2 text-left font-bold border-r border-slate-200" style={{ minWidth: 220 }}>Element Type</th>
              <th colSpan={2} className="px-3 py-1 text-center font-bold bg-emerald-50 text-emerald-700 border-r border-emerald-200 whitespace-nowrap">FTC Completed</th>
              <th colSpan={2} className="px-3 py-1 text-center font-bold bg-amber-50 text-amber-700 border-r border-amber-200 whitespace-nowrap">FTC Pending</th>
              <th colSpan={2} className="px-3 py-1 text-center font-bold bg-blue-50 text-blue-700 border-r border-blue-200 whitespace-nowrap">Commissioning Expected ({refMonthLabel})</th>
            </tr>
            <tr className="text-[10px] bg-slate-50">
              <th className="sticky left-0 z-30 bg-slate-50 border-r border-slate-200" />
              <th className="bg-slate-50 border-r border-slate-200" />
              <th className="px-3 py-1 text-right font-semibold bg-emerald-100 text-emerald-700 border-r border-emerald-200 whitespace-nowrap">No. of Elements</th>
              <th className="px-3 py-1 text-right font-semibold bg-emerald-50 text-emerald-500 border-r border-slate-200 whitespace-nowrap">ckt km / MVA</th>
              <th className="px-3 py-1 text-right font-semibold bg-amber-100 text-amber-700 border-r border-amber-200 whitespace-nowrap">No. of Elements</th>
              <th className="px-3 py-1 text-right font-semibold bg-amber-50 text-amber-500 border-r border-slate-200 whitespace-nowrap">ckt km / MVA</th>
              <th className="px-3 py-1 text-right font-semibold bg-blue-100 text-blue-700 border-r border-blue-200 whitespace-nowrap">No. of Elements</th>
              <th className="px-3 py-1 text-right font-semibold bg-blue-50 text-blue-500 whitespace-nowrap">ckt km / MVA</th>
            </tr>
          </thead>
          <tbody>
            {transmissionRows.map((row, i) => {
              const prev = transmissionRows[i - 1];
              const sameRegion = prev && prev.region === row.region;
              const isLine = row.category.startsWith('LINE');
              const completedVal = isLine ? row.completedKm  : row.completedMva;
              const pendingVal   = isLine ? row.pendingKm    : row.pendingMva;
              const expectedVal  = isLine ? row.expectedKm   : row.expectedMva;
              return (
                <tr key={i} className="border-t border-gray-100 bg-white hover:bg-amber-50/20 transition-colors">
                  <td className="px-3 py-2 sticky left-0 bg-white border-r border-gray-200 z-10">
                    {!sameRegion && <Chip label={row.region} colorCls={REGION_BADGE[row.region]} />}
                  </td>
                  <td className="px-3 py-2 text-foreground border-r border-gray-100">
                    {CAT_LABELS[row.category] ?? row.category}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums bg-emerald-50/30 text-emerald-800 font-semibold border-r border-emerald-100">
                    {row.completedCount || '0'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums bg-emerald-50/20 text-emerald-700 border-r border-slate-200">
                    {fmt(completedVal)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums bg-amber-50/30 text-amber-800 font-semibold border-r border-amber-100">
                    {row.pendingCount || '0'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums bg-amber-50/20 text-amber-700 border-r border-slate-200">
                    {fmt(pendingVal)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums bg-blue-50/30 text-blue-800 font-semibold border-r border-blue-100">
                    {row.expectedCount || '0'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums bg-blue-50/20 text-blue-700">
                    {fmt(expectedVal)}
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

// ── Table 4 — Hybrid Breakdown ────────────────────────────────────────────────

function HybridBreakdownTable({ hybridRows, refMonthLabel = 'Expected', onViewBreakup }) {
  if (!hybridRows?.length) return <Empty />;

  // Pre-compute rowSpans so the Region and Hybrid Type cells merge across
  // consecutive rows that share the same value (visual clarity, like Excel).
  // For each row we record:
  //   regionSpan  — how many consecutive rows (including this one) share the
  //                 same region; 0 means "skip this cell, it was already
  //                 merged into an earlier row".
  //   hybridSpan  — same for (region, hybridType).
  const spans = hybridRows.map(() => ({ regionSpan: 0, hybridSpan: 0 }));
  for (let i = 0; i < hybridRows.length; i++) {
    const row = hybridRows[i];
    if (i === 0 || hybridRows[i - 1].region !== row.region) {
      let n = 1;
      while (i + n < hybridRows.length && hybridRows[i + n].region === row.region) n++;
      spans[i].regionSpan = n;
    }
    if (i === 0
        || hybridRows[i - 1].region !== row.region
        || hybridRows[i - 1].hybridType !== row.hybridType) {
      let n = 1;
      while (i + n < hybridRows.length
             && hybridRows[i + n].region === row.region
             && hybridRows[i + n].hybridType === row.hybridType) n++;
      spans[i].hybridSpan = n;
    }
  }

  return (
    <div className="rounded-xl border overflow-hidden shadow-sm">
      <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700">Total Hybrid Capacity Details Under FTC / TOC / COD (MW)</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Hybrid projects split by constituent source components (Wind, Solar, BESS)</p>
        </div>
        <ViewBreakupBtn onClick={onViewBreakup} />
      </div>
      <div className="overflow-auto" style={{ maxHeight: '58vh' }}>
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-20">
            <tr className="bg-slate-100 text-slate-700 text-[10px] border-b border-slate-200">
              <th className="sticky left-0 z-30 bg-slate-100 px-3 py-2 text-left font-bold border-r border-slate-200 whitespace-nowrap" style={{ minWidth: 76 }}>Region</th>
              <th className="px-3 py-2 text-left font-bold border-r border-slate-200 whitespace-nowrap" style={{ minWidth: 180 }}>Hybrid Type</th>
              <th className="px-3 py-2 text-left font-bold border-r border-slate-200 whitespace-nowrap">Source</th>
              <th className="px-3 py-2 text-right font-bold border-r border-slate-200 whitespace-nowrap">Total (MW)</th>
              <th className="px-3 py-2 text-right font-bold border-r border-slate-200 whitespace-nowrap">Applied (MW)</th>
              <th className="px-3 py-2 text-right font-bold bg-blue-100 text-blue-700 border-r border-blue-200 whitespace-nowrap">FTC Approved</th>
              <th className="px-3 py-2 text-right font-bold bg-violet-100 text-violet-700 border-r border-violet-200 whitespace-nowrap">TOC Issued</th>
              <th className="px-3 py-2 text-right font-bold bg-emerald-100 text-emerald-700 border-r border-emerald-200 whitespace-nowrap">COD Done</th>
              <th className="px-3 py-2 text-right font-bold bg-amber-100 text-amber-700 whitespace-nowrap">{refMonthLabel}</th>
            </tr>
          </thead>
          <tbody>
            {hybridRows.map((row, i) => {
              const { regionSpan, hybridSpan } = spans[i];
              // Divider between region groups (heavier border on the row that
              // starts a NEW region — makes the merged blocks visually distinct)
              const rowBorder = regionSpan > 0 && i > 0
                ? 'border-t-2 border-slate-300'
                : 'border-t border-slate-100';
              return (
                <tr key={i} className={`${rowBorder} bg-white hover:bg-teal-50/20 transition-colors`}>
                  {regionSpan > 0 && (
                    <td
                      rowSpan={regionSpan}
                      className="px-3 py-2 sticky left-0 bg-slate-50/60 border-r border-slate-200 z-10 align-top"
                    >
                      <Chip label={row.region} colorCls={REGION_BADGE[row.region]} />
                    </td>
                  )}
                  {hybridSpan > 0 && (
                    <td
                      rowSpan={hybridSpan}
                      className="px-3 py-2 border-r border-slate-200 text-foreground align-top bg-white"
                    >
                      <span className="font-semibold text-[11px]">{row.hybridType}</span>
                    </td>
                  )}
                  <td className="px-3 py-2 border-r border-gray-100">
                    <Chip label={row.sourceType} colorCls={SOURCE_BADGE[row.sourceType]} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums border-r border-gray-100">{fmt(row.totalMw)}</td>
                  <td className="px-3 py-2 text-right tabular-nums border-r border-gray-100">{fmt(row.appliedMw)}</td>
                  <td className="px-3 py-2 text-right tabular-nums bg-blue-50/30 text-blue-800 border-r border-blue-100">{fmt(row.ftcMw)}</td>
                  <td className="px-3 py-2 text-right tabular-nums bg-violet-50/30 text-violet-800 border-r border-violet-100">{fmt(row.tocMw)}</td>
                  <td className="px-3 py-2 text-right tabular-nums bg-emerald-50/30 text-emerald-800 border-r border-emerald-100">{fmt(row.codMw)}</td>
                  <td className="px-3 py-2 text-right tabular-nums bg-amber-50/30 text-amber-800">{fmt(row.expectedMw)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Table 6 — Monthly COD (compact matrix like Excel) ─────────────────────────

function MonthlyCodeTable({ monthlyCod, onViewBreakup }) {
  const { rows, months } = monthlyCod ?? {};
  if (!rows?.length || !months?.length) return <Empty />;

  // Build All India totals per month per source
  const allIndia = (row, month) => REGION_ORDER.reduce((s, r) => s + (row.byRegion?.[r]?.[month] ?? 0), 0);

  return (
    <div className="space-y-5">
      {months.map((month, monthIdx) => {
        const monthTotal = rows.reduce((s, r) => s + allIndia(r, month), 0);
        return (
          <div key={month} className="rounded-xl border overflow-hidden shadow-sm">
            {/* Section header */}
            <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-center justify-between gap-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700">
                COD Declared Capacity (MW) — {fmtMonth(month)}
              </p>
              <div className="flex items-center gap-2">
                {monthTotal > 0
                  ? <span className="text-[11px] font-bold bg-violet-100 text-violet-700 px-2.5 py-0.5 rounded border border-violet-200">{fmt(monthTotal)} MW All India</span>
                  : <span className="text-[10px] text-slate-500">No data for this month</span>}
                {/* Show the View Breakup button only on the first month's card —
                    it opens a single drawer that lists all month contributors. */}
                {monthIdx === 0 && <ViewBreakupBtn onClick={onViewBreakup} />}
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-slate-100 text-slate-700 text-[10px] border-b border-slate-200">
                    <th className="sticky left-0 z-20 bg-slate-100 px-4 py-2 text-left font-bold border-r border-slate-200 whitespace-nowrap" style={{ minWidth: 88 }}>Source</th>
                    {REGION_ORDER.map(r => (
                      <th key={r} className="px-4 py-2 text-right font-bold border-r border-slate-200 whitespace-nowrap">{r}</th>
                    ))}
                    <th className="px-4 py-2 text-right font-bold whitespace-nowrap bg-violet-50 text-violet-700 border-l border-violet-200">All India</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const ai = allIndia(row, month);
                    if (ai === 0 && !row.isTotal) return null;
                    return (
                      <tr key={i} className={`border-t border-gray-100 ${row.isTotal ? 'bg-slate-100 font-bold border-t-2 border-slate-300' : 'bg-white hover:bg-violet-50/20 transition-colors'}`}>
                        <td className={`px-4 py-2 sticky left-0 z-10 border-r border-gray-200 ${row.isTotal ? 'bg-slate-100' : 'bg-white'}`}>
                          {row.isTotal
                            ? <span className="font-black text-slate-600 uppercase text-[10px] tracking-widest">Total</span>
                            : <Chip label={row.source} colorCls={SOURCE_BADGE[row.source] ?? 'bg-muted text-foreground'} />}
                        </td>
                        {REGION_ORDER.map(r => {
                          const v = row.byRegion?.[r]?.[month] ?? 0;
                          return (
                            <td key={r} className={`px-4 py-2 text-right tabular-nums border-r border-gray-100 ${v > 0 ? 'text-violet-700 font-medium' : 'text-slate-300'}`}>
                              {v > 0 ? fmt(v) : '0'}
                            </td>
                          );
                        })}
                        <td className={`px-4 py-2 text-right tabular-nums font-bold ${ai > 0 ? 'text-violet-800 bg-violet-50/30' : 'text-slate-300'}`}>
                          {ai > 0 ? fmt(ai) : '0'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Empty() {
  return (
    <div className="rounded-xl border bg-muted/20 p-12 text-center text-sm text-muted-foreground">
      No data to display. Add projects and commissioning phases to see the summary.
    </div>
  );
}

// ── Export toolbar ────────────────────────────────────────────────────────────
// Slim toolbar — only the export actions remain. The full filter UI (As-of date,
// Monthly COD range, Reference Month) is intentionally commented out below so it
// can be re-enabled with one toggle later; meanwhile the stat cards and tabs
// move up and the page needs less vertical scrolling.
//
// When re-enabling the full FilterBar, restore these imports at the top of the
// file:
//   import { useCallback } from 'react';
//   import { useRouter, useSearchParams } from 'next/navigation';
//   import { ChevronDown, FilterX } from 'lucide-react';
//   import { DatePicker } from '@/components/ui/date-picker';
//   import { MonthPicker } from '@/components/ui/month-picker';
// and also restore the DateField helper:
//
//   function DateField({ label, type, value, onChange }) {
//     return (
//       <div className="flex flex-col gap-1">
//         <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">{label}</label>
//         {type === 'month'
//           ? <MonthPicker value={value ?? ''} onChange={v => onChange(v || null)} className="h-9" />
//           : <DatePicker  value={value ?? ''} onChange={v => onChange(v || null)} className="h-9" />}
//       </div>
//     );
//   }
function FilterBar({ asOf, fromMonth, toMonth }) {
  const buildExportUrl = () => {
    const params = new URLSearchParams();
    if (asOf)      params.set('asOf',  asOf);
    if (fromMonth) params.set('from',  fromMonth);
    if (toMonth)   params.set('to',    toMonth);
    return `/api/grid/export?${params.toString()}`;
  };

  return (
    <div className="flex items-center justify-end gap-2">
      <a
        href={buildExportUrl()}
        download
        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors"
      >
        <Download className="size-3.5" />
        Download Excel
      </a>
      <a
        href={`/dashboard/print${asOf ? `?asOf=${asOf}` : ''}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold shadow-sm transition-colors"
      >
        <Download className="size-3.5" />
        Print / PDF
      </a>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Filters UI — TEMPORARILY HIDDEN. Re-enable by replacing the slim `FilterBar`
   above with this full implementation when the date filters are needed again.

function FilterBar({ asOf, fromMonth, toMonth }) {
  const router = useRouter();
  const sp     = useSearchParams();
  const [open, setOpen] = useState(false);
  const { settings, storeOption } = useSettings();
  const refMonth = settings.referenceMonth ?? '2026-04';

  const update = useCallback((key, value) => {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(key, value);
    else        params.delete(key);
    router.push(`/dashboard?${params.toString()}`);
  }, [router, sp]);

  const clearAll = () => router.push('/dashboard');
  const hasFilter = asOf || fromMonth || toMonth;

  const buildExportUrl = () => {
    const params = new URLSearchParams();
    if (asOf)      params.set('asOf',  asOf);
    if (fromMonth) params.set('from',  fromMonth);
    if (toMonth)   params.set('to',    toMonth);
    return `/api/grid/export?${params.toString()}`;
  };

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/40 transition-colors rounded-t-xl"
      >
        <svg className="size-3.5 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
        </svg>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Filters & Export</span>
        {hasFilter && (
          <span className="ml-1 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Active</span>
        )}
        <ChevronDown className={`size-4 text-muted-foreground ml-auto transition-transform duration-200 ${open ? '' : '-rotate-90'}`} />
      </button>

      {open && (
        <div className="border-t">
          <div className="flex flex-wrap items-end gap-4 px-4 py-3">
            <div className="flex flex-col gap-1">
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-0.5">Pipeline Snapshot</p>
              <div className="w-[180px]">
                <DateField label="As of Date" type="date" value={asOf} onChange={v => update('asOf', v)} />
              </div>
            </div>
            <div className="h-10 w-px bg-border self-end mb-1 hidden sm:block" />
            <div className="flex flex-col gap-1">
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-0.5">Monthly COD Range</p>
              <div className="flex items-end gap-2">
                <div className="w-[148px]">
                  <DateField label="From" type="month" value={fromMonth} onChange={v => update('from', v)} />
                </div>
                <span className="mb-2 text-muted-foreground text-sm">→</span>
                <div className="w-[148px]">
                  <DateField label="To" type="month" value={toMonth} onChange={v => update('to', v)} />
                </div>
              </div>
            </div>
            <div className="h-10 w-px bg-border self-end mb-1 hidden sm:block" />
            <div className="flex flex-col gap-1">
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-0.5">Expected Capacity Month</p>
              <div className="w-[148px]">
                <DateField label="Reference Month" type="month" value={refMonth} onChange={v => storeOption('referenceMonth', v || '2026-04')} />
              </div>
            </div>
            <div className="flex items-end gap-2 ml-auto pb-0.5">
              {hasFilter && (
                <button onClick={clearAll} className="flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                  <FilterX className="size-3.5" />Clear
                </button>
              )}
              <a href={buildExportUrl()} download className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors">
                <Download className="size-3.5" />Download Excel
              </a>
              <a
                href={`/dashboard/print${asOf ? `?asOf=${asOf}` : ''}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold shadow-sm transition-colors"
              >
                <Download className="size-3.5" />Print / PDF
              </a>
            </div>
          </div>
          {hasFilter && (
            <div className="flex flex-wrap gap-2 border-t bg-amber-50/50 px-4 py-2">
              {asOf && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-800">
                  <CalendarDays className="size-3" />
                  Pipeline as of {new Date(asOf + 'T00:00:00').toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}
                  <button onClick={() => update('asOf', null)} className="ml-0.5 hover:text-amber-900 font-bold">×</button>
                </span>
              )}
              {(fromMonth || toMonth) && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-[11px] font-medium text-blue-800">
                  <CalendarDays className="size-3" />
                  COD {fromMonth ? fmtMonth(fromMonth) : '…'} → {toMonth ? fmtMonth(toMonth) : '…'}
                  <button onClick={() => { const p = new URLSearchParams(sp.toString()); p.delete('from'); p.delete('to'); router.push(`/dashboard?${p.toString()}`); }} className="ml-0.5 hover:text-blue-900 font-bold">×</button>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
────────────────────────────────────────────────────────────────────────────── */

// ── Stat cards ─────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, unit = 'MW', color = 'blue' }) {
  const colors = {
    blue:    'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber:   'bg-amber-50 text-amber-600',
    violet:  'bg-violet-50 text-violet-600',
    rose:    'bg-rose-50 text-rose-600',
    slate:   'bg-slate-50 text-slate-600',
  };
  return (
    <div className="rounded-xl border bg-card p-4 flex items-start gap-3">
      <div className={`size-9 rounded-lg flex items-center justify-center shrink-0 ${colors[color]}`}>
        <Icon className="size-5" />
      </div>
      <div>
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className="text-xl font-bold text-foreground leading-tight">
          {typeof value === 'number' ? Math.round(value).toLocaleString('en-IN') : value}
          {unit && <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>}
        </p>
      </div>
    </div>
  );
}

// ── Main Client ───────────────────────────────────────────────────────────────

export function SummaryPageClient({
  regionLabel, asOf, fromMonth, toMonth,
  stats, table2Rows, table5Rows, contd4Study,
  transmissionRows, hybridRows, monthlyCod, projects, txElements,
}) {
  const [activeTab, setActiveTab] = useState('pipeline');
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const { settings } = useSettings();
  const refMonthLabel = fmtRefMonthShort(settings.referenceMonth);

  // The View-Breakup button now lives inside each table's section header
  // (only the 6 aggregating tabs render it).

  const tabs = [
    { id: 'pipeline',     label: 'FTC Pipeline',      icon: TrendingUp   },
    { id: 'contd4',       label: 'CONTD-4 Study',     icon: Layers       },
    { id: 'hybrid',       label: 'Hybrid Breakdown',  icon: GitBranch    },
    { id: 'sourcewise',   label: 'Source-wise',        icon: Grid3x3      },
    { id: 'transmission', label: 'Transmission',       icon: Cable        },
    { id: 'monthlycod',   label: 'Monthly COD',        icon: CalendarDays },
    { id: 'projects',     label: 'Project Details',   icon: ListTree     },
    { id: 'changes',      label: 'Day-wise Changes',  icon: History      },
  ];

  return (
    <div className="p-6 space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
            <BarChart3 className="size-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Generation &amp; Transmission Summary</h1>
            <p className="text-sm text-muted-foreground">
              {regionLabel}
              {asOf && <span className="ml-2 text-amber-600 font-medium">· As of {new Date(asOf).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}</span>}
            </p>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <FilterBar asOf={asOf} fromMonth={fromMonth} toMonth={toMonth} />

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard icon={Zap}        label="Applied for FTC" value={stats.totalApplied}  color="blue"    />
        <StatCard icon={TrendingUp} label="FTC Approved"    value={stats.totalFtc}      color="emerald" />
        <StatCard icon={BarChart3}  label="TOC Issued"      value={stats.totalToc}      color="amber"   />
        <StatCard icon={Zap}        label="COD Declared"    value={stats.totalCod}      color="violet"  />
        <StatCard icon={Layers}     label="Active CONTD-4"  value={stats.contd4Active}  unit="projects" color="rose"  />
        <StatCard icon={Cable}      label="Tx Pending FTC"  value={stats.txPending}     unit="elements" color="slate" />
      </div>

      {/* Tab bar */}
      <div className="border-b">
        <nav className="-mb-px flex gap-0 overflow-x-auto">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  active
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                }`}
              >
                <Icon className="size-3.5" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Per-tab Breakdown dialog — opened from the "View Breakup" button
          that now lives inside each table's section header. */}
      <TabBreakdown
        open={breakdownOpen}
        onOpenChange={setBreakdownOpen}
        activeTab={activeTab}
        projects={projects}
        txElements={txElements}
        fromMonth={fromMonth}
        toMonth={toMonth}
      />

      {/* Tab content */}
      <div>
        {activeTab === 'pipeline' && (
          <PipelineTable
            rows={table2Rows}
            primaryKey="region"
            refMonthLabel={refMonthLabel}
            title="Total Generation Capacity Details Under FTC / TOC / COD (MW) — Region-wise"
            desc={`Capacity funnel: Applied → FTC Approved → TOC Issued → COD Declared. FTC Pending = actively under FTC process. | ${refMonthLabel} column = expectedApr26Mw field.`}
            onViewBreakup={() => setBreakdownOpen(true)}
          />
        )}

        {activeTab === 'contd4' && (
          <Contd4StudyTable contd4Study={contd4Study} onViewBreakup={() => setBreakdownOpen(true)} />
        )}

        {activeTab === 'hybrid' && (
          <HybridBreakdownTable hybridRows={hybridRows} refMonthLabel={refMonthLabel} onViewBreakup={() => setBreakdownOpen(true)} />
        )}

        {activeTab === 'sourcewise' && (
          <PipelineTable
            rows={table5Rows}
            primaryKey="source"
            refMonthLabel={refMonthLabel}
            title="Total Generation Capacity Details Under FTC / TOC / COD (MW) — Source-wise"
            desc="Same pipeline data pivoted: rows grouped by source type, each sub-row is a region."
            onViewBreakup={() => setBreakdownOpen(true)}
          />
        )}

        {activeTab === 'transmission' && (
          <TransmissionSummaryTable transmissionRows={transmissionRows} refMonthLabel={refMonthLabel} onViewBreakup={() => setBreakdownOpen(true)} />
        )}

        {activeTab === 'monthlycod' && (
          <MonthlyCodeTable monthlyCod={monthlyCod} onViewBreakup={() => setBreakdownOpen(true)} />
        )}

        {activeTab === 'projects' && (
          <ProjectDetailsTab projects={projects} refMonthLabel={refMonthLabel} />
        )}

        {activeTab === 'changes' && (
          <SnapshotCompareTab />
        )}
      </div>
    </div>
  );
}
