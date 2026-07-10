'use client';

import { useState } from 'react';
import { getProjectSource, REGION_ORDER as REGION_ORDER_LIB, SOURCE_ORDER as SOURCE_ORDER_LIB } from '@/lib/grid-computations';

const REGION_ORDER = REGION_ORDER_LIB;
const SOURCE_ORDER = SOURCE_ORDER_LIB;

const REGION_FULL = { NR: 'Northern Region', WR: 'Western Region', SR: 'Southern Region', ER: 'Eastern Region', NER: 'North-Eastern Region' };

function fmt(v) {
  if (v == null || Number(v) === 0) return '—';
  const n = Number(v);
  const parts = n.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const dec = parts[1]?.replace(/0+$/, '');
  return dec ? `${parts[0]}.${dec}` : parts[0];
}

function fmtMonth(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m)-1]}'${y.slice(2)}`;
}

function fmtDate(v) {
  if (!v) return '—';
  try { return new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return '—'; }
}

// ── Shared table header/footer styles (injected once) ─────────────────────────

const PRINT_STYLES = `
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  @page { size: A3 landscape; margin: 14mm 12mm 14mm 12mm; }
  @page :first { margin-top: 10mm; }
  body { font-family: 'Arial', sans-serif; font-size: 8pt; color: #1a1a2e; background: #fff; }
  .page-break { break-before: page; }
  .avoid-break { break-inside: avoid; }
  table { border-collapse: collapse; width: 100%; }
  /* Let long tables flow across pages: repeat the header on every page and keep
     each row whole so nothing splits mid-row. */
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  /* Keep a section title attached to the start of its table (no orphan title at
     the bottom of a page). */
  .print-sec-title { break-after: avoid; }
  th, td { border: 1px solid #cbd5e1; padding: 3px 5px; }
  thead th { background-color: #1e3a5f !important; color: #fff !important; font-weight: 700; }
  .subtotal-row td { background-color: #e2e8f0 !important; font-weight: 700; }
  .total-row td { background-color: #1e3a5f !important; color: #fff !important; font-weight: 700; }
  .section-title { background-color: #1e3a5f !important; color: #fff !important; font-weight: 700; padding: 5px 8px; font-size: 8.5pt; }
  .print-header { display: block !important; }
  /* Screen-only controls (toolbar, customize panel) stay visible on screen and
     are hidden only when printing / saving to PDF. */
  @media print { .no-print { display: none !important; } }
`;

// ── Document header ────────────────────────────────────────────────────────────

