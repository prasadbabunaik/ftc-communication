'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BarChart3, GitBranch, Grid3x3, Layers, TrendingUp, Zap, Cable, CalendarDays, Download, History, ListTree, FileSpreadsheet, Printer } from 'lucide-react';
import { DatePicker } from '@/components/ui/date-picker';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { useSettings } from '@/providers/settings-provider';
import { SnapshotCompareTab } from '@/components/grid/SnapshotCompareTab';
import { ProjectDetailsTab } from '@/components/grid/ProjectDetailsTab';
import { TabBreakdown } from '@/components/grid/TabBreakdown';
import { AsOfDatePicker } from '@/components/grid/AsOfDatePicker';
import { RegionPicker } from '@/components/grid/RegionPicker';
import { SourcePicker } from '@/components/grid/SourcePicker';
import { LastChangesCard } from '@/components/grid/LastChangesCard';
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
  // Hover tooltips carry the full column titles from the source Google Sheet,
  // so the on-screen headers can stay short without losing detail.
  const expTooltip = refMonthLabel.startsWith('Exp.')
    ? `Expected Capacity (MW) to be commissioned by End of ${refMonthLabel.slice(5)}`
    : 'Expected Capacity (MW) to be commissioned by end of the reference month';
  return (
    <thead className="sticky top-[156px] lg:top-[166px] z-[8] text-[12px]">
      <tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
        <th rowSpan={2} title={isRegionPrimary ? undefined : 'Source (Type)'} className="sticky left-0 z-[6] bg-slate-100 px-4 py-3 text-left font-bold border-r border-slate-200 whitespace-nowrap" style={{ minWidth: 90 }}>
          {isRegionPrimary ? 'Region' : 'Source'}
        </th>
        <th rowSpan={2} title={isRegionPrimary ? 'Source (Type)' : undefined} className="sticky z-[6] bg-slate-100 px-4 py-3 text-left font-bold border-r border-slate-200 whitespace-nowrap" style={{ left: 90, minWidth: 96 }}>
          {isRegionPrimary ? 'Source' : 'Region'}
        </th>
        <th rowSpan={2} title="Total Installed Capacity (MW)" className="px-4 py-3 text-right font-bold border-r border-slate-200 whitespace-nowrap cursor-help">Total Cap (MW)</th>
        <th rowSpan={2} title="Total Capacity (MW) for which CONTD-4 issued" className="px-4 py-3 text-right font-bold border-r border-slate-200 whitespace-nowrap text-slate-400 cursor-help">CONTD-4 (MW)</th>
        <th rowSpan={2} title="Capacity (MW) applied for FTC" className="px-4 py-3 text-right font-bold border-r border-slate-200 whitespace-nowrap cursor-help">Applied (MW)</th>
        <th colSpan={2} className="px-4 py-2 text-center font-bold bg-blue-50 text-blue-700 border-r border-blue-200 whitespace-nowrap">FTC (MW)</th>
        <th colSpan={2} className="px-4 py-2 text-center font-bold bg-violet-50 text-violet-700 border-r border-violet-200 whitespace-nowrap">TOC (MW)</th>
        <th colSpan={2} className="px-4 py-2 text-center font-bold bg-emerald-50 text-emerald-700 border-r border-emerald-200 whitespace-nowrap">COD (MW)</th>
        <th rowSpan={2} title={expTooltip} className="px-4 py-3 text-center font-bold bg-amber-50 text-amber-700 border-l border-amber-200 whitespace-nowrap cursor-help">{refMonthLabel}</th>
      </tr>
      <tr className="text-[11px]">
        <th title="Capacity (MW) for which FTC approved" className="px-4 py-1.5 text-right font-semibold bg-blue-100 text-blue-700 border-r border-blue-200 whitespace-nowrap cursor-help">Approved</th>
        <th title="FTC Pending (MW)" className="px-4 py-1.5 text-right font-semibold bg-blue-50 text-blue-500 border-r border-slate-200 whitespace-nowrap cursor-help">Pending</th>
        <th title="TOC Issued (MW)" className="px-4 py-1.5 text-right font-semibold bg-violet-100 text-violet-700 border-r border-violet-200 whitespace-nowrap cursor-help">Issued</th>
        <th title="TOC Pending (MW)" className="px-4 py-1.5 text-right font-semibold bg-violet-50 text-violet-400 border-r border-slate-200 whitespace-nowrap cursor-help">Pending</th>
        <th title="COD Completed (MW)" className="px-4 py-1.5 text-right font-semibold bg-emerald-100 text-emerald-700 border-r border-emerald-200 whitespace-nowrap cursor-help">Done</th>
        <th title="COD Pending (MW)" className="px-4 py-1.5 text-right font-semibold bg-emerald-50 text-emerald-500 border-r border-slate-200 whitespace-nowrap cursor-help">Pending</th>
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

  const prevRow      = rows[i - 1];
  const prevPrimary  = prevRow ? (isRegionPrimary ? prevRow.region : prevRow.source) : null;
  // First row of a primary-group → emit the merged (rowSpan'd) primary cell here.
  // Subsequent rows in the same group → omit the primary cell entirely so the
  // spanning cell from the first row covers them visually.
  const isFirstInGroup = primary !== prevPrimary || isTotal;
  // Compute how many consecutive rows share this primary (only when first-in-group).
  // IMPORTANT: stop at the Total row — in region-primary view the All India
  // breakdown rows AND the Total row all carry region='All India', so without
  // this guard the first All India row's rowSpan would extend over the Total
  // row, steal its Region column, and shove its remaining cells one column to
  // the right (creating a phantom 13th column in the footer).
  let groupSize = 1;
  if (isFirstInGroup && !isTotal) {
    for (let j = i + 1; j < rows.length; j++) {
      if (rows[j].isTotal) break;
      const rPrim = isRegionPrimary ? rows[j].region : rows[j].source;
      if (rPrim !== primary) break;
      groupSize++;
    }
  }

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
    ? 'border-t border-slate-300 text-[13px] font-bold'
    : isSubtotal
    ? 'border-t border-slate-200 text-[13px]'
    : isFirstAllIndia
    ? 'border-t-2 border-slate-300 text-[13px] transition-colors'
    : isAllIndia
    ? 'border-t border-slate-200 text-[13px]'
    : 'border-t border-gray-100 hover:bg-blue-50/20 text-[13px] transition-colors';

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
        className={`px-4 py-2.5 text-right tabular-nums ${bold ? 'font-bold' : ''} ${cleanCls}`}
      >
        {fmt(v)}
      </td>
    );
  };

  // Region cell is rowSpan-merged and horizontally frozen (sticky left-0) so the
  // region/source label stays visible during horizontal scroll. No vertical
  // sticky — the table flows with the page.
  const regionTdStyle = cellStyle;
  return (
    <tr className={`${rowCls} ${bg}`}>
      {isFirstInGroup && (
        <td
          rowSpan={groupSize}
          style={regionTdStyle}
          className={`px-4 py-2.5 align-top text-center sticky left-0 border-r border-gray-200 z-[4] ${bg}`}
        >
          {isTotal
            ? <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest">Total</span>
            : isAllIndia
              ? <span className="text-[12px] font-bold text-slate-600">All India</span>
              : <Chip label={primary} colorCls={isRegionPrimary ? REGION_BADGE[primary] : SOURCE_BADGE[primary]} />}
        </td>
      )}
      <td
        style={{ ...cellStyle, left: 90 }}
        className={`px-4 py-2.5 sticky border-r border-gray-200 z-[4] ${bg}`}
      >
        {isTotal
          ? <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest">Total</span>
          : isSubtotal
          ? <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest">Subtotal</span>
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

  // Order: per-region detail first, then the All India summary, then the grand
  // total — everything in one naturally-scrolling body.
  const regionRows   = rows.filter((r) => !r.isAllIndiaBreakdown && !r.isTotal);
  const allIndiaRows  = rows.filter((r) => r.isAllIndiaBreakdown);
  const totalRow      = rows.find((r) => r.isTotal);
  const orderedRows   = [...regionRows, ...allIndiaRows, ...(totalRow ? [totalRow] : [])];

  return (
    <div className="rounded-xl border shadow-sm">
      {title && (
        <div className="bg-slate-50 border-b border-slate-200 px-4 py-2 flex items-start justify-between gap-3 shrink-0">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700">{title}</p>
            {desc && <p className="text-[10px] text-slate-500 mt-0.5">{desc}</p>}
          </div>
          <ViewBreakupBtn onClick={onViewBreakup} />
        </div>
      )}
      <div>
        <table className="w-full border-collapse">
          <PipelineHead isRegionPrimary={isRegionPrimary} refMonthLabel={refMonthLabel} />
          <tbody>
            {orderedRows.map((row, i) => (
              <PipelineRow key={i} row={row} i={i} rows={orderedRows} isRegionPrimary={isRegionPrimary} />
            ))}
          </tbody>
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
        className={`px-3 py-2 sticky left-0 z-[4] border-r border-gray-200 ${bg}`}
      >
        {!sameRegion && !isSubtotal && !isTotal && !isAllIndiaBreakdown && <Chip label={row.region} colorCls={REGION_BADGE[row.region]} />}
        {isFirstAllIndiaBreakdown && <span className="text-[11px] font-bold text-slate-600">All India</span>}
      </td>
      <td
        style={{ ...cellStyle, left: 76 }}
        className={`px-3 py-2 sticky z-[4] border-r border-gray-200 ${bg}`}
      >
        {isSubtotal || isTotal
          ? <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Total</span>
          : <Chip label={CONTD4_SOURCE_LABEL[row.source] ?? row.source} colorCls={SOURCE_BADGE[row.source]} />}
      </td>
      {/* Numeric cells are centered (not right-aligned) and a notch larger so
          the wide columns read as filled rather than empty. */}
      <td
        style={cellStyle}
        className={`px-3 py-2 text-center text-[13px] tabular-nums border-r border-gray-100 ${bg} ${Number(row.totalMw) > 0 ? '' : 'text-slate-300'}`}
      >
        {fmt(row.totalMw)}
      </td>
      {allMonths.map(m => {
        const v = row.months?.[m] ?? 0;
        return (
          <td
            key={m}
            style={cellStyle}
            className={`px-3 py-2 text-center text-[13px] tabular-nums border-r border-gray-100 ${bg} ${v > 0 ? 'text-blue-700' : 'text-slate-300'}`}
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

  // Per-region detail first, then the All India summary, then grand total —
  // one naturally-scrolling body.
  const regionRows  = rows.filter(r => !r.isAllIndiaBreakdown && !r.isTotal);
  const allIndiaRows = rows.filter(r => r.isAllIndiaBreakdown);
  const totalRow     = rows.find(r => r.isTotal);
  const orderedRows  = [...regionRows, ...allIndiaRows, ...(totalRow ? [totalRow] : [])];

  return (
    <div className="rounded-xl border shadow-sm">
      <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700">Total Capacity (MW) Under CONTD-4 Study</p>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Active (Under Process) applications — expected completion by month
            {carriedTotal > 0 && referenceMonth && (
              <span className="ml-2 inline-flex items-center gap-1 text-amber-700 font-medium">
                · {fmt(carriedTotal)} MW carried forward into {fmtMonth(referenceMonth)}
              </span>
            )}
          </p>
        </div>
        <ViewBreakupBtn onClick={onViewBreakup} />
      </div>
      <div>
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-[156px] lg:top-[166px] z-[8]">
            <tr className="bg-slate-100 text-slate-700 text-[10px] border-b border-slate-200">
              <th className="sticky left-0 z-[6] bg-slate-100 px-3 py-2 text-left font-bold border-r border-slate-200 whitespace-nowrap" style={{ minWidth: 76 }}>Region</th>
              <th className="sticky z-[6] bg-slate-100 px-3 py-2 text-left font-bold border-r border-slate-200 whitespace-nowrap" style={{ left: 76, minWidth: 200 }}>Source</th>
              <th className="px-3 py-2 text-center font-bold border-r border-slate-200 whitespace-nowrap">Total Cap (MW)</th>
              {allMonths.map(m => (
                <th key={m} className="px-3 py-2 text-center font-bold border-r border-blue-200 whitespace-nowrap bg-blue-50 text-blue-700" style={{ minWidth: 110 }}>
                  {fmtMonth(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orderedRows.map((row, i) => (
              <Contd4Row key={i} row={row} prev={orderedRows[i - 1]} allMonths={allMonths}
                isAllIndiaSection={row.isAllIndiaBreakdown || row.isTotal}
                isFirstAllIndiaBreakdown={row.isAllIndiaBreakdown && !orderedRows[i - 1]?.isAllIndiaBreakdown} />
            ))}
          </tbody>
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
    <div className="rounded-xl border shadow-sm">
      <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700">Transmission Elements — FTC Status</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Lines, ICTs and transformers by region and type · {refMonthLabel} column shows commissioning expected by reference month</p>
        </div>
        <ViewBreakupBtn onClick={onViewBreakup} />
      </div>
      <div>
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-[156px] lg:top-[166px] z-[8]">
            <tr className="bg-slate-100 text-slate-700 text-[10px] border-b border-slate-200">
              <th className="sticky left-0 z-[6] bg-slate-100 px-3 py-2 text-left font-bold border-r border-slate-200" style={{ minWidth: 76 }}>Region</th>
              <th className="px-3 py-2 text-left font-bold border-r border-slate-200" style={{ minWidth: 220 }}>Element Type</th>
              <th colSpan={2} className="px-3 py-1 text-center font-bold bg-emerald-50 text-emerald-700 border-r border-emerald-200 whitespace-nowrap">FTC Completed</th>
              <th colSpan={2} className="px-3 py-1 text-center font-bold bg-amber-50 text-amber-700 border-r border-amber-200 whitespace-nowrap">FTC Pending</th>
              <th colSpan={2} className="px-3 py-1 text-center font-bold bg-blue-50 text-blue-700 border-r border-blue-200 whitespace-nowrap">Commissioning Expected ({refMonthLabel})</th>
            </tr>
            <tr className="text-[10px] bg-slate-50">
              <th className="sticky left-0 z-[6] bg-slate-50 border-r border-slate-200" />
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
                  <td className="px-3 py-2 sticky left-0 bg-white border-r border-gray-200 z-[4]">
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

// Order the All India per-source totals exactly like the Google Sheet's
// hybrid summary footer: Solar, Wind, BESS, PSP. Other sources fall after
// these but should never appear in practice for hybrid breakdowns.
const HYBRID_SRC_ORDER = ['SOLAR', 'WIND', 'BESS', 'PSP'];

// Take the matrix from computeHybridBreakdown and produce a flat list of
// display rows, mirroring the Google Sheet's hybrid summary structure:
//
//   <region> × <hybridType> per-component rows
//   "Total <Region> <Source>" subtotal per source within each region
//   "Grand Total" per region
//   "Total <Source>" All India per-source rows
//   "Grand Total" All India
//
// Each emitted row carries a `kind` so the renderer can style it appropriately.
function buildHybridDisplayRows(rows) {
  const out = [];
  const sumFields = (acc, r) => {
    for (const f of ['totalMw','contd4Mw','appliedMw','ftcMw','tocMw','codMw','expectedMw']) {
      acc[f] = (acc[f] || 0) + (Number(r[f]) || 0);
    }
    return acc;
  };

  // Group rows by region (keep stable region order from input — assumed sorted).
  const regions = [];
  const byRegion = new Map();
  for (const r of rows) {
    if (!byRegion.has(r.region)) { byRegion.set(r.region, []); regions.push(r.region); }
    byRegion.get(r.region).push(r);
  }

  // Cross-region accumulator for the All India footer.
  const allIndiaBySrc = {};
  let allIndiaGrand = {};

  for (const region of regions) {
    const regionRows = byRegion.get(region);

    // Within a region, sub-group by hybrid type for the per-type rows.
    const types = [];
    const byType = new Map();
    for (const r of regionRows) {
      if (!byType.has(r.hybridType)) { byType.set(r.hybridType, []); types.push(r.hybridType); }
      byType.get(r.hybridType).push(r);
    }
    for (const ht of types) {
      for (const r of byType.get(ht)) out.push({ kind: 'data', ...r });
    }

    // Per-source subtotals within this region.
    const bySrc = {};
    for (const r of regionRows) {
      bySrc[r.sourceType] = sumFields(bySrc[r.sourceType] || {}, r);
    }
    const orderedSrcs = HYBRID_SRC_ORDER.filter((s) => bySrc[s])
      .concat(Object.keys(bySrc).filter((s) => !HYBRID_SRC_ORDER.includes(s)));
    for (const s of orderedSrcs) {
      out.push({ kind: 'subtotal', region, sourceType: s, label: `Total ${s.charAt(0) + s.slice(1).toLowerCase()}`, ...bySrc[s] });
      allIndiaBySrc[s] = sumFields(allIndiaBySrc[s] || {}, bySrc[s]);
    }

    // Region grand total.
    const regionGrand = regionRows.reduce(sumFields, {});
    out.push({ kind: 'regionTotal', region, label: 'Grand Total', ...regionGrand });
    allIndiaGrand = sumFields(allIndiaGrand, regionGrand);
  }

  // All India per-source rows + grand total.
  const allOrderedSrcs = HYBRID_SRC_ORDER.filter((s) => allIndiaBySrc[s])
    .concat(Object.keys(allIndiaBySrc).filter((s) => !HYBRID_SRC_ORDER.includes(s)));
  for (const s of allOrderedSrcs) {
    out.push({ kind: 'allIndiaSource', sourceType: s, label: `Total ${s.charAt(0) + s.slice(1).toLowerCase()}`, ...allIndiaBySrc[s] });
  }
  out.push({ kind: 'allIndiaGrand', label: 'Grand Total', ...allIndiaGrand });

  return out;
}

function HybridBreakdownTable({ hybridRows, refMonthLabel = 'Expected', onViewBreakup }) {
  if (!hybridRows?.length) return <Empty />;

  const display = buildHybridDisplayRows(hybridRows);

  // Compute the rowSpans for Region and Hybrid Type cells across the data
  // rows + subtotals + region total inside a single region block. Subtotal
  // and regionTotal rows occupy the region column but skip the hybrid-type
  // column (we render a label in the source slot instead).
  const regionSpans = new Map(); // index of first row in region → span
  const typeSpans   = new Map(); // index of first row in (region,type) → span
  for (let i = 0; i < display.length; i++) {
    const r = display[i];
    if (r.kind === 'allIndiaSource' || r.kind === 'allIndiaGrand') continue;
    const prev = display[i - 1];
    if (!prev || prev.region !== r.region || prev.kind === 'allIndiaGrand' || prev.kind === 'allIndiaSource') {
      let n = 0;
      for (let j = i; j < display.length; j++) {
        if (display[j].region === r.region && display[j].kind !== 'allIndiaSource' && display[j].kind !== 'allIndiaGrand') n++;
        else break;
      }
      regionSpans.set(i, n);
    }
    if (r.kind === 'data' && (!prev || prev.region !== r.region || prev.hybridType !== r.hybridType)) {
      let n = 0;
      for (let j = i; j < display.length; j++) {
        if (display[j].kind === 'data' && display[j].region === r.region && display[j].hybridType === r.hybridType) n++;
        else break;
      }
      typeSpans.set(i, n);
    }
  }

  const renderNumCells = (r) => (
    <>
      <td className="px-3 py-2 text-right tabular-nums border-r border-gray-100">{fmt(r.totalMw)}</td>
      <td className="px-3 py-2 text-right tabular-nums border-r border-gray-100">{fmt(r.contd4Mw)}</td>
      <td className="px-3 py-2 text-right tabular-nums border-r border-gray-100">{fmt(r.appliedMw)}</td>
      <td className="px-3 py-2 text-right tabular-nums bg-blue-50/30 text-blue-800 border-r border-blue-100">{fmt(r.ftcMw)}</td>
      <td className="px-3 py-2 text-right tabular-nums bg-violet-50/30 text-violet-800 border-r border-violet-100">{fmt(r.tocMw)}</td>
      <td className="px-3 py-2 text-right tabular-nums bg-emerald-50/30 text-emerald-800 border-r border-emerald-100">{fmt(r.codMw)}</td>
      <td className="px-3 py-2 text-right tabular-nums bg-amber-50/30 text-amber-800">{fmt(r.expectedMw)}</td>
    </>
  );

  return (
    <div className="rounded-xl border shadow-sm">
      <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700">Total Hybrid Capacity Details Under FTC / TOC / COD (MW)</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Hybrid projects split by constituent source components (Solar / Wind / BESS / PSP) with per-region subtotals + All India footer.</p>
        </div>
        <ViewBreakupBtn onClick={onViewBreakup} />
      </div>
      <div>
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-[156px] lg:top-[166px] z-[8]">
            <tr className="bg-slate-100 text-slate-700 text-[10px] border-b border-slate-200">
              <th className="sticky left-0 z-[6] bg-slate-100 px-3 py-2 text-left font-bold border-r border-slate-200 whitespace-nowrap" style={{ minWidth: 76 }}>Region</th>
              <th className="px-3 py-2 text-left font-bold border-r border-slate-200 whitespace-nowrap" style={{ minWidth: 220 }}>Hybrid Type</th>
              <th className="px-3 py-2 text-left font-bold border-r border-slate-200 whitespace-nowrap">Source (Type)</th>
              <th className="px-3 py-2 text-right font-bold border-r border-slate-200 whitespace-nowrap">Total Capacity (MW)</th>
              <th className="px-3 py-2 text-right font-bold border-r border-slate-200 whitespace-nowrap">Total CONTD-4 (MW)</th>
              <th className="px-3 py-2 text-right font-bold border-r border-slate-200 whitespace-nowrap">Applied for FTC</th>
              <th className="px-3 py-2 text-right font-bold bg-blue-100 text-blue-700 border-r border-blue-200 whitespace-nowrap">FTC Approved</th>
              <th className="px-3 py-2 text-right font-bold bg-violet-100 text-violet-700 border-r border-violet-200 whitespace-nowrap">TOC Issued</th>
              <th className="px-3 py-2 text-right font-bold bg-emerald-100 text-emerald-700 border-r border-emerald-200 whitespace-nowrap">COD Completed</th>
              <th className="px-3 py-2 text-right font-bold bg-amber-100 text-amber-700 whitespace-nowrap">{refMonthLabel}</th>
            </tr>
          </thead>
          <tbody>
            {display.map((r, i) => {
              if (r.kind === 'data') {
                return (
                  <tr key={i} className="border-t border-slate-100 bg-white hover:bg-teal-50/20 transition-colors">
                    {regionSpans.has(i) && (
                      <td rowSpan={regionSpans.get(i)} className="px-3 py-2 sticky left-0 bg-slate-50/60 border-r border-slate-200 z-[4] align-top">
                        <Chip label={r.region} colorCls={REGION_BADGE[r.region]} />
                      </td>
                    )}
                    {typeSpans.has(i) && (
                      <td rowSpan={typeSpans.get(i)} className="px-3 py-2 border-r border-slate-200 text-foreground align-top bg-white">
                        <span className="font-semibold text-[11px]">{r.hybridType}</span>
                      </td>
                    )}
                    <td className="px-3 py-2 border-r border-gray-100">
                      <Chip label={r.sourceType} colorCls={SOURCE_BADGE[r.sourceType]} />
                    </td>
                    {renderNumCells(r)}
                  </tr>
                );
              }
              if (r.kind === 'subtotal') {
                return (
                  <tr key={i} className="border-t border-slate-200 bg-slate-50/70 font-semibold">
                    {regionSpans.has(i) && (
                      <td rowSpan={regionSpans.get(i)} className="px-3 py-2 sticky left-0 bg-slate-50/60 border-r border-slate-200 z-[4] align-top">
                        <Chip label={r.region} colorCls={REGION_BADGE[r.region]} />
                      </td>
                    )}
                    <td colSpan={2} className="px-3 py-2 border-r border-slate-200 text-right text-slate-700">{r.label}</td>
                    {renderNumCells(r)}
                  </tr>
                );
              }
              if (r.kind === 'regionTotal') {
                return (
                  <tr key={i} className="border-t border-slate-300 bg-slate-200 font-bold">
                    {regionSpans.has(i) && (
                      <td rowSpan={regionSpans.get(i)} className="px-3 py-2 sticky left-0 bg-slate-50/60 border-r border-slate-200 z-[4] align-top">
                        <Chip label={r.region} colorCls={REGION_BADGE[r.region]} />
                      </td>
                    )}
                    <td colSpan={2} className="px-3 py-2 border-r border-slate-300 text-right text-slate-800 uppercase text-[10px] tracking-wide">{r.label}</td>
                    {renderNumCells(r)}
                  </tr>
                );
              }
              if (r.kind === 'allIndiaSource') {
                const bg = ALL_INDIA_SRC_BG[r.sourceType] ?? 'bg-slate-300';
                return (
                  <tr key={i} className={`border-t-2 border-slate-300 ${bg} font-bold text-slate-800`}>
                    <td className="px-3 py-2 sticky left-0 z-[4] align-top">
                      <span className="text-[10px] uppercase tracking-wide">All India</span>
                    </td>
                    <td colSpan={2} className="px-3 py-2 text-right text-[11px]">Total {r.sourceType.charAt(0) + r.sourceType.slice(1).toLowerCase()}</td>
                    {renderNumCells(r)}
                  </tr>
                );
              }
              // allIndiaGrand
              return (
                <tr key={i} className="border-t-2 border-amber-300 bg-amber-100 font-bold text-slate-900">
                  <td className="px-3 py-2 sticky left-0 z-[4] align-top">
                    <span className="text-[10px] uppercase tracking-wide">All India</span>
                  </td>
                  <td colSpan={2} className="px-3 py-2 text-right text-[11px] uppercase tracking-wide">Grand Total</td>
                  {renderNumCells(r)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Colour-coding the All India per-source totals like the Google Sheet's
// blue / orange / green / yellow stripes at the bottom of the hybrid sheet —
// kept as light tints (dark text) so the table stays soft on the eyes.
const ALL_INDIA_SRC_BG = {
  SOLAR: 'bg-orange-100',
  WIND:  'bg-blue-100',
  BESS:  'bg-emerald-100',
  PSP:   'bg-amber-100',
};

// ── FTC / TOC / COD Activity in a date range ──────────────────────────────────
// "How much FTC / TOC / COD happened between two dates" — milestone-date based.
// Rows = Region × Source; grouped columns FTC / TOC / COD (MW). Three stat cards
// on top show the in-range totals. Date pickers drive the `from` / `to` URL
// params (server recomputes via computeMilestoneActivity).

function ActivityDateRange({ from, to }) {
  const router = useRouter();
  const sp     = useSearchParams();

  const apply = ({ from: f, to: t }) => {
    const params = new URLSearchParams(sp.toString());
    if (f) params.set('from', f); else params.delete('from');
    if (t) params.set('to', t);   else params.delete('to');
    router.push(`/dashboard?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">Date range</span>
      <div className="w-[260px]">
        <DateRangePicker from={from ?? ''} to={to ?? ''} onChange={apply} className="h-9" />
      </div>
    </div>
  );
}

// Milestone metadata — drives the selector cards and the pivot's accent colour.
const MILESTONES = [
  { key: 'ftc', label: 'FTC Approved', short: 'FTC', color: 'emerald' },
  { key: 'toc', label: 'TOC Issued',   short: 'TOC', color: 'amber'   },
  { key: 'cod', label: 'COD Declared', short: 'COD', color: 'violet'  },
];
const MILE_ACCENT = {
  emerald: { head: 'bg-emerald-100 text-emerald-800', cell: 'text-emerald-700', total: 'text-emerald-900 bg-emerald-50/60', ring: 'ring-emerald-400 bg-emerald-50' },
  amber:   { head: 'bg-amber-100 text-amber-800',     cell: 'text-amber-700',   total: 'text-amber-900 bg-amber-50/60',     ring: 'ring-amber-400 bg-amber-50'   },
  violet:  { head: 'bg-violet-100 text-violet-800',   cell: 'text-violet-700',  total: 'text-violet-900 bg-violet-50/60',   ring: 'ring-violet-400 bg-violet-50'  },
};
// Title-case source labels matching the Source-wise sheet.
const SOURCE_LABEL = { WIND: 'Wind', SOLAR: 'Solar', BESS: 'BESS', HYBRID: 'Hybrid', COAL: 'Coal', HYDRO: 'Hydro', PSP: 'PSP' };
const COMP_LABEL   = { ...SOURCE_LABEL, PSP: 'PSP' };
// Component order inside a hybrid cell (largest families first, stable).
const COMP_ORDER = ['SOLAR', 'WIND', 'BESS', 'PSP', 'COAL', 'HYDRO'];

function ActivityStat({ label, value, count, color, active, onClick }) {
  const colors = {
    emerald: 'border-emerald-200 text-emerald-700',
    amber:   'border-amber-200 text-amber-700',
    violet:  'border-violet-200 text-violet-700',
  };
  const accent = MILE_ACCENT[color];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`text-left rounded-lg border px-4 py-3 transition-all ${colors[color]} ${active ? `ring-2 ${accent.ring} shadow-sm` : 'bg-white hover:bg-slate-50'}`}
    >
      <p className="text-[10px] font-bold uppercase tracking-wide opacity-80 flex items-center gap-1">
        {label} in range
        {active && <span className="text-[8px] font-black px-1 py-px rounded bg-current/10">SHOWN</span>}
      </p>
      <p className="text-2xl font-black leading-tight tabular-nums">{fmt(value)} <span className="text-xs font-semibold opacity-70">MW</span></p>
      <p className="text-[10px] opacity-70">{count} milestone{count === 1 ? '' : 's'}</p>
    </button>
  );
}

// Pivot view matching the "Inter-State <Milestone> Capacity (MW)" sheet:
// Source rows × Region columns (+ All India), a Total row, and the Hybrid row
// showing its per-component split inside each cell. A milestone selector
// (the three cards) switches which of FTC / TOC / COD the grid shows.
function MilestoneActivityTable({ activity, from, to, onViewBreakup, selectedRegions = [], selectedSources = [] }) {
  const { matrix, totals } = activity ?? {};
  const [milestone, setMilestone] = useState('cod'); // default COD (matches the sheet)
  const meta   = MILESTONES.find(m => m.key === milestone);
  const accent = MILE_ACCENT[meta.color];

  const fmtRange = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '…';

  // Cell value + hybrid component split, read straight from the region|source matrix.
  const cell  = (source, region) => matrix?.[`${region}|${source}`]?.[milestone] ?? 0;
  const comps = (region) => {
    const c = matrix?.[`${region}|HYBRID`]?.components?.[milestone] ?? {};
    return Object.entries(c)
      .filter(([, mw]) => mw > 0)
      .sort((a, b) => (COMP_ORDER.indexOf(a[0]) - COMP_ORDER.indexOf(b[0])));
  };

  // Show every source row / region column by default, or narrow to the active
  // dashboard filters so this tab honours them like the others.
  const regions = selectedRegions.length ? REGION_ORDER.filter(r => selectedRegions.includes(r)) : REGION_ORDER;
  const sources = selectedSources.length ? SOURCE_ORDER.filter(s => selectedSources.includes(s)) : SOURCE_ORDER;

  const rowTotal = (source) => regions.reduce((s, reg) => s + cell(source, reg), 0);
  const colTotal = (region) => sources.reduce((s, src) => s + cell(src, region), 0);
  const grand    = totals?.[milestone] ?? 0;

  const hasAny = grand > 0 || (totals?.ftc ?? 0) > 0 || (totals?.toc ?? 0) > 0 || (totals?.cod ?? 0) > 0;

  return (
    <div className="space-y-3">
      {/* Controls: date range + breakup */}
      <div className="flex flex-wrap items-end justify-between gap-3 shrink-0">
        <ActivityDateRange from={from} to={to} />
        <ViewBreakupBtn onClick={onViewBreakup} />
      </div>

      {/* Three totals double as the milestone selector */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 shrink-0">
        {MILESTONES.map(m => (
          <ActivityStat
            key={m.key}
            label={m.label}
            value={totals?.[m.key] ?? 0}
            count={totals?.[`${m.key}Count`] ?? 0}
            color={m.color}
            active={milestone === m.key}
            onClick={() => setMilestone(m.key)}
          />
        ))}
      </div>

      <div className="rounded-xl border shadow-sm">
        <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700">
              Inter-State {meta.label} Capacity (MW) — {fmtRange(from)} → {fmtRange(to)}
            </p>
            <p className="text-[10px] text-slate-500">
              Source × Region. Capacity whose <span className="font-semibold">{meta.short}</span> milestone date falls in the range — click a card above to switch milestone.
            </p>
          </div>
        </div>
        <div>
          {!hasAny ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No FTC / TOC / COD milestones in this date range.</div>
          ) : (
            <table className="w-full border-collapse text-[11px]">
              <thead className="sticky top-[156px] lg:top-[166px] z-[8]">
                <tr className={`text-[10px] border-b border-slate-300 ${accent.head}`}>
                  <th className="sticky left-0 z-[5] px-4 py-2 text-left font-bold border-r border-slate-300 whitespace-nowrap bg-inherit">Source</th>
                  {regions.map(reg => (
                    <th key={reg} className="px-4 py-2 text-center font-bold border-r border-slate-300/60 whitespace-nowrap">{reg}</th>
                  ))}
                  <th className="px-4 py-2 text-center font-black whitespace-nowrap">All India</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((src) => {
                  const isHybrid = src === 'HYBRID';
                  return (
                    <tr key={src} className="border-t border-gray-100 bg-white hover:bg-slate-50/60 transition-colors align-top">
                      <td className="px-4 py-2 sticky left-0 z-[4] bg-white border-r border-gray-200">
                        <Chip label={SOURCE_LABEL[src] ?? src} colorCls={SOURCE_BADGE[src] ?? 'bg-muted text-foreground'} />
                      </td>
                      {regions.map(reg => {
                        const v = cell(src, reg);
                        const breakdown = isHybrid ? comps(reg) : [];
                        return (
                          <td key={reg} className={`px-4 py-2 text-center tabular-nums border-r border-gray-100 ${v > 0 ? `${accent.cell} font-medium` : 'text-slate-300'}`}>
                            {breakdown.length > 0 ? (
                              <div className="flex flex-col items-center gap-0.5 leading-tight">
                                {breakdown.map(([c, mw]) => (
                                  <span key={c} className="whitespace-nowrap text-[10px]">{fmt(mw)} <span className="text-slate-400">–</span> {COMP_LABEL[c] ?? c}</span>
                                ))}
                              </div>
                            ) : (v > 0 ? fmt(v) : '0')}
                          </td>
                        );
                      })}
                      <td className={`px-4 py-2 text-center tabular-nums font-bold ${rowTotal(src) > 0 ? accent.cell : 'text-slate-300'}`}>{fmt(rowTotal(src))}</td>
                    </tr>
                  );
                })}
                <tr className="bg-slate-100 font-bold border-t-2 border-slate-300">
                  <td className="px-4 py-2 sticky left-0 z-[4] bg-slate-100 border-r border-gray-200">
                    <span className="font-black text-slate-600 uppercase text-[10px] tracking-widest">Total</span>
                  </td>
                  {regions.map(reg => (
                    <td key={reg} className={`px-4 py-2 text-center tabular-nums border-r border-gray-200 ${accent.total}`}>{fmt(colTotal(reg))}</td>
                  ))}
                  <td className={`px-4 py-2 text-center tabular-nums font-black ${accent.total}`}>{fmt(grand)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
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
function FilterBar({ asOf }) {
  const buildExportUrl = () => {
    const params = new URLSearchParams();
    if (asOf) params.set('asOf', asOf);
    return `/api/grid/export?${params.toString()}`;
  };

  return (
    <div className="flex items-center gap-2">
      <a
        href={buildExportUrl()}
        download
        title="Download as Excel"
        className="inline-flex items-center justify-center size-11 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors"
      >
        <FileSpreadsheet className="size-5" />
      </a>
      <a
        href={`/dashboard/print${asOf ? `?asOf=${asOf}` : ''}`}
        target="_blank"
        rel="noopener noreferrer"
        title="Open print / PDF view"
        className="inline-flex items-center justify-center size-11 rounded-lg bg-slate-700 hover:bg-slate-800 text-white shadow-sm transition-colors"
      >
        <Printer className="size-5" />
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
    <div className="rounded-lg border bg-card px-3 py-2 flex items-center gap-2">
      <div className={`size-8 rounded-md flex items-center justify-center shrink-0 ${colors[color]}`}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide leading-tight truncate">{label}</p>
        <p className="text-base font-bold text-foreground leading-tight">
          {typeof value === 'number' ? Math.round(value).toLocaleString('en-IN') : value}
          {unit && <span className="text-[11px] font-normal text-muted-foreground ml-1">{unit}</span>}
        </p>
      </div>
    </div>
  );
}

// ── Main Client ───────────────────────────────────────────────────────────────

export function SummaryPageClient({
  regionLabel, asOf, activityFrom, activityTo,
  regions = [], selectedRegions = [], canFilterRegion = false,
  sources = [], selectedSources = [],
  stats, table2Rows, table5Rows, contd4Study,
  transmissionRows, hybridRows, activity, projects, txElements,
  availableSnapshots,
}) {
  const [activeTab, setActiveTab] = useState('pipeline');
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const { settings } = useSettings();
  const refMonthLabel = fmtRefMonthShort(settings.referenceMonth);

  // The View-Breakup button now lives inside each table's section header
  // (only the 6 aggregating tabs render it).

  const tabs = [
    // `tooltip` = the full table title from the source Google Sheet, shown on
    // hover so the tab labels themselves can stay short.
    { id: 'pipeline',     label: 'FTC Pipeline',      icon: TrendingUp,   tooltip: 'Total Generation Capacity Details Under FTC/TOC/COD (MW)' },
    { id: 'contd4',       label: 'CONTD-4 Study',     icon: Layers,       tooltip: 'Total Capacity (MW) Under CONTD-4 Study' },
    { id: 'hybrid',       label: 'Hybrid Breakdown',  icon: GitBranch,    tooltip: 'Total Hybrid Capacity Details Under FTC/TOC/COD (MW)' },
    { id: 'sourcewise',   label: 'Source-wise',        icon: Grid3x3,      tooltip: 'Total Generation Capacity Details Under FTC/TOC/COD (MW) (Source-wise)' },
    { id: 'transmission', label: 'Transmission',       icon: Cable,        tooltip: 'Transmission Elements Details of FTC' },
    { id: 'activity',     label: 'FTC/TOC/COD Activity', icon: CalendarDays },
    { id: 'projects',     label: 'Project Details',   icon: ListTree     },
    { id: 'changes',      label: 'Day-wise Changes',  icon: History      },
  ];

  return (
    <div className="px-6 pt-6 pb-10 space-y-4">
      {/* Page header — title left, controls (date picker + export buttons) right */}
      <div className="flex items-center justify-between gap-3 flex-wrap shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
            <BarChart3 className="size-4 text-blue-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">Generation &amp; Transmission Summary</h1>
            <p className="text-[12px] text-muted-foreground leading-tight">
              {regionLabel}
              {selectedSources.length > 0 && <span className="ml-2 text-violet-600 font-medium">· {selectedSources.join(', ')}</span>}
              {asOf && <span className="ml-2 text-amber-600 font-medium">· As of {new Date(asOf).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AsOfDatePicker currentAsOf={asOf} />
          <FilterBar asOf={asOf} />
        </div>
      </div>

      {/* Last changes card — surfaces day-over-day movement at a glance */}
      <div className="shrink-0">
        <LastChangesCard
          availableSnapshots={availableSnapshots}
          currentAsOf={asOf}
          onOpenRangeDiff={() => setActiveTab('changes')}
        />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2 shrink-0">
        <StatCard icon={Zap}        label="Applied for FTC" value={stats.totalApplied}  color="blue"    />
        <StatCard icon={TrendingUp} label="FTC Approved"    value={stats.totalFtc}      color="emerald" />
        <StatCard icon={BarChart3}  label="TOC Issued"      value={stats.totalToc}      color="amber"   />
        <StatCard icon={Zap}        label="COD Declared"    value={stats.totalCod}      color="violet"  />
        <StatCard icon={Layers}     label="Active CONTD-4"  value={stats.contd4Active}  unit="projects" color="rose"  />
        <StatCard icon={Cable}      label="Tx Pending FTC"  value={stats.txPending}     unit="elements" color="slate" />
      </div>

      {/* Tab bar — sticks just below the fixed app header while the page scrolls.
          z-30 keeps it above the table content but BELOW the sidebar overlay
          (z-40), so an expanded sidebar isn't overlapped by the tabs. */}
      <div className="sticky top-[60px] lg:top-[70px] z-30 -mx-6 px-6 bg-background border-b shadow-sm">
        <nav className="-mb-px flex w-full border-b">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                title={tab.tooltip || tab.label}
                className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 px-2 py-2.5 text-[13px] lg:text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  active
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                }`}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Tab-level filters — pinned together with the tab bar so they stay
            visible while the table scrolls. Always rendered at a fixed height
            (h-14) so the frozen table-header offset below stays deterministic.
            Source is disabled (not removed) on tabs where it has no meaning. */}
        <div className="h-14 flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mr-0.5">Filters</span>
          {canFilterRegion && <RegionPicker regions={regions} selectedRegions={selectedRegions} />}
          <SourcePicker
            sources={sources}
            selectedSources={selectedSources}
            disabled={activeTab === 'transmission' || activeTab === 'changes' || activeTab === 'hybrid'}
          />
        </div>
      </div>

      {/* Per-tab Breakdown dialog — opened from the "View Breakup" button
          that now lives inside each table's section header. */}
      <TabBreakdown
        open={breakdownOpen}
        onOpenChange={setBreakdownOpen}
        activeTab={activeTab}
        projects={projects}
        txElements={txElements}
        activityFrom={activityFrom}
        activityTo={activityTo}
        asOf={asOf}
      />

      {/* Tab content — fills the remaining viewport; the table inside scrolls
          with a frozen header. */}
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

        {activeTab === 'activity' && (
          <MilestoneActivityTable activity={activity} from={activityFrom} to={activityTo} onViewBreakup={() => setBreakdownOpen(true)} selectedRegions={selectedRegions} selectedSources={selectedSources} />
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
