'use client';

import { useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import * as XLSX from 'xlsx-js-style';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { BarChart3, GitBranch, Grid3x3, Layers, TrendingUp, Zap, Cable, CalendarDays, Download, History, ListTree, FileSpreadsheet, Printer, Sheet, FileText, ChevronRight } from 'lucide-react';
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
        <th rowSpan={2} title={isRegionPrimary ? undefined : 'Source (Type)'} className="sticky left-0 z-[6] bg-slate-100 px-4 py-3 text-center font-bold border-r border-slate-200 whitespace-nowrap" style={{ minWidth: 90 }}>
          {isRegionPrimary ? 'Region' : 'Source'}
        </th>
        <th rowSpan={2} title={isRegionPrimary ? 'Source (Type)' : undefined} className="sticky z-[6] bg-slate-100 px-4 py-3 text-center font-bold border-r border-slate-200 whitespace-nowrap" style={{ left: 90, minWidth: 96 }}>
          {isRegionPrimary ? 'Source' : 'Region'}
        </th>
        <th rowSpan={2} title="Total Installed Capacity (MW)" className="px-4 py-3 text-center font-bold border-r border-slate-200 whitespace-nowrap cursor-help">Total Cap (MW)</th>
        <th rowSpan={2} title="Total Capacity (MW) for which CONTD-4 issued" className="px-4 py-3 text-center font-bold border-r border-slate-200 whitespace-nowrap text-slate-400 cursor-help">CONTD-4 (MW)</th>
        <th rowSpan={2} title="Capacity (MW) applied for FTC" className="px-4 py-3 text-center font-bold border-r border-slate-200 whitespace-nowrap cursor-help">Applied (MW)</th>
        <th colSpan={2} className="px-4 py-2 text-center font-bold bg-blue-50 text-blue-700 border-r border-blue-200 whitespace-nowrap">FTC (MW)</th>
        <th colSpan={2} className="px-4 py-2 text-center font-bold bg-violet-50 text-violet-700 border-r border-violet-200 whitespace-nowrap">TOC (MW)</th>
        <th colSpan={2} className="px-4 py-2 text-center font-bold bg-emerald-50 text-emerald-700 border-r border-emerald-200 whitespace-nowrap">COD (MW)</th>
        <th rowSpan={2} title={expTooltip} className="px-4 py-3 text-center font-bold bg-amber-50 text-amber-700 border-l border-amber-200 whitespace-nowrap cursor-help">{refMonthLabel}</th>
      </tr>
      <tr className="text-[11px]">
        <th title="Capacity (MW) for which FTC approved" className="px-4 py-1.5 text-center font-semibold bg-blue-100 text-blue-700 border-r border-blue-200 whitespace-nowrap cursor-help">Approved</th>
        <th title="FTC Pending (MW)" className="px-4 py-1.5 text-center font-semibold bg-blue-50 text-blue-500 border-r border-slate-200 whitespace-nowrap cursor-help">Pending</th>
        <th title="TOC Issued (MW)" className="px-4 py-1.5 text-center font-semibold bg-violet-100 text-violet-700 border-r border-violet-200 whitespace-nowrap cursor-help">Issued</th>
        <th title="TOC Pending (MW)" className="px-4 py-1.5 text-center font-semibold bg-violet-50 text-violet-400 border-r border-slate-200 whitespace-nowrap cursor-help">Pending</th>
        <th title="COD Completed (MW)" className="px-4 py-1.5 text-center font-semibold bg-emerald-100 text-emerald-700 border-r border-emerald-200 whitespace-nowrap cursor-help">Done</th>
        <th title="COD Pending (MW)" className="px-4 py-1.5 text-center font-semibold bg-emerald-50 text-emerald-500 border-r border-slate-200 whitespace-nowrap cursor-help">Pending</th>
      </tr>
    </thead>
  );
}