function DocHeader({ dateLabel, scopeRegionCode, scopeRegionName, excludeCommissioned = false }) {
  // For RLDCs show the specific region name (e.g. "Southern Region"). For NLDC/
  // ADMIN scopeRegionCode is null so we fall back to the All India label.
  const scopeLabel = scopeRegionName ?? 'All India';
  const issuerLabel = scopeRegionCode
    ? `${scopeRegionCode}LDC — Regional Load Despatch Centre`
    : 'National Load Despatch Centre';
  return (
    <div className="print-header mb-4 border-b-2 border-[#1e3a5f] pb-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[7pt] font-bold text-[#1e3a5f] uppercase tracking-widest mb-0.5">{issuerLabel}</div>
          <h1 className="text-[13pt] font-black text-[#1e3a5f] leading-tight">
            Summary of Generation Capacity
          </h1>
          <h2 className="text-[11pt] font-bold text-[#1e3a5f]">
            Under FTC / TOC / COD — {scopeLabel}
          </h2>
          {excludeCommissioned && (
            <div className="mt-1 text-[8pt] font-bold text-amber-700 uppercase tracking-wide">
              Pipeline tables: commissioned projects excluded (under-process only)
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="inline-block border border-[#1e3a5f] px-3 py-2 rounded">
            <div className="text-[7pt] text-slate-500 uppercase tracking-wide">As on</div>
            <div className="text-[11pt] font-bold text-[#1e3a5f]">{dateLabel}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Section title bar ─────────────────────────────────────────────────────────

function SectionTitle({ children, tableNo }) {
  return (
    <div className="print-sec-title flex items-center gap-2 mb-1">
      {tableNo && (
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#1e3a5f] text-white text-[7pt] font-black shrink-0">
          {tableNo}
        </span>
      )}
      <div className="section-title flex-1 rounded-sm text-[8pt]">{children}</div>
    </div>
  );
}

// ── FTC Pipeline table ────────────────────────────────────────────────────────

// Toggleable capacity columns shared by both pipeline tables (Region-wise and
// Source-wise). The two label columns (primary Region/Source + secondary) are
// always shown. `key` drives the print-customization checkboxes.
const PIPE_COLUMNS = [
  { key: 'total',    label: 'Total Installed Capacity (MW)',         width: 58, get: r => r.totalCapacityMw },
  { key: 'contd4',   label: 'Total Capacity (MW) (CONTD-4 issued)',  width: 60, get: r => r.contd4CapacityMw },
  { key: 'applied',  label: 'Applied for FTC (MW)',                  width: 54, get: r => r.appliedMw },
  { key: 'ftcApp',   label: 'FTC Approved (MW)',                     width: 52, get: r => r.ftcApprovedMw },
  { key: 'ftcPend',  label: 'FTC Pending (MW)',                      width: 50, get: r => r.ftcPendingMw },
  { key: 'tocIss',   label: 'TOC Issued (MW)',                       width: 52, get: r => r.tocIssuedMw },
  { key: 'tocPend',  label: 'TOC Pending (MW)',                      width: 50, get: r => r.tocPendingMw },
  { key: 'codComp',  label: 'COD Completed (MW)',                    width: 52, get: r => r.codCompletedMw },
  { key: 'codPend',  label: 'COD Pending (MW)',                      width: 50, get: r => r.codPendingMw },
  { key: 'expected', label: 'Expected Commissioning (MW)',           width: 54, get: r => r.expectedMw },
];

// Per-table toggleable columns for the other sections. Like PIPE_COLUMNS, the
// identifying label columns (Region / Source / station name…) are always shown;
// only the data columns are toggleable.
const CONTD4_COLUMNS = [
  { key: 'total', label: 'Total Capacity (MW)', width: 70, get: r => r.totalMw },
  // The per-month "Expected by …" columns are dynamic (one per month present in
  // the data) and are appended at runtime — see contd4MonthCol().
];
const contd4MonthCol = (m) => ({ key: `month:${m}`, label: `Expected by ${fmtMonth(m)}`, width: 62, get: r => r.months?.[m] ?? 0 });

const HYBRID_COLUMNS = [
  { key: 'total',    label: 'Total Capacity (MW)',  width: 56, get: r => r.totalMw },
  { key: 'contd4',   label: 'Total CONTD-4 (MW)',   width: 56, get: r => r.contd4Mw },
  { key: 'applied',  label: 'Applied for FTC (MW)', width: 56, get: r => r.appliedMw },
  { key: 'ftc',      label: 'FTC Approved (MW)',    width: 56, get: r => r.ftcMw },
  { key: 'toc',      label: 'TOC Issued (MW)',      width: 56, get: r => r.tocMw },
  { key: 'cod',      label: 'COD Completed (MW)',   width: 56, get: r => r.codMw },
  { key: 'expected', label: 'Expected (MW)',        width: 56, get: r => r.expectedMw },
];

const TX_COLUMNS = [
  { key: 'compNo',  label: 'FTC Completed (No.)',          width: 70 },
  { key: 'compQty', label: 'FTC Completed (ckt km / MVA)', width: 80 },
  { key: 'pendNo',  label: 'FTC Pending (No.)',            width: 70 },
  { key: 'pendQty', label: 'FTC Pending (ckt km / MVA)',   width: 80 },
];

const PROJECT_COLUMNS = [
  { key: 'pooling', label: 'Pooling Station',     width: 80 },
  { key: 'total',   label: 'Total Capacity (MW)', width: 48 },
  { key: 'applied', label: 'Applied (MW)',        width: 44 },
  { key: 'ftcOK',   label: 'FTC OK (MW)',         width: 44 },
  { key: 'ftcPend', label: 'FTC Pend (MW)',       width: 44 },
  { key: 'tocOK',   label: 'TOC OK (MW)',         width: 44 },
  { key: 'tocPend', label: 'TOC Pend (MW)',       width: 44 },
  { key: 'codOK',   label: 'COD OK (MW)',         width: 44 },
  { key: 'codPend', label: 'COD Pend (MW)',       width: 44 },
  { key: 'exp',     label: 'Expected (MW)',       width: 48 },
];

function PipelineTable({ rows, primaryKey, scopeRegionCode, cols }) {
  const isRegionPrimary = primaryKey === 'region';
  const enabled = PIPE_COLUMNS.filter(c => !cols || cols.has(c.key));
  // For RLDC users the data only contains a single region, so the "All India
  // breakdown" rows duplicate the regional subtotal and the Grand Total — drop
  // them and just keep the region rows + final Grand Total.
  const filteredRows = scopeRegionCode
    ? rows.filter(r => !r.isAllIndiaBreakdown)
    : rows;

  // Vertically merge the primary (Region or Source) cell across each run of
  // rows that share it — region/source groups AND the "All India" per-source
  // breakdown block. Only the subtotal and grand-total rows keep their own
  // standalone label and are never absorbed.
  const mergeable = (r) => !r.isTotal && !r.isSubtotal;
  const primaryVal = (r) => (r.isAllIndiaBreakdown ? 'All India' : (isRegionPrimary ? r.region : r.source));
  const span = new Array(filteredRows.length).fill(1);
  const skip = new Array(filteredRows.length).fill(false);
  for (let i = 0; i < filteredRows.length; i++) {
    if (!mergeable(filteredRows[i]) || skip[i]) continue;
    let j = i + 1;
    while (j < filteredRows.length && mergeable(filteredRows[j]) && primaryVal(filteredRows[j]) === primaryVal(filteredRows[i])) {
      skip[j] = true; j++;
    }
    span[i] = j - i;
  }

  return (
    <table>
      <thead>
        <tr>
          <th style={{ width: 60, textAlign: 'left' }}>{isRegionPrimary ? 'Region' : 'Source'}</th>
          {/* Source (Type) spans the label + the hybrid-component sub-column. */}
          <th colSpan={2} style={{ width: 84, textAlign: 'left' }}>{isRegionPrimary ? 'Source (Type)' : 'Region'}</th>
          {enabled.map(c => (
            <th key={c.key} style={{ width: c.width }}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {filteredRows.map((row, i) => {
          const p = isRegionPrimary ? row.region : row.source;
          const s = isRegionPrimary ? row.source : row.region;
          const label1 = row.isTotal ? (scopeRegionCode ? `${scopeRegionCode} — Grand Total` : 'Grand Total')
            : row.isSubtotal ? `${p} — Total`
            : row.isInclHybridTotal ? ''
            : row.isAllIndiaBreakdown ? 'All India'
            : p;
          const label2 = row.isInclHybridTotal ? `Total ${row.source} including Hybrid`
            : row.isTotal || row.isSubtotal ? ''
            : s;
          const cls = row.isTotal ? 'total-row'
            : row.isSubtotal || row.isInclHybridTotal ? 'subtotal-row'
            : row.isAllIndiaBreakdown ? 'subtotal-row'
            : (i % 2 === 1 ? 'stripe' : '');
          return (
            <tr key={i} className={cls}>
              {!skip[i] && (
                <td
                  rowSpan={span[i] > 1 ? span[i] : undefined}
                  style={{ fontWeight: row.isSubtotal || row.isTotal ? 700 : 400, verticalAlign: 'middle', textAlign: span[i] > 1 ? 'center' : 'left' }}
                >
                  {label1}
                </td>
              )}
              {/* Source (Type) + hybrid component sub-column. Non-hybrid rows span
                  both; hybrid groups show a merged "HYBRID" cell (rowSpan) plus a
                  per-row component cell (Wind / Solar / BESS / PSP). */}
              {row.isHybridComponent ? (
                <>
                  {row.hybridGroupFirst && (
                    <td rowSpan={row.hybridGroupSize > 1 ? row.hybridGroupSize : undefined}
                        style={{ verticalAlign: 'middle', fontWeight: 400 }}>HYBRID</td>
                  )}
                  <td>{row.component}</td>
                </>
              ) : (
                <td colSpan={2} style={{ fontWeight: row.isInclHybridTotal ? 700 : undefined }}>{label2}</td>
              )}
              {enabled.map(c => {
                // CONTD-4 is plant-level: render it once per hybrid group, merged
                // (rowSpan) across the component rows. Skip the covered cells.
                if (c.key === 'contd4' && row.isHybridComponent) {
                  if (!row.hybridGroupFirst) return null;
                  return (
                    <td key={c.key} rowSpan={row.hybridGroupSize > 1 ? row.hybridGroupSize : undefined}
                        style={{ textAlign: 'right', verticalAlign: 'middle' }}>
                      {fmt(row.contd4CapacityMw)}
                    </td>
                  );
                }
                return <td key={c.key} style={{ textAlign: 'right' }}>{fmt(c.get(row))}</td>;
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── CONTD-4 table ─────────────────────────────────────────────────────────────

function Contd4Table({ contd4Study, scopeRegionCode, cols }) {
  const { rows, allMonths } = contd4Study;
  const allCols = [...CONTD4_COLUMNS, ...allMonths.map(contd4MonthCol)];
  const enabled = allCols.filter(c => !cols || cols.has(c.key));
  // Contd4 doesn't have All-India breakdown rows but the Grand Total label
  // should still reflect the user's region when applicable.

  // Vertically merge the Region cell across each region's run of source rows.
  const isData = (r) => !r.isTotal && !r.isSubtotal;
  const span = new Array(rows.length).fill(1);
  const skip = new Array(rows.length).fill(false);
  for (let i = 0; i < rows.length; i++) {
    if (!isData(rows[i]) || skip[i]) continue;
    let j = i + 1;
    while (j < rows.length && isData(rows[j]) && rows[j].region === rows[i].region) { skip[j] = true; j++; }
    span[i] = j - i;
  }

  return (
    <table>
      <thead>
        <tr>
          <th style={{ width: 60, textAlign: 'left' }}>Region</th>
          <th style={{ width: 70, textAlign: 'left' }}>Source</th>
          {enabled.map(c => (
            <th key={c.key} style={{ width: c.width }}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const label1 = row.isTotal ? (scopeRegionCode ? `${scopeRegionCode} — Grand Total` : 'Grand Total')
            : row.isSubtotal ? `${row.region} — Total`
            : row.region;
          const label2 = row.isTotal || row.isSubtotal ? '' : row.source;
          const cls = row.isTotal ? 'total-row' : row.isSubtotal ? 'subtotal-row' : '';
          return (
            <tr key={i} className={cls}>
              {!skip[i] && (
                <td
                  rowSpan={span[i] > 1 ? span[i] : undefined}
                  style={{ fontWeight: row.isSubtotal || row.isTotal ? 700 : 400, verticalAlign: 'middle', textAlign: span[i] > 1 ? 'center' : 'left' }}
                >
                  {label1}
                </td>
              )}
              <td>{label2}</td>
              {enabled.map(c => (
                <td key={c.key} style={{ textAlign: 'right' }}>{fmt(c.get(row))}</td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Transmission table ────────────────────────────────────────────────────────

const CAT_LABEL = {
  LINE_RE: 'Trans. Line (RE Pocket)',
  LINE_NONRE: 'Trans. Line (Non-RE Pocket)',
  ICT_RE: 'ICT / PT (RE Pocket)',
  ICT_NONRE: 'ICT / PT (Non-RE Pocket)',
  GT: 'Generator Transformer / Bay',
  ST: 'Station Transformer',
};

function TransmissionTable({ transmissionRows, cols }) {
  const enabled = TX_COLUMNS.filter(c => !cols || cols.has(c.key));
  const cell = (row, key) => {
    const isLine = row.category?.startsWith('LINE');
    switch (key) {
      case 'compNo':  return row.completedCount || '—';
      case 'compQty': return fmt(isLine ? row.completedKm : row.completedMva);
      case 'pendNo':  return row.pendingCount || '—';
      case 'pendQty': return fmt(isLine ? row.pendingKm : row.pendingMva);
      default:        return '—';
    }
  };
  return (
    <table>
      <thead>
        <tr>
          <th style={{ width: 48, textAlign: 'left' }}>Region</th>
          <th style={{ width: 150, textAlign: 'left' }}>Element Type</th>
          {enabled.map(c => (
            <th key={c.key} style={{ width: c.width }}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {transmissionRows.map((row, i) => (
          <tr key={i} className={i % 2 === 1 ? 'stripe' : ''}>
            <td>{row.region}</td>
            <td>{CAT_LABEL[row.category] ?? row.category}</td>
            {enabled.map(c => (
              <td key={c.key} style={{ textAlign: 'right' }}>{cell(row, c.key)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Inter-State COD Activity matrix ───────────────────────────────────────────
// Print counterpart of the dashboard's Activity tab, COD milestone only: a
// Source × Region matrix of capacity whose COD date falls in the given month.
// Hybrid cells show the per-component split (e.g. "180 – BESS / 211.4 – Solar").

const COMP_ORDER = ['WIND', 'SOLAR', 'BESS', 'PSP', 'COAL', 'HYDRO'];
const COMP_LABEL = { WIND: 'Wind', SOLAR: 'Solar', BESS: 'BESS', PSP: 'PSP', COAL: 'Coal', HYDRO: 'Hydro' };

function ActivityMatrix({ activity, scopeRegionCode }) {
  const milestone = 'cod';
  const { matrix, totals } = activity ?? {};
  const regions = scopeRegionCode ? [scopeRegionCode] : REGION_ORDER;
  const cell = (src, reg) => matrix?.[`${reg}|${src}`]?.[milestone] ?? 0;
  const comps = (reg) => {
    const c = matrix?.[`${reg}|HYBRID`]?.components?.[milestone] ?? {};
    return Object.entries(c).filter(([, mw]) => mw > 0).sort((a, b) => COMP_ORDER.indexOf(a[0]) - COMP_ORDER.indexOf(b[0]));
  };
  const rowTotal = (src) => regions.reduce((s, r) => s + cell(src, r), 0);
  const colTotal = (reg) => SOURCE_ORDER.reduce((s, src) => s + cell(src, reg), 0);
  const grand = scopeRegionCode ? colTotal(scopeRegionCode) : (totals?.[milestone] ?? 0);
  return (
    <table>
      <thead>
        <tr>
          <th style={{ width: 70, textAlign: 'left' }}>Source</th>
          {regions.map((r) => <th key={r} style={{ width: 70 }}>{r}</th>)}
          {!scopeRegionCode && <th style={{ width: 80 }}>All India</th>}
        </tr>
      </thead>
      <tbody>
        {SOURCE_ORDER.map((src, i) => {
          const isHybrid = src === 'HYBRID';
          return (
            <tr key={src} className={i % 2 === 1 ? 'stripe' : ''}>
              <td style={{ textAlign: 'left', fontWeight: 500 }}>{src}</td>
              {regions.map((r) => {
                const breakdown = isHybrid ? comps(r) : [];
                return (
                  <td key={r} style={{ textAlign: breakdown.length ? 'center' : 'right' }}>
                    {breakdown.length
                      ? breakdown.map(([c, mw]) => <div key={c}>{fmt(mw)} – {COMP_LABEL[c] ?? c}</div>)
                      : fmt(cell(src, r))}
                  </td>
                );
              })}
              {!scopeRegionCode && <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(rowTotal(src))}</td>}
            </tr>
          );
        })}
        <tr className="subtotal-row">
          <td style={{ textAlign: 'left', fontWeight: 700 }}>Total</td>
          {regions.map((r) => <td key={r} style={{ textAlign: 'right' }}>{fmt(colTotal(r))}</td>)}
          {!scopeRegionCode && <td style={{ textAlign: 'right' }}>{fmt(grand)}</td>}
        </tr>
      </tbody>
    </table>
  );
}

// ── Hybrid Breakdown table ────────────────────────────────────────────────────
// Print counterpart of the dashboard's Hybrid Breakdown tab: hybrid projects
// split by constituent source components, with per-region source subtotals,
// region grand totals and an All India footer.

const HYBRID_SRC_ORDER = ['WIND', 'SOLAR', 'BESS', 'PSP'];

function buildHybridDisplayRows(rows) {
  const out = [];
  const sumFields = (acc, r) => {
    for (const f of ['totalMw','contd4Mw','appliedMw','ftcMw','tocMw','codMw','expectedMw']) {
      acc[f] = (acc[f] || 0) + (Number(r[f]) || 0);
    }
    return acc;
  };

  const regions = [];
  const byRegion = new Map();
  for (const r of rows) {
    if (!byRegion.has(r.region)) { byRegion.set(r.region, []); regions.push(r.region); }
    byRegion.get(r.region).push(r);
  }

  const allIndiaBySrc = {};
  let allIndiaGrand = {};

  for (const region of regions) {
    const regionRows = byRegion.get(region);

    const types = [];
    const byType = new Map();
    for (const r of regionRows) {
      if (!byType.has(r.hybridType)) { byType.set(r.hybridType, []); types.push(r.hybridType); }
      byType.get(r.hybridType).push(r);
    }
    for (const ht of types) {
      for (const r of byType.get(ht)) out.push({ kind: 'data', ...r });
    }

    const bySrc = {};
    for (const r of regionRows) {
      bySrc[r.sourceType] = sumFields(bySrc[r.sourceType] || {}, r);
    }
    const orderedSrcs = HYBRID_SRC_ORDER.filter((s) => bySrc[s])
      .concat(Object.keys(bySrc).filter((s) => !HYBRID_SRC_ORDER.includes(s)));
    for (const s of orderedSrcs) {
      out.push({ kind: 'subtotal', region, label: `Total ${s.charAt(0) + s.slice(1).toLowerCase()}`, ...bySrc[s] });
      allIndiaBySrc[s] = sumFields(allIndiaBySrc[s] || {}, bySrc[s]);
    }

    const regionGrand = regionRows.reduce(sumFields, {});
    out.push({ kind: 'regionTotal', region, label: `${region} — Total`, ...regionGrand });
    allIndiaGrand = sumFields(allIndiaGrand, regionGrand);
  }

  const allOrderedSrcs = HYBRID_SRC_ORDER.filter((s) => allIndiaBySrc[s])
    .concat(Object.keys(allIndiaBySrc).filter((s) => !HYBRID_SRC_ORDER.includes(s)));
  for (const s of allOrderedSrcs) {
    out.push({ kind: 'allIndiaSource', label: `All India — Total ${s.charAt(0) + s.slice(1).toLowerCase()}`, ...allIndiaBySrc[s] });
  }
  out.push({ kind: 'allIndiaGrand', label: 'Grand Total', ...allIndiaGrand });

  return out;
}

function HybridTable({ hybridRows, scopeRegionCode, cols }) {
  if (!hybridRows?.length) {
    return <p className="text-[8pt] text-slate-500 italic px-1 py-2">No hybrid projects in the current scope.</p>;
  }
  const enabled = HYBRID_COLUMNS.filter(c => !cols || cols.has(c.key));
  // For RLDC users the data covers a single region, so the All India footer
  // would duplicate the region totals — drop it (same as the pipeline tables).
  const display = buildHybridDisplayRows(hybridRows)
    .filter(r => !scopeRegionCode || (r.kind !== 'allIndiaSource' && r.kind !== 'allIndiaGrand'));

  // Vertically merge the Region cell across each region's run of rows, and the
  // Hybrid Type cell across its component rows.
  const regionSpan = new Map();
  const typeSpan = new Map();
  for (let i = 0; i < display.length; i++) {
    const r = display[i];
    if (r.kind === 'allIndiaSource' || r.kind === 'allIndiaGrand') continue;
    const prev = display[i - 1];
    if (!prev || prev.region !== r.region || prev.kind === 'allIndiaSource' || prev.kind === 'allIndiaGrand') {
      let n = 0;
      for (let j = i; j < display.length; j++) {
        if (display[j].region === r.region && display[j].kind !== 'allIndiaSource' && display[j].kind !== 'allIndiaGrand') n++;
        else break;
      }
      regionSpan.set(i, n);
    }
    if (r.kind === 'data' && (!prev || prev.kind !== 'data' || prev.region !== r.region || prev.hybridType !== r.hybridType)) {
      let n = 0;
      for (let j = i; j < display.length; j++) {
        if (display[j].kind === 'data' && display[j].region === r.region && display[j].hybridType === r.hybridType) n++;
        else break;
      }
      typeSpan.set(i, n);
    }
  }

  return (
    <table>
      <thead>
        <tr>
          <th style={{ width: 40, textAlign: 'left' }}>Region</th>
          <th style={{ width: 110, textAlign: 'left' }}>Hybrid Type</th>
          <th style={{ width: 60, textAlign: 'left' }}>Source (Type)</th>
          {enabled.map(c => (
            <th key={c.key} style={{ width: c.width }}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {display.map((r, i) => {
          const numCells = enabled.map(c => (
            <td key={c.key} style={{ textAlign: 'right' }}>{fmt(c.get(r))}</td>
          ));
          if (r.kind === 'data') {
            return (
              <tr key={i}>
                {regionSpan.has(i) && (
                  <td rowSpan={regionSpan.get(i)} style={{ fontWeight: 700, verticalAlign: 'middle', textAlign: 'center' }}>{r.region}</td>
                )}
                {typeSpan.has(i) && (
                  <td rowSpan={typeSpan.get(i)} style={{ fontWeight: 500, verticalAlign: 'middle' }}>{r.hybridType}</td>
                )}
                <td>{r.sourceType}</td>
                {numCells}
              </tr>
            );
          }
          const isGrand = r.kind === 'allIndiaGrand';
          return (
            <tr key={i} className={isGrand ? 'total-row' : 'subtotal-row'}>
              {regionSpan.has(i) && (
                <td rowSpan={regionSpan.get(i)} style={{ fontWeight: 700, verticalAlign: 'middle', textAlign: 'center' }}>{r.region}</td>
              )}
              <td colSpan={r.kind === 'allIndiaSource' || r.kind === 'allIndiaGrand' ? 3 : 2} style={{ fontWeight: 700 }}>{r.label}</td>
              {numCells}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Per-source project detail table ──────────────────────────────────────────

function SourceProjectTable({ source, projects, scopeRegionCode, cols }) {
  const cleared = (projects ?? []).filter(p => {
    if (p.contd4?.status !== 'CLEARED') return false;
    return getProjectSource(p) === source;
  });
  if (!cleared.length) return null;

  const has = (key) => !cols || cols.has(key);
  // Sr. / Generating Station / Region identify the row and are always shown.
  const labelColSpan = 3 + (has('pooling') ? 1 : 0);

  // sort by region order
  const sorted = [...cleared].sort((a, b) =>
    REGION_ORDER.indexOf(a.region?.code) - REGION_ORDER.indexOf(b.region?.code)
  );

  // compute totals
  const total = sorted.reduce((acc, p) => {
    const ph = p.phases?.[0] ?? {};
    acc.total    += Number(p.totalCapacityMw ?? 0);
    acc.applied  += Number(ph.capacityAppliedMw ?? 0);
    acc.ftcOK    += Number(ph.ftcCompletedMw ?? 0);
    acc.ftcPend  += Number(ph.capacityUnderFtcMw ?? 0);
    acc.tocOK    += Number(ph.tocIssuedMw ?? 0);
    acc.tocPend  += Number(ph.capacityUnderTocMw ?? 0);
    acc.codOK    += Number(ph.codDeclaredMw ?? 0);
    acc.codPend  += Math.max(0, Number(ph.tocIssuedMw ?? 0) - Number(ph.codDeclaredMw ?? 0));
    acc.exp      += Number(ph.expectedApr26Mw ?? 0);
    return acc;
  }, { total:0, applied:0, ftcOK:0, ftcPend:0, tocOK:0, tocPend:0, codOK:0, codPend:0, exp:0 });

  return (
    <div>
      <table>
        <thead>
          <tr>
            <th style={{ width: 22, textAlign: 'center' }}>Sr.</th>
            <th style={{ textAlign: 'left' }}>Generating Station</th>
            {has('pooling') && <th style={{ width: 80, textAlign: 'left' }}>Pooling Station</th>}
            <th style={{ width: 30, textAlign: 'center' }}>Rgn.</th>
            {has('total')   && <th style={{ width: 48 }}>Total Capacity (MW)</th>}
            {has('applied') && <th style={{ width: 44 }}>Applied (MW)</th>}
            {has('ftcOK')   && <th style={{ width: 44 }}>FTC OK (MW)</th>}
            {has('ftcPend') && <th style={{ width: 44 }}>FTC Pend (MW)</th>}
            {has('tocOK')   && <th style={{ width: 44 }}>TOC OK (MW)</th>}
            {has('tocPend') && <th style={{ width: 44 }}>TOC Pend (MW)</th>}
            {has('codOK')   && <th style={{ width: 44 }}>COD OK (MW)</th>}
            {has('codPend') && <th style={{ width: 44 }}>COD Pend (MW)</th>}
            {has('exp')     && <th style={{ width: 48 }}>Expected (MW)</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => {
            const ph = p.phases?.[0] ?? {};
            const codPend = Math.max(0, Number(ph.tocIssuedMw ?? 0) - Number(ph.codDeclaredMw ?? 0));
            return (
              <tr key={p.id ?? i} className={i % 2 === 1 ? 'stripe' : ''}>
                <td style={{ textAlign: 'center', color: '#64748b' }}>{i + 1}</td>
                <td style={{ fontWeight: 500 }}>{p.name}</td>
                {has('pooling') && <td style={{ color: '#475569' }}>{p.poolingStation?.name ?? '—'}</td>}
                <td style={{ textAlign: 'center', fontWeight: 700 }}>{p.region?.code}</td>
                {has('total')   && <td style={{ textAlign: 'right' }}>{fmt(p.totalCapacityMw)}</td>}
                {has('applied') && <td style={{ textAlign: 'right' }}>{fmt(ph.capacityAppliedMw)}</td>}
                {has('ftcOK')   && <td style={{ textAlign: 'right' }}>{fmt(ph.ftcCompletedMw)}</td>}
                {has('ftcPend') && <td style={{ textAlign: 'right' }}>{fmt(ph.capacityUnderFtcMw)}</td>}
                {has('tocOK')   && <td style={{ textAlign: 'right' }}>{fmt(ph.tocIssuedMw)}</td>}
                {has('tocPend') && <td style={{ textAlign: 'right' }}>{fmt(ph.capacityUnderTocMw)}</td>}
                {has('codOK')   && <td style={{ textAlign: 'right' }}>{fmt(ph.codDeclaredMw)}</td>}
                {has('codPend') && <td style={{ textAlign: 'right' }}>{codPend > 0.01 ? fmt(codPend) : '—'}</td>}
                {has('exp')     && <td style={{ textAlign: 'right' }}>{fmt(ph.expectedApr26Mw)}</td>}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="subtotal-row">
            <td colSpan={labelColSpan} style={{ fontWeight: 700 }}>{scopeRegionCode ?? 'All India'} {source} Total ({sorted.length} projects)</td>
            {has('total')   && <td style={{ textAlign: 'right' }}>{fmt(total.total)}</td>}
            {has('applied') && <td style={{ textAlign: 'right' }}>{fmt(total.applied)}</td>}
            {has('ftcOK')   && <td style={{ textAlign: 'right' }}>{fmt(total.ftcOK)}</td>}
            {has('ftcPend') && <td style={{ textAlign: 'right' }}>{fmt(total.ftcPend)}</td>}
            {has('tocOK')   && <td style={{ textAlign: 'right' }}>{fmt(total.tocOK)}</td>}
            {has('tocPend') && <td style={{ textAlign: 'right' }}>{fmt(total.tocPend)}</td>}
            {has('codOK')   && <td style={{ textAlign: 'right' }}>{fmt(total.codOK)}</td>}
            {has('codPend') && <td style={{ textAlign: 'right' }}>{fmt(total.codPend > 0.01 ? total.codPend : 0)}</td>}
            {has('exp')     && <td style={{ textAlign: 'right' }}>{fmt(total.exp)}</td>}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Print control toolbar (screen only) ──────────────────────────────────────

function PrintToolbar({ dateLabel, panelOpen, onTogglePanel }) {
  return (
    <div className="no-print fixed top-0 left-0 right-0 z-50 bg-slate-800 text-white flex items-center gap-3 px-5 py-2.5 shadow-lg">
      <div className="flex items-center gap-2 mr-auto">
        <svg className="size-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span className="text-sm font-semibold">Print Summary — As on {dateLabel}</span>
        <span className="text-slate-400 text-xs">· A3 Landscape recommended</span>
      </div>
      <button
        onClick={onTogglePanel}
        className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors ${panelOpen ? 'bg-blue-600 hover:bg-blue-500' : 'bg-slate-600 hover:bg-slate-500'}`}
      >
        <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
        </svg>
        Customize
      </button>
      <button
        onClick={() => window.print()}
        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 px-4 py-1.5 rounded text-sm font-semibold transition-colors"
      >
        <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
        </svg>
        Print / Save as PDF
      </button>
      <button
        onClick={() => window.close()}
        className="flex items-center gap-2 bg-slate-600 hover:bg-slate-500 px-3 py-1.5 rounded text-sm transition-colors"
      >
        Close
      </button>
    </div>
  );
}

// ── Customization panel (screen only) ─────────────────────────────────────────
// Lets the user drop whole tables or individual pipeline columns before
// printing / saving to PDF. Everything is selected by default.

// Section order mirrors the dashboard tab order: FTC Pipeline, CONTD-4 Study,
// Hybrid Breakdown, Source-wise, Transmission, Project Details.
const PRINT_TABLES = [
  { id: 'region',       label: 'FTC Pipeline (Region-wise)' },
  { id: 'contd4',       label: 'CONTD-4 Study' },
  { id: 'hybrid',       label: 'Hybrid Breakdown' },
  { id: 'source',       label: 'Source-wise Pipeline' },
  { id: 'transmission', label: 'Transmission' },
  { id: 'activity',     label: 'Inter-State COD Activity (monthly)' },
  { id: 'sources',      label: 'Per-source Project Details' },
];

function CheckRow({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-2 py-0.5 cursor-pointer select-none hover:text-slate-900">
      <input type="checkbox" checked={checked} onChange={onChange} className="size-3.5 accent-blue-600" />
      <span className="text-[12px] text-slate-700">{label}</span>
    </label>
  );
}

function ColumnGroup({ title, columns, set, onChange }) {
  const all = new Set(columns.map(c => c.key));
  const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
  const toggle = (key) => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    onChange(next);
  };
  return (
    <div className="border border-slate-200 rounded-md p-2.5">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{title}</p>
        <button
          onClick={() => onChange(sameSet(set, all) ? new Set() : new Set(all))}
          className="text-[11px] text-blue-600 hover:underline"
        >
          {sameSet(set, all) ? 'Clear all' : 'Select all'}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-4">
        {columns.map(c => (
          <CheckRow key={c.key} label={c.label.replace(' (MW)', '')} checked={set.has(c.key)} onChange={() => toggle(c.key)} />
        ))}
      </div>
    </div>
  );
}

// Per-table column groups: each visible table gets its own column picker, with
// only the columns that table actually has.
function PrintControls({ tables, setTables, colSets, setColSet, contd4Months, activityMonths = [] }) {
  const toggleTable = (id) => {
    const next = new Set(tables);
    next.has(id) ? next.delete(id) : next.add(id);
    setTables(next);
  };
  const allTables = new Set(PRINT_TABLES.map(t => t.id));
  const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));

  const contd4AllCols = [...CONTD4_COLUMNS, ...contd4Months.map(contd4MonthCol)];
  // Each activity month is a "column" toggle so users can exclude months they
  // don't need from the per-month COD tables.
  const activityMonthCols = activityMonths.map((m) => ({ key: m.key, label: m.label }));
  const GROUPS = [
    { id: 'region',       title: 'FTC Pipeline columns',       columns: PIPE_COLUMNS },
    { id: 'contd4',       title: 'CONTD-4 Study columns',      columns: contd4AllCols },
    { id: 'hybrid',       title: 'Hybrid Breakdown columns',   columns: HYBRID_COLUMNS },
    { id: 'source',       title: 'Source-wise columns',        columns: PIPE_COLUMNS },
    { id: 'transmission', title: 'Transmission columns',       columns: TX_COLUMNS },
    { id: 'activity',     title: 'COD Activity months',        columns: activityMonthCols },
    { id: 'sources',      title: 'Project Details columns',    columns: PROJECT_COLUMNS },
  ];

  return (
    <div className="no-print fixed top-[52px] left-0 right-0 z-40 bg-white border-b border-slate-200 shadow-md px-5 py-3 max-h-[70vh] overflow-y-auto">
      <div className="max-w-[1280px] mx-auto grid grid-cols-1 md:grid-cols-[230px_1fr] gap-6">
        {/* Tables */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Tables</p>
            <button
              onClick={() => setTables(sameSet(tables, allTables) ? new Set() : new Set(allTables))}
              className="text-[11px] text-blue-600 hover:underline"
            >
              {sameSet(tables, allTables) ? 'Clear all' : 'Select all'}
            </button>
          </div>
          {PRINT_TABLES.map(t => (
            <CheckRow key={t.id} label={t.label} checked={tables.has(t.id)} onChange={() => toggleTable(t.id)} />
          ))}
          <p className="text-[10px] text-slate-400 mt-1.5">Each selected table gets its own column picker on the right. Identifying columns (Region, Source, station name…) are always included.</p>
        </div>
        {/* Per-table columns — only for tables that are switched on */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {GROUPS.filter(g => tables.has(g.id)).map(g => (
            <ColumnGroup
              key={g.id}
              title={g.title}
              columns={g.columns}
              set={colSets[g.id]}
              onChange={(next) => setColSet(g.id, next)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function PrintSummaryClient({ dateLabel, excludeCommissioned = false, scopeRegionCode = null, scopeRegionName = null, table2Rows, table5Rows, contd4Study, transmissionRows, hybridRows, projects, activityMonths = [] }) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [tables, setTables] = useState(() => new Set(PRINT_TABLES.map(t => t.id)));
  // One column set per table — everything on by default.
  const contd4Months = contd4Study?.allMonths ?? [];
  const [colSets, setColSets] = useState(() => ({
    region:       new Set(PIPE_COLUMNS.map(c => c.key)),
    source:       new Set(PIPE_COLUMNS.map(c => c.key)),
    contd4:       new Set([...CONTD4_COLUMNS, ...contd4Months.map(contd4MonthCol)].map(c => c.key)),
    hybrid:       new Set(HYBRID_COLUMNS.map(c => c.key)),
    transmission: new Set(TX_COLUMNS.map(c => c.key)),
    activity:     new Set(activityMonths.map(m => m.key)),
    sources:      new Set(PROJECT_COLUMNS.map(c => c.key)),
  }));
  const setColSet = (id, next) => setColSets(prev => ({ ...prev, [id]: next }));

  // No auto-print: the user lands on the page so the Customize / Print controls
  // are visible. They adjust tables & columns, then hit "Print / Save as PDF".
  const togglePanel = () => setPanelOpen(o => !o);

  const availableSources = SOURCE_ORDER.filter(src =>
    (projects ?? []).some(p => {
      if (p.contd4?.status !== 'CLEARED') return false;
      return getProjectSource(p) === src;
    })
  );

  // Renumber only the visible tables so the badges stay sequential.
  let tableNo = 0;
  const nextNo = () => (++tableNo);

  return (
    <>
      <style>{PRINT_STYLES}</style>
      <style>{`
        body { background: #f1f5f9; }
        .print-page { background: #fff; width: 297mm; min-height: 200mm; margin: 0 auto; padding: 0; }
        .inner { padding: 14mm 12mm; }
        .stripe { background-color: #f8fafc !important; }
        @media screen { body { padding-top: 44px; } }
        @media print { body { background: #fff !important; padding-top: 0 !important; } .print-page { width: 100%; box-shadow: none; } .inner { padding: 0; } }
      `}</style>

      <PrintToolbar dateLabel={dateLabel} panelOpen={panelOpen} onTogglePanel={togglePanel} />
      {panelOpen && (
        <PrintControls
          tables={tables}
          setTables={setTables}
          colSets={colSets}
          setColSet={setColSet}
          contd4Months={contd4Months}
          activityMonths={activityMonths}
        />
      )}

      <div className="print-page">
        <div className="inner">
          <DocHeader dateLabel={dateLabel} scopeRegionCode={scopeRegionCode} scopeRegionName={scopeRegionName} excludeCommissioned={excludeCommissioned} />

          {/* Sections mirror the dashboard tab order. */}

          {/* ── FTC Pipeline (Region-wise) ── */}
          {tables.has('region') && (
            <div className="mb-6">
              <SectionTitle tableNo={nextNo()}>
                Total ISTS Generation Capacity Details Under FTC / TOC / COD (MW) — Region-wise
              </SectionTitle>
              <PipelineTable rows={table2Rows} primaryKey="region" scopeRegionCode={scopeRegionCode} cols={colSets.region} />
            </div>
          )}

          {/* ── CONTD-4 Study ── */}
          {tables.has('contd4') && (
            <div className="mb-6">
              <SectionTitle tableNo={nextNo()}>
                Total Capacity Under CONTD-4 Study (MW) — Region &amp; Source-wise
              </SectionTitle>
              <Contd4Table contd4Study={contd4Study} scopeRegionCode={scopeRegionCode} cols={colSets.contd4} />
            </div>
          )}

          {/* ── Hybrid Breakdown ── */}
          {tables.has('hybrid') && (
            <div className="mb-6 page-break">
              <SectionTitle tableNo={nextNo()}>
                Total Hybrid Capacity Details Under FTC / TOC / COD (MW)
              </SectionTitle>
              <HybridTable hybridRows={hybridRows} scopeRegionCode={scopeRegionCode} cols={colSets.hybrid} />
            </div>
          )}

          {/* ── Source-wise Pipeline ── */}
          {tables.has('source') && (
            <div className="mb-6 page-break">
              <SectionTitle tableNo={nextNo()}>
                Total ISTS Generation Capacity Details Under FTC / TOC / COD (MW) — Source-wise
              </SectionTitle>
              <PipelineTable rows={table5Rows} primaryKey="source" scopeRegionCode={scopeRegionCode} cols={colSets.source} />
            </div>
          )}

          {/* ── Transmission ── */}
          {tables.has('transmission') && (
            <div className="mb-6">
              <SectionTitle tableNo={nextNo()}>
                Transmission Elements Under Process of FTC — Region-wise
              </SectionTitle>
              <TransmissionTable transmissionRows={transmissionRows} cols={colSets.transmission} />
            </div>
          )}

          {/* ── Inter-State COD Activity — one matrix per month (last 3) ── */}
          {tables.has('activity') && activityMonths.some((m) => colSets.activity.has(m.key)) && (
            <div className="mb-6 page-break">
              <SectionTitle tableNo={nextNo()}>
                Inter-State COD Declared Capacity (MW) — Month-wise
              </SectionTitle>
              {activityMonths.filter((m) => colSets.activity.has(m.key)).map((m) => (
                <div key={m.key} className="mb-4 avoid-break">
                  <p className="text-[8.5pt] font-bold text-[#1e3a5f] mb-1">Inter-State COD Declared Capacity (MW) in {m.label}</p>
                  <ActivityMatrix activity={m.activity} scopeRegionCode={scopeRegionCode} />
                </div>
              ))}
            </div>
          )}

          {/* ── Per-source project detail tables ── */}
          {tables.has('sources') && (() => {
            const detailNo = nextNo();
            return availableSources.map((src, idx) => (
              <div key={src} className="mb-6 page-break">
                <SectionTitle tableNo={`${detailNo}.${idx + 1}`}>
                  {src} — Project-wise ISTS Generation Capacity Details Under FTC / TOC / COD
                </SectionTitle>
                <SourceProjectTable source={src} projects={projects} scopeRegionCode={scopeRegionCode} cols={colSets.sources} />
              </div>
            ));
          })()}

          {/* Footer */}
          <div className="mt-8 pt-3 border-t border-slate-200 flex justify-between text-[7pt] text-slate-400">
            <span>FTC Communication Portal — {scopeRegionCode ? `${scopeRegionCode}LDC` : 'NLDC, New Delhi'}</span>
            <span>Generated: {new Date().toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' })}</span>
            <span>As on: {dateLabel}</span>
          </div>
        </div>
      </div>
    </>
  );
}