function PipelineRow({ row, i, rows, isRegionPrimary, expandable = false, expanded = false, onToggle }) {
  const isTotal          = row.isTotal;
  const isSubtotal       = row.isSubtotal && !isTotal;
  const isAllIndia       = row.isAllIndiaBreakdown;
  const isHybridComp     = row.isHybridComponent;   // an indented hybrid-component breakup row
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

  // Hybrid-component rows inserted under the All-India HYBRID row are part of
  // the section — don't re-draw the section's thick top border after them.
  const isFirstAllIndia = isAllIndia && !prevRow?.isAllIndiaBreakdown && !prevRow?.isHybridComponent;

  // All India rows live in a sticky <tfoot>, so they MUST use fully-opaque
  // backgrounds (no slash-opacity) — otherwise scrolled body content shows
  // through.
  const bg = isTotal
    ? 'bg-slate-100'
    : isAllIndia
    ? 'bg-slate-50'
    : isSubtotal
    ? 'bg-slate-50/80'
    : isHybridComp
    ? 'bg-teal-50/40'
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

  // A "name-only" HYBRID row (partial parts selected): its total no longer equals
  // the shown sub-rows, so every quantum is intentionally left blank.
  const nameOnly = row.nameOnly;
  const N = ({ v, cls = '' }) => {
    const cleanCls = isFooterRow ? stripBg(cls) : cls;
    return (
      <td
        style={cellStyle}
        className={`px-4 py-2.5 text-center tabular-nums ${bold ? 'font-bold' : ''} ${cleanCls}`}
      >
        {nameOnly ? '' : fmt(v)}
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
        className={`px-4 py-2.5 sticky text-center border-r border-gray-200 z-[4] ${bg}`}
      >
        {isTotal
          ? <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest">Total</span>
          : isSubtotal
          ? <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest">Subtotal</span>
          : isHybridComp
          ? <span className="inline-flex items-center gap-1 pl-4 text-teal-700">
              <span className="text-teal-400">↳</span>
              {row.source === 'HYBRID'
                ? <Chip label="Unsplit" colorCls="bg-slate-100 text-slate-500" />
                : <Chip label={row.source} colorCls={SOURCE_BADGE[row.source]} />}
              {row.isHybridContribution && <span className="text-[10px] font-medium text-teal-600/80 italic">in hybrid</span>}
            </span>
          : expandable
          ? <button type="button" onClick={onToggle} className="inline-flex items-center gap-1 group" title={expanded ? 'Hide hybrid breakup' : 'Show hybrid breakup (Wind / Solar / BESS parts)'}>
              <ChevronRight className={`size-3.5 text-slate-400 group-hover:text-slate-600 transition-transform ${expanded ? 'rotate-90' : ''}`} />
              <Chip label={secondary} colorCls={isRegionPrimary ? SOURCE_BADGE[secondary] : REGION_BADGE[secondary]} />
            </button>
          : nameOnly
          ? <span className="inline-flex items-center gap-1.5">
              <Chip label={secondary} colorCls={isRegionPrimary ? SOURCE_BADGE[secondary] : REGION_BADGE[secondary]} />
              <span className="text-[9px] font-medium text-slate-400 italic" title="Some constituent parts are filtered out, so the hybrid total is not shown — see the parts below.">parts only</span>
            </span>
          : <Chip label={secondary} colorCls={isRegionPrimary ? SOURCE_BADGE[secondary] : REGION_BADGE[secondary]} />}
      </td>
      <N v={row.totalCapacityMw}  cls="border-r border-gray-100" />
      {/* CONTD-4 is issued at PLANT level — a hybrid-component sub-row has no
          real per-source figure, so show “—” instead of a prorated number. */}
      <N v={isHybridComp ? null : row.contd4CapacityMw} cls="border-r border-gray-100 text-slate-400" />
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

// Numeric funnel fields, in column order. Used to re-aggregate subtotals/totals
// on the client when the hybrid bifurcation is in "partial parts" mode.
const PIPELINE_NUM_FIELDS = [
  'totalCapacityMw', 'contd4CapacityMw', 'appliedMw',
  'ftcApprovedMw', 'ftcPendingMw', 'tocIssuedMw', 'tocPendingMw',
  'codCompletedMw', 'codPendingMw', 'expectedMw',
];
const r3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;

function PipelineTable({ rows, primaryKey, refMonthLabel = 'Expected', title, desc, onViewBreakup, hybridBreakup = {}, selectedHybridParts = [], availableHybridParts = [], hybridMode = 'excl', selectedSources = [], excludeCommissioned = false }) {
  const router = useRouter();
  const sp     = useSearchParams();
  const [expanded, setExpanded] = useState(() => new Set());
  // Hide leaf rows whose every figure is 0 (a region's empty COAL/HYDRO
  // scaffold rows, etc.). OFF by default — the full scaffold shows as before.
  const [hideZero, setHideZero] = useState(false);

  // "Exclude Commissioned" recomputes the aggregates server-side (a project's
  // commissioned status can't be derived from the summed rows here), so it's a
  // URL param that re-renders the page — unlike the pure-view "Hide zero rows".
  const [ecPending, startEc] = useTransition();
  const toggleExcludeCommissioned = (on) => {
    const params = new URLSearchParams(sp);
    if (on) params.set('excludeCommissioned', '1');
    else    params.delete('excludeCommissioned');
    startEc(() => router.push(`/dashboard${params.toString() ? '?' + params.toString() : ''}`));
  };
  if (!rows?.length) return <Empty />;
  const isRegionPrimary = primaryKey === 'region';
  const toggle = (region) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(region) ? next.delete(region) : next.add(region);
    return next;
  });

  const isAllZero = (r) =>
    Math.abs(r.totalCapacityMw) < 0.001 && Math.abs(r.contd4CapacityMw) < 0.001 &&
    Math.abs(r.appliedMw) < 0.001 && Math.abs(r.ftcApprovedMw) < 0.001 && Math.abs(r.ftcPendingMw) < 0.001 &&
    Math.abs(r.tocIssuedMw) < 0.001 && Math.abs(r.tocPendingMw) < 0.001 &&
    Math.abs(r.codCompletedMw) < 0.001 && Math.abs(r.codPendingMw) < 0.001 && Math.abs(r.expectedMw) < 0.001;
  // Only leaf data rows are hidden — subtotals and the grand Total always stay.
  const keepRow = (r) => !hideZero || r.isSubtotal || r.isTotal || !isAllZero(r);

  // Order: per-region detail first, then the All India summary, then the grand
  // total — everything in one naturally-scrolling body.
  const regionRows   = rows.filter((r) => !r.isAllIndiaBreakdown && !r.isTotal && keepRow(r));
  const allIndiaRows  = rows.filter((r) => r.isAllIndiaBreakdown && keepRow(r));
  const totalRow      = rows.find((r) => r.isTotal);
  const baseRows      = [...regionRows, ...allIndiaRows, ...(totalRow ? [totalRow] : [])];

  // A HYBRID leaf row is expandable when there's a component split for its
  // region (region-wise view only) — including the All-India summary row,
  // whose split is the cross-region aggregate. Expanding inserts the Wind /
  // Solar / BESS breakup rows right below (they sum back to the HYBRID row).
  const isHybridLeaf = (row) =>
    isRegionPrimary && row.source === 'HYBRID' && !row.isHybridComponent && !row.isSubtotal && !row.isTotal;

  // Sub-source selection (?hybridParts=). "partial" = a strict, non-empty subset
  // of the parts that actually exist ⇒ the HYBRID total no longer equals the sum
  // of the shown parts (e.g. Wind excluded), so we blank the HYBRID row's numbers
  // (name only), auto-show just the selected component sub-rows, and re-aggregate
  // every subtotal / All-India / Total row from what's actually on screen.
  const selPart = new Set((selectedHybridParts ?? []).filter((p) => availableHybridParts.includes(p)));
  const partial = selPart.size > 0 && selPart.size < availableHybridParts.length;

  const compsFor = (row) =>
    isHybridLeaf(row)
      ? (hybridBreakup[row.region] ?? [])
          .filter((c) => c.totalCapacityMw > 0 || c.appliedMw > 0)
          .filter((c) => selPart.size === 0 || selPart.has(c.source))
      : [];

  // Excl. Hybrid + a source filter that does NOT include HYBRID: the pure-source
  // rows are shown, but each source's hybrid contribution would otherwise vanish
  // (hybrids bucket as HYBRID, which the filter drops). Surface it as an indented
  // "↳ Solar (in hybrid)" sub-row beneath the standalone row so the two stay
  // separate (Incl. mode is what merges them). Skipped when HYBRID is selected —
  // then the full HYBRID row + its own bifurcation already show the split.
  const injectHybridContrib =
    isRegionPrimary && hybridMode === 'excl' &&
    selectedSources.length > 0 && !selectedSources.includes('HYBRID');
  const isStandaloneLeaf = (row) =>
    row.source && row.source !== 'HYBRID' &&
    !row.isHybridComponent && !row.isSubtotal && !row.isTotal;
  const hybridContribFor = (row) =>
    injectHybridContrib && isStandaloneLeaf(row)
      ? (hybridBreakup[row.region] ?? []).find(
          (c) => c.source === row.source && (c.totalCapacityMw > 0 || c.appliedMw > 0))
      : null;

  // Fold a displayed leaf into a running subtotal accumulator. Component rows
  // contribute 0 to CONTD-4 (it's plant-level — shown as "—" per source).
  const addInto = (acc, r, asComp) => {
    for (const f of PIPELINE_NUM_FIELDS) {
      acc[f] += (asComp && f === 'contd4CapacityMw') ? 0 : (Number(r[f]) || 0);
    }
  };
  const sealAcc = (acc) => {
    // Recompute the pending columns from the summed funnel so the subtotal
    // matches how every other row derives them (applied→ftc→toc→cod).
    acc.ftcPendingMw = Math.max(0, r3(acc.appliedMw    - acc.ftcApprovedMw));
    acc.tocPendingMw = Math.max(0, r3(acc.ftcApprovedMw - acc.tocIssuedMw));
    acc.codPendingMw = Math.max(0, r3(acc.tocIssuedMw   - acc.codCompletedMw));
    return acc;
  };

  // Either transform (partial-parts blanking OR excl hybrid-contribution rows)
  // requires re-summing subtotals/totals from what's actually displayed.
  const rebuild = partial || injectHybridContrib;

  const orderedRows = [];
  if (rebuild) {
    // Rebuild the whole body, injecting sub-rows and re-summing each section.
    let acc = null;
    const freshAcc = () => Object.fromEntries(PIPELINE_NUM_FIELDS.map((f) => [f, 0]));
    for (const row of baseRows) {
      if (row.isSubtotal || row.isTotal) {
        orderedRows.push(acc ? { ...row, ...sealAcc(acc) } : row);
        acc = null;
        continue;
      }
      if (acc == null) acc = freshAcc();
      if (partial && isHybridLeaf(row)) {
        orderedRows.push({ ...row, nameOnly: true });               // name only, no quantum
        for (const c of compsFor(row)) {
          const cr = { ...c, region: row.region, isHybridComponent: true };
          orderedRows.push(cr);
          addInto(acc, cr, true);
        }
      } else {
        orderedRows.push(row);
        addInto(acc, row, false);
        // Excl. mode: append this source's hybrid contribution as its own row.
        const contrib = hybridContribFor(row);
        if (contrib) {
          const cr = { ...contrib, region: row.region, isHybridComponent: true, isHybridContribution: true };
          orderedRows.push(cr);
          addInto(acc, cr, true);
        }
      }
    }
  } else {
    // Full (or empty) selection ⇒ classic behaviour: HYBRID row keeps its total
    // and expands on click to show every constituent part.
    for (const row of baseRows) {
      orderedRows.push(row);
      const comps = compsFor(row);
      if (comps.length && expanded.has(row.region)) {
        for (const c of comps) orderedRows.push({ ...c, region: row.region, isHybridComponent: true });
      }
    }
  }

  return (
    <div className="rounded-xl border shadow-sm">
      {title && (
        <div className="bg-slate-50 border-b border-slate-200 px-4 py-2 flex items-start justify-between gap-3 shrink-0">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700">{title}</p>
            {desc && <p className="text-[10px] text-slate-500 mt-0.5">{desc}</p>}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <label
              className={`flex items-center gap-1.5 cursor-pointer select-none text-[11px] font-medium ${excludeCommissioned ? 'text-blue-700' : 'text-slate-600 hover:text-slate-800'} ${ecPending ? 'opacity-60' : ''}`}
              title="Drop fully-commissioned projects (COD complete) and show only the still-under-process pipeline"
            >
              <input
                type="checkbox"
                checked={excludeCommissioned}
                disabled={ecPending}
                onChange={(e) => toggleExcludeCommissioned(e.target.checked)}
                className="size-3.5 accent-blue-600"
              />
              Exclude Commissioned
            </label>
            <label
              className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] font-medium text-slate-600 hover:text-slate-800"
              title="Hide rows where every column is 0 (subtotals and totals always stay)"
            >
              <input
                type="checkbox"
                checked={hideZero}
                onChange={(e) => setHideZero(e.target.checked)}
                className="size-3.5 accent-blue-600"
              />
              Hide zero rows
            </label>
            <ViewBreakupBtn onClick={onViewBreakup} />
          </div>
        </div>
      )}
      <div>
        <table className="w-full border-collapse">
          <PipelineHead isRegionPrimary={isRegionPrimary} refMonthLabel={refMonthLabel} />
          <tbody>
            {orderedRows.map((row, i) => (
              <PipelineRow
                key={i} row={row} i={i} rows={orderedRows} isRegionPrimary={isRegionPrimary}
                expandable={!partial && compsFor(row).length > 0}
                expanded={expanded.has(row.region)}
                onToggle={() => toggle(row.region)}
              />
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
        className={`px-3 py-2 sticky left-0 z-[4] text-center border-r border-gray-200 ${bg}`}
      >
        {!sameRegion && !isSubtotal && !isTotal && !isAllIndiaBreakdown && <Chip label={row.region} colorCls={REGION_BADGE[row.region]} />}
        {isFirstAllIndiaBreakdown && <span className="text-[11px] font-bold text-slate-600">All India</span>}
      </td>
      <td
        style={{ ...cellStyle, left: 76 }}
        className={`px-3 py-2 sticky z-[4] text-center border-r border-gray-200 ${bg}`}
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
              <th className="sticky left-0 z-[6] bg-slate-100 px-3 py-2 text-center font-bold border-r border-slate-200 whitespace-nowrap" style={{ minWidth: 76 }}>Region</th>
              <th className="sticky z-[6] bg-slate-100 px-3 py-2 text-center font-bold border-r border-slate-200 whitespace-nowrap" style={{ left: 76, minWidth: 200 }}>Source</th>
              <th className="px-3 py-2 text-center font-bold border-r border-slate-200 whitespace-nowrap">Total Cap (MW)</th>
              {allMonths.map(m => (
                <th key={m} title={`CONTD-4 expected to be completed in ${fmtMonth(m)}`} className="px-3 py-2 text-center font-bold border-r border-blue-200 whitespace-nowrap bg-blue-50 text-blue-700 cursor-help" style={{ minWidth: 110 }}>
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
              <th className="sticky left-0 z-[6] bg-slate-100 px-3 py-2 text-center font-bold border-r border-slate-200" style={{ minWidth: 76 }}>Region</th>
              <th className="px-3 py-2 text-center font-bold border-r border-slate-200" style={{ minWidth: 220 }}>Element Type</th>
              <th colSpan={2} className="px-3 py-1 text-center font-bold bg-emerald-50 text-emerald-700 border-r border-emerald-200 whitespace-nowrap">FTC Completed</th>
              <th colSpan={2} className="px-3 py-1 text-center font-bold bg-amber-50 text-amber-700 border-r border-amber-200 whitespace-nowrap">FTC Pending</th>
              <th colSpan={2} className="px-3 py-1 text-center font-bold bg-blue-50 text-blue-700 border-r border-blue-200 whitespace-nowrap">Commissioning Expected ({refMonthLabel})</th>
            </tr>
            <tr className="text-[10px] bg-slate-50">
              <th className="sticky left-0 z-[6] bg-slate-50 border-r border-slate-200" />
              <th className="bg-slate-50 border-r border-slate-200" />
              <th className="px-3 py-1 text-center font-semibold bg-emerald-100 text-emerald-700 border-r border-emerald-200 whitespace-nowrap">No. of Elements</th>
              <th className="px-3 py-1 text-center font-semibold bg-emerald-50 text-emerald-500 border-r border-slate-200 whitespace-nowrap">ckt km / MVA</th>
              <th className="px-3 py-1 text-center font-semibold bg-amber-100 text-amber-700 border-r border-amber-200 whitespace-nowrap">No. of Elements</th>
              <th className="px-3 py-1 text-center font-semibold bg-amber-50 text-amber-500 border-r border-slate-200 whitespace-nowrap">ckt km / MVA</th>
              <th className="px-3 py-1 text-center font-semibold bg-blue-100 text-blue-700 border-r border-blue-200 whitespace-nowrap">No. of Elements</th>
              <th className="px-3 py-1 text-center font-semibold bg-blue-50 text-blue-500 whitespace-nowrap">ckt km / MVA</th>
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
                  <td className="px-3 py-2 sticky left-0 text-center bg-white border-r border-gray-200 z-[4]">
                    {!sameRegion && <Chip label={row.region} colorCls={REGION_BADGE[row.region]} />}
                  </td>
                  <td className="px-3 py-2 text-center text-foreground border-r border-gray-100">
                    {CAT_LABELS[row.category] ?? row.category}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums bg-emerald-50/30 text-emerald-800 font-semibold border-r border-emerald-100">
                    {row.completedCount || '0'}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums bg-emerald-50/20 text-emerald-700 border-r border-slate-200">
                    {fmt(completedVal)}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums bg-amber-50/30 text-amber-800 font-semibold border-r border-amber-100">
                    {row.pendingCount || '0'}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums bg-amber-50/20 text-amber-700 border-r border-slate-200">
                    {fmt(pendingVal)}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums bg-blue-50/30 text-blue-800 font-semibold border-r border-blue-100">
                    {row.expectedCount || '0'}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums bg-blue-50/20 text-blue-700">
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
      <td className="px-3 py-2 text-center tabular-nums border-r border-gray-100">{fmt(r.totalMw)}</td>
      <td className="px-3 py-2 text-center tabular-nums border-r border-gray-100">{fmt(r.contd4Mw)}</td>
      <td className="px-3 py-2 text-center tabular-nums border-r border-gray-100">{fmt(r.appliedMw)}</td>
      <td className="px-3 py-2 text-center tabular-nums bg-blue-50/30 text-blue-800 border-r border-blue-100">{fmt(r.ftcMw)}</td>
      <td className="px-3 py-2 text-center tabular-nums bg-violet-50/30 text-violet-800 border-r border-violet-100">{fmt(r.tocMw)}</td>
      <td className="px-3 py-2 text-center tabular-nums bg-emerald-50/30 text-emerald-800 border-r border-emerald-100">{fmt(r.codMw)}</td>
      <td className="px-3 py-2 text-center tabular-nums bg-amber-50/30 text-amber-800">{fmt(r.expectedMw)}</td>
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
              <th className="sticky left-0 z-[6] bg-slate-100 px-3 py-2 text-center font-bold border-r border-slate-200 whitespace-nowrap" style={{ minWidth: 76 }}>Region</th>
              <th className="px-3 py-2 text-center font-bold border-r border-slate-200 whitespace-nowrap" style={{ minWidth: 220 }}>Hybrid Type</th>
              <th className="px-3 py-2 text-center font-bold border-r border-slate-200 whitespace-nowrap">Source (Type)</th>
              <th className="px-3 py-2 text-center font-bold border-r border-slate-200 whitespace-nowrap">Total Capacity (MW)</th>
              <th className="px-3 py-2 text-center font-bold border-r border-slate-200 whitespace-nowrap">Total CONTD-4 (MW)</th>
              <th className="px-3 py-2 text-center font-bold border-r border-slate-200 whitespace-nowrap">Applied for FTC</th>
              <th className="px-3 py-2 text-center font-bold bg-blue-100 text-blue-700 border-r border-blue-200 whitespace-nowrap">FTC Approved</th>
              <th className="px-3 py-2 text-center font-bold bg-violet-100 text-violet-700 border-r border-violet-200 whitespace-nowrap">TOC Issued</th>
              <th className="px-3 py-2 text-center font-bold bg-emerald-100 text-emerald-700 border-r border-emerald-200 whitespace-nowrap">COD Completed</th>
              <th title={`Expected Capacity (MW) to be commissioned by End of ${refMonthLabel.startsWith('Exp. ') ? refMonthLabel.slice(5) : refMonthLabel}`} className="px-3 py-2 text-center font-bold bg-amber-100 text-amber-700 whitespace-nowrap cursor-help">{refMonthLabel}</th>
            </tr>
          </thead>
          <tbody>
            {display.map((r, i) => {
              if (r.kind === 'data') {
                return (
                  <tr key={i} className="border-t border-slate-100 bg-white hover:bg-teal-50/20 transition-colors">
                    {regionSpans.has(i) && (
                      <td rowSpan={regionSpans.get(i)} className="px-3 py-2 sticky left-0 text-center bg-slate-50/60 border-r border-slate-200 z-[4] align-top">
                        <Chip label={r.region} colorCls={REGION_BADGE[r.region]} />
                      </td>
                    )}
                    {typeSpans.has(i) && (
                      <td rowSpan={typeSpans.get(i)} className="px-3 py-2 text-center border-r border-slate-200 text-foreground align-top bg-white">
                        <span className="font-semibold text-[11px]">{r.hybridType}</span>
                      </td>
                    )}
                    <td className="px-3 py-2 text-center border-r border-gray-100">
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
                      <td rowSpan={regionSpans.get(i)} className="px-3 py-2 sticky left-0 text-center bg-slate-50/60 border-r border-slate-200 z-[4] align-top">
                        <Chip label={r.region} colorCls={REGION_BADGE[r.region]} />
                      </td>
                    )}
                    <td colSpan={2} className="px-3 py-2 border-r border-slate-200 text-center text-slate-700">{r.label}</td>
                    {renderNumCells(r)}
                  </tr>
                );
              }
              if (r.kind === 'regionTotal') {
                return (
                  <tr key={i} className="border-t border-slate-300 bg-slate-200 font-bold">
                    {regionSpans.has(i) && (
                      <td rowSpan={regionSpans.get(i)} className="px-3 py-2 sticky left-0 text-center bg-slate-50/60 border-r border-slate-200 z-[4] align-top">
                        <Chip label={r.region} colorCls={REGION_BADGE[r.region]} />
                      </td>
                    )}
                    <td colSpan={2} className="px-3 py-2 border-r border-slate-300 text-center text-slate-800 uppercase text-[10px] tracking-wide">{r.label}</td>
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
                    <td colSpan={2} className="px-3 py-2 text-center text-[11px]">Total {r.sourceType.charAt(0) + r.sourceType.slice(1).toLowerCase()}</td>
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
                  <td colSpan={2} className="px-3 py-2 text-center text-[11px] uppercase tracking-wide">Grand Total</td>
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

  // Quick presets — inclusive windows ending today (local date), so
  // "Last 7 days" = today and the 6 days before it.
  const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const presetRange = (days) => {
    const now = new Date();
    return { from: isoLocal(new Date(now.getTime() - (days - 1) * 86400000)), to: isoLocal(now) };
  };
  const isActivePreset = (days) => {
    const p = presetRange(days);
    return from === p.from && to === p.to;
  };
  const PRESETS = [
    { days: 7,  label: 'Last 7 days'  },
    { days: 30, label: 'Last 30 days' },
  ];

  // ── Financial year (India: 1 Apr → 31 Mar) ──────────────────────────────────
  // A FY dropdown + a month dropdown. "Whole year" sets the full 1 Apr → 31 Mar
  // window; picking a month narrows it to that calendar month. Both write the
  // same `from`/`to` URL params the date picker uses, so the rest of the tab
  // recomputes unchanged.
  const pad     = (n) => String(n).padStart(2, '0');
  const lastDay = (y, m1) => new Date(Date.UTC(y, m1, 0)).getUTCDate(); // m1 = 1-indexed month
  const today   = new Date();
  const curFyStart = (today.getMonth() + 1) >= 4 ? today.getFullYear() : today.getFullYear() - 1;
  const FY_OPTIONS = [0, 1, 2, 3, 4].map((i) => curFyStart - i);
  const fyLabel    = (s) => `FY ${s}-${String(s + 1).slice(2)}`;
  const FY_MONTHS  = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]; // Apr → Mar
  const monthYear  = (s, m1) => (m1 >= 4 ? s : s + 1);        // calendar year of a FY month
  const MONTH_LABEL = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Which FY does the current `from` fall into? Drives the FY dropdown's value.
  const fyOf = (iso) => { const [y, m] = iso.split('-').map(Number); return m >= 4 ? y : y - 1; };
  const selectedFy = from ? fyOf(from) : curFyStart;

  // Derive the month dropdown's value from the active range so the controls
  // mirror the URL: 'ALL' = whole FY, 'YYYY-MM' = that month, '' = custom.
  let monthValue = '';
  if (from === `${selectedFy}-04-01` && to === `${selectedFy + 1}-03-31`) {
    monthValue = 'ALL';
  } else if (from && to) {
    const [fy, fm] = from.split('-').map(Number);
    if (from === `${fy}-${pad(fm)}-01` && to === `${fy}-${pad(fm)}-${pad(lastDay(fy, fm))}`) {
      monthValue = `${fy}-${pad(fm)}`;
    }
  }

  const applyFy = (s, mv) => {
    if (mv === 'ALL') {
      apply({ from: `${s}-04-01`, to: `${s + 1}-03-31` });
    } else if (mv) {
      const [y, m] = mv.split('-').map(Number);
      apply({ from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` });
    }
  };
  const onFyChange = (e) => {
    const s = Number(e.target.value);
    // Keep the chosen month (re-anchored to the new FY) if one is selected,
    // otherwise switch to the whole year.
    if (monthValue && monthValue !== 'ALL') {
      const m = Number(monthValue.split('-')[1]);
      applyFy(s, `${monthYear(s, m)}-${pad(m)}`);
    } else {
      applyFy(s, 'ALL');
    }
  };
  const onMonthChange = (e) => applyFy(selectedFy, e.target.value);

  const selectCls = 'h-9 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200';

  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
      <div className="flex flex-col gap-1">
        <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">Date range</span>
        <div className="flex items-center gap-1.5">
          <div className="w-[260px]">
            <DateRangePicker from={from ?? ''} to={to ?? ''} onChange={apply} className="h-9" />
          </div>
          {PRESETS.map(({ days, label }) => (
            <button
              key={days}
              type="button"
              onClick={() => apply(presetRange(days))}
              className={`h-9 px-3 rounded-md border text-xs font-medium whitespace-nowrap transition-colors ${
                isActivePreset(days)
                  ? 'border-blue-300 bg-blue-50 text-blue-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">Financial year</span>
        <div className="flex items-center gap-1.5">
          <select value={selectedFy} onChange={onFyChange} className={selectCls} title="Select financial year (April – March)">
            {FY_OPTIONS.map((s) => <option key={s} value={s}>{fyLabel(s)}</option>)}
          </select>
          <select value={monthValue} onChange={onMonthChange} className={selectCls} title="Whole year or a single month within the financial year">
            {monthValue === '' && <option value="" disabled>Custom range</option>}
            <option value="ALL">Whole year</option>
            {FY_MONTHS.map((m) => {
              const y = monthYear(selectedFy, m);
              return <option key={m} value={`${y}-${pad(m)}`}>{MONTH_LABEL[m]} {y}</option>;
            })}
          </select>
        </div>
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
// ── Activity summary exporters (Source × Region matrix, per milestone) ────────
const ACT_MILES = [{ key: 'ftc', label: 'FTC' }, { key: 'toc', label: 'TOC' }, { key: 'cod', label: 'COD' }];
const actRangeLabel = (from, to) => {
  const d = (s) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '…');
  return `${d(from)} → ${d(to)}`;
};

function downloadActivitySummaryExcel(activity, from, to, regions, sources) {
  const { matrix = {} } = activity ?? {};
  const NAVY = '1E3A5F';
  const bd = { style: 'thin', color: { rgb: 'CBD5E1' } };
  const B = { top: bd, bottom: bd, left: bd, right: bd };
  const base = (v) => ({ v: v == null ? '' : v, t: typeof v === 'number' && Number.isFinite(v) ? 'n' : 's' });
  const ttl = (v) => ({ ...base(v), s: { font: { bold: true, sz: 12, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: NAVY } }, alignment: { horizontal: 'center', vertical: 'center' }, border: B } });
  const hdr = (v) => ({ ...base(v), s: { font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: NAVY } }, alignment: { horizontal: 'center', vertical: 'center' }, border: B } });
  const dat = (v, n) => ({ ...base(v), s: { font: { sz: 10 }, alignment: { horizontal: n ? 'right' : 'left' }, border: B } });
  const tot = (v, n) => ({ ...base(v), s: { font: { bold: true, sz: 10 }, fill: { fgColor: { rgb: 'E2E8F0' } }, alignment: { horizontal: n ? 'right' : 'left' }, border: B } });
  const cols = ['Source', ...regions, 'All India'];
  const aoa = []; const merges = []; let r = 0;
  for (const m of ACT_MILES) {
    aoa.push([ttl(`${m.label} Capacity (MW) — ${actRangeLabel(from, to)}`), ...Array.from({ length: cols.length - 1 }, () => ttl(''))]);
    merges.push({ s: { c: 0, r }, e: { c: cols.length - 1, r } }); r += 1;
    aoa.push(cols.map(hdr)); r += 1;
    for (const src of sources) {
      const row = [dat(SOURCE_LABEL[src] ?? src, false)]; let rt = 0;
      for (const reg of regions) { const v = matrix?.[`${reg}|${src}`]?.[m.key] ?? 0; row.push(dat(v || 0, true)); rt += v; }
      row.push(tot(rt || 0, true)); aoa.push(row); r += 1;
    }
    const trow = [tot('Total', false)]; let gt = 0;
    for (const reg of regions) { let ct = 0; for (const src of sources) ct += matrix?.[`${reg}|${src}`]?.[m.key] ?? 0; trow.push(tot(ct || 0, true)); gt += ct; }
    trow.push(tot(gt || 0, true)); aoa.push(trow); r += 1;
    aoa.push([]); r += 1;
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges;
  ws['!cols'] = [{ wch: 12 }, ...regions.map(() => ({ wch: 12 })), { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'FTC-TOC-COD Summary');
  XLSX.writeFile(wb, `ftc-toc-cod-summary_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function downloadActivitySummaryPdf(activity, from, to, regions, sources) {
  const { matrix = {} } = activity ?? {};
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const MARGIN = 28;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(30, 58, 95);
  doc.text('FTC / TOC / COD Activity — Summary', MARGIN, MARGIN + 4);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90);
  doc.text(actRangeLabel(from, to), MARGIN, MARGIN + 20);
  let y = MARGIN + 34;
  const head = [['Source', ...regions, 'All India']];
  for (const m of ACT_MILES) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(30, 58, 95);
    doc.text(`${m.label} Capacity (MW)`, MARGIN, y);
    const body = [];
    for (const src of sources) {
      const row = [SOURCE_LABEL[src] ?? src]; let rt = 0;
      for (const reg of regions) { const v = matrix?.[`${reg}|${src}`]?.[m.key] ?? 0; row.push(fmt(v)); rt += v; }
      row.push(fmt(rt)); body.push(row);
    }
    const trow = ['Total']; let gt = 0;
    for (const reg of regions) { let ct = 0; for (const src of sources) ct += matrix?.[`${reg}|${src}`]?.[m.key] ?? 0; trow.push(fmt(ct)); gt += ct; }
    trow.push(fmt(gt)); body.push(trow);
    autoTable(doc, {
      startY: y + 4, head, body, theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8, halign: 'right', valign: 'middle', lineColor: [203, 213, 225], lineWidth: 0.3 },
      headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], halign: 'center', fontStyle: 'bold' },
      columnStyles: { 0: { halign: 'left' } },
      didParseCell: (d) => { if (d.section === 'body' && d.row.index === body.length - 1) { d.cell.styles.fillColor = [226, 232, 240]; d.cell.styles.fontStyle = 'bold'; } },
      margin: { left: MARGIN, right: MARGIN },
    });
    y = (doc.lastAutoTable?.finalY ?? y) + 20;
  }
  doc.save(`ftc-toc-cod-summary_${new Date().toISOString().slice(0, 10)}.pdf`);
}

function MilestoneActivityTable({ activity, from, to, onViewBreakup, selectedRegions = [], selectedSources = [], hybridMode = 'excl' }) {
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
  // dashboard filters so this tab honours them like the others. In Including-
  // Hybrid mode the HYBRID row is dropped — hybrids are folded into the source
  // rows server-side, so the HYBRID bucket is empty.
  const regions = selectedRegions.length ? REGION_ORDER.filter(r => selectedRegions.includes(r)) : REGION_ORDER;
  let   sources = selectedSources.length ? SOURCE_ORDER.filter(s => selectedSources.includes(s)) : SOURCE_ORDER;
  if (hybridMode === 'incl') sources = sources.filter(s => s !== 'HYBRID');

  const rowTotal = (source) => regions.reduce((s, reg) => s + cell(source, reg), 0);
  const colTotal = (region) => sources.reduce((s, src) => s + cell(src, region), 0);
  const grand    = totals?.[milestone] ?? 0;

  const hasAny = grand > 0 || (totals?.ftc ?? 0) > 0 || (totals?.toc ?? 0) > 0 || (totals?.cod ?? 0) > 0;

  return (
    <div className="space-y-3">
      {/* Controls: date range + downloads + breakup */}
      <div className="flex flex-wrap items-end justify-between gap-3 shrink-0">
        <ActivityDateRange from={from} to={to} />
        <div className="flex items-center gap-2">
          {hasAny && (
            <>
              <button
                type="button"
                onClick={() => downloadActivitySummaryExcel(activity, from, to, regions, sources)}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded px-2 py-1.5 transition-colors"
                title="Download the FTC/TOC/COD summary matrix as Excel"
                aria-label="Download summary as Excel"
              >
                <Sheet className="size-4" strokeWidth={2} /><span>XLSX</span>
              </button>
              <button
                type="button"
                onClick={() => downloadActivitySummaryPdf(activity, from, to, regions, sources)}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded px-2 py-1.5 transition-colors"
                title="Download the FTC/TOC/COD summary matrix as PDF"
                aria-label="Download summary as PDF"
              >
                <FileText className="size-4" strokeWidth={2} /><span>PDF</span>
              </button>
            </>
          )}
          <ViewBreakupBtn onClick={onViewBreakup} />
        </div>
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
                  <th className="sticky left-0 z-[5] px-4 py-2 text-center font-bold border-r border-slate-300 whitespace-nowrap bg-inherit">Source</th>
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
                      <td className="px-4 py-2 sticky left-0 z-[4] text-center bg-white border-r border-gray-200">
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
                  <td className="px-4 py-2 sticky left-0 z-[4] text-center bg-slate-100 border-r border-gray-200">
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
function FilterBar({ asOf, excludeCommissioned = false }) {
  const buildExportUrl = () => {
    const params = new URLSearchParams();
    if (asOf) params.set('asOf', asOf);
    if (excludeCommissioned) params.set('excludeCommissioned', '1');
    return `/api/grid/export?${params.toString()}`;
  };
  const buildPrintUrl = () => {
    const params = new URLSearchParams();
    if (asOf) params.set('asOf', asOf);
    if (excludeCommissioned) params.set('excludeCommissioned', '1');
    const qs = params.toString();
    return `/dashboard/print${qs ? `?${qs}` : ''}`;
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
        href={buildPrintUrl()}
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

// Including / Excluding Hybrid bifurcation for the FTC Pipeline tab. Writes the
// ?hybrid=incl URL param (absent = excl, the default). "Including" folds each
// hybrid's per-component capacity into its source bucket so a source row (e.g.
// Wind) reflects pure-source projects PLUS the matching component of hybrids;
// "Excluding" keeps hybrids in their own row. Scoped to the pipeline tab.
function HybridModeToggle({ mode }) {
  const router = useRouter();
  const sp     = useSearchParams();

  const set = (next) => {
    const params = new URLSearchParams(sp.toString());
    if (next === 'incl') params.set('hybrid', 'incl');
    else params.delete('hybrid');
    router.push(`/dashboard?${params.toString()}`);
  };

  const OPTIONS = [
    { value: 'excl', label: 'Excl. Hybrid' },
    { value: 'incl', label: 'Incl. Hybrid' },
  ];

  return (
    <div
      className="ml-auto flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5"
      title="Excluding: hybrids shown in their own row. Including: each hybrid's per-component capacity is folded into its source row (e.g. Wind = pure wind + hybrid wind)."
    >
      <span className="px-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Hybrid</span>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => set(o.value)}
          aria-pressed={mode === o.value}
          className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
            mode === o.value
              ? 'bg-white text-violet-700 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {o.label}
        </button>
      ))}
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

function StatCard({ icon: Icon, label, value, unit = 'MW', color = 'blue', fyLabel = null, fyValue = null }) {
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
        {/* This-FY achievement (event-dated milestones only). */}
        {fyValue != null && (
          <p className="text-[10px] font-semibold text-blue-600 leading-tight truncate" title={`Achieved in ${fyLabel} (1 Apr → as of date)`}>
            {fyLabel}: {Math.round(fyValue).toLocaleString('en-IN')}<span className="font-normal text-blue-400"> {unit}</span>
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main Client ───────────────────────────────────────────────────────────────

export function SummaryPageClient({
  regionLabel, asOf, activityFrom, activityTo,
  regions = [], selectedRegions = [], canFilterRegion = false,
  sources = [], selectedSources = [], hybridMode = 'excl',
  excludeCommissioned = false,
  hybridParts = [], selectedHybridParts = [],
  stats, table2Rows, table5Rows, contd4Study,
  transmissionRows, hybridRows, hybridBreakup = {}, bessProjects = [], activity, projects, txElements,
  availableSnapshots,
}) {
  const [activeTab, setActiveTab] = useState('pipeline');
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const { settings } = useSettings();
  const refMonthLabel = fmtRefMonthShort(settings.referenceMonth);
  const tabRouter = useRouter();
  const tabSp     = useSearchParams();

  // Switching tabs resets all tab-level filters to their defaults so a filter
  // set on one tab (e.g. Source = Solar, or a custom activity date range) never
  // silently carries into the next. `asOf` is the global snapshot date, not a
  // per-tab filter, so it's preserved. Clearing `from`/`to` also restores the
  // activity tab's default window (last 30 days, applied server-side).
  const TAB_FILTER_PARAMS = ['region', 'source', 'hybrid', 'excludeCommissioned', 'hybridParts', 'from', 'to'];
  const changeTab = (id) => {
    setActiveTab(id);   // instant; client state survives the searchParams nav below
    const params = new URLSearchParams(tabSp);
    let cleared = false;
    for (const k of TAB_FILTER_PARAMS) if (params.has(k)) { params.delete(k); cleared = true; }
    if (cleared) tabRouter.push(`/dashboard${params.toString() ? '?' + params.toString() : ''}`);
  };

  // The View-Breakup button now lives inside each table's section header
  // (only the 6 aggregating tabs render it).

  const tabs = [
    // `tooltip` = the full table title from the source Google Sheet, shown on
    // hover so the tab labels themselves can stay short.
    { id: 'pipeline',     label: 'FTC Pipeline',      icon: TrendingUp,   tooltip: 'Total ISTS Generation Capacity Details Under FTC/TOC/COD (MW)' },
    { id: 'contd4',       label: 'CONTD-4 Study',     icon: Layers,       tooltip: 'Total Capacity (MW) Under CONTD-4 Study' },
    { id: 'hybrid',       label: 'Hybrid Breakdown',  icon: GitBranch,    tooltip: 'Total Hybrid Capacity Details Under FTC/TOC/COD (MW)' },
    { id: 'sourcewise',   label: 'Source-wise',        icon: Grid3x3,      tooltip: 'Total ISTS Generation Capacity Details Under FTC/TOC/COD (MW) (Source-wise)' },
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
          <FilterBar asOf={asOf} excludeCommissioned={excludeCommissioned} />
        </div>
      </div>

      {/* Last changes card — surfaces day-over-day movement at a glance */}
      <div className="shrink-0">
        <LastChangesCard
          availableSnapshots={availableSnapshots}
          currentAsOf={asOf}
          onOpenRangeDiff={() => changeTab('changes')}
        />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2 shrink-0">
        <StatCard icon={Zap}        label="Applied for FTC" value={stats.totalApplied}  color="blue"    />
        <StatCard icon={TrendingUp} label="FTC Approved"    value={stats.totalFtc}      color="emerald" fyLabel={stats.fyLabel} fyValue={stats.fyFtc} />
        <StatCard icon={BarChart3}  label="TOC Issued"      value={stats.totalToc}      color="amber"   fyLabel={stats.fyLabel} fyValue={stats.fyToc} />
        <StatCard icon={Zap}        label="COD Declared"    value={stats.totalCod}      color="violet"  fyLabel={stats.fyLabel} fyValue={stats.fyCod} />
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
                onClick={() => changeTab(tab.id)}
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
          {/* Nested "hybrid parts" child options only steer the FTC Pipeline
              bifurcation — expose them only on that tab. */}
          <SourcePicker
            sources={sources}
            selectedSources={selectedSources}
            disabled={activeTab === 'transmission' || activeTab === 'changes' || activeTab === 'hybrid'}
            hybridParts={hybridParts}
            selectedHybridParts={selectedHybridParts}
            showParts={activeTab === 'pipeline'}
          />
          {/* Including / Excluding Hybrid — supported on the FTC Pipeline,
              Source-wise and FTC/TOC/COD Activity tabs. */}
          {(activeTab === 'pipeline' || activeTab === 'sourcewise' || activeTab === 'activity') && (
            <HybridModeToggle mode={hybridMode} />
          )}
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
            title={`Total ISTS Generation Capacity Details Under FTC / TOC / COD (MW) — Region-wise${hybridMode === 'incl' ? ' · Incl. Hybrid' : ''}${excludeCommissioned ? ' · Under Process only' : ''}`}
            desc={`Capacity funnel: Applied → FTC Approved → TOC Issued → COD Declared. FTC Pending = actively under FTC process.${hybridMode === 'incl' ? ' | Including Hybrid: each hybrid’s per-component capacity is folded into its source row.' : ''}${excludeCommissioned ? ' | Commissioned projects excluded.' : ''}`}
            onViewBreakup={() => setBreakdownOpen(true)}
            hybridBreakup={hybridBreakup}
            selectedHybridParts={selectedHybridParts}
            availableHybridParts={hybridParts}
            hybridMode={hybridMode}
            selectedSources={selectedSources}
            excludeCommissioned={excludeCommissioned}
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
            title={`Total ISTS Generation Capacity Details Under FTC / TOC / COD (MW) — Source-wise${hybridMode === 'incl' ? ' · Incl. Hybrid' : ''}${excludeCommissioned ? ' · Under Process only' : ''}`}
            desc={`Same pipeline data pivoted: rows grouped by source type, each sub-row is a region.${hybridMode === 'incl' ? ' | Including Hybrid: each hybrid’s per-component capacity is folded into its source group.' : ''}${excludeCommissioned ? ' | Commissioned projects excluded.' : ''}`}
            onViewBreakup={() => setBreakdownOpen(true)}
            excludeCommissioned={excludeCommissioned}
          />
        )}

        {activeTab === 'transmission' && (
          <TransmissionSummaryTable transmissionRows={transmissionRows} refMonthLabel={refMonthLabel} onViewBreakup={() => setBreakdownOpen(true)} />
        )}

        {activeTab === 'activity' && (
          <MilestoneActivityTable activity={activity} from={activityFrom} to={activityTo} onViewBreakup={() => setBreakdownOpen(true)} selectedRegions={selectedRegions} selectedSources={selectedSources} hybridMode={hybridMode} />
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
