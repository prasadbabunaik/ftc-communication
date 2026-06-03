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

function DocHeader({ dateLabel, scopeRegionCode, scopeRegionName }) {
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
          <th style={{ width: 64, textAlign: 'left' }}>{isRegionPrimary ? 'Source' : 'Region'}</th>
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
            : row.isAllIndiaBreakdown ? 'All India'
            : p;
          const label2 = row.isTotal || row.isSubtotal ? '' : s;
          const cls = row.isTotal ? 'total-row' : row.isSubtotal ? 'subtotal-row' : row.isAllIndiaBreakdown ? 'subtotal-row' : (i % 2 === 1 ? 'stripe' : '');
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

// ── CONTD-4 table ─────────────────────────────────────────────────────────────

function Contd4Table({ contd4Study, scopeRegionCode }) {
  const { rows, allMonths } = contd4Study;
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
          <th style={{ width: 70 }}>Total Capacity (MW)</th>
          {allMonths.map(m => (
            <th key={m} style={{ width: 62 }}>Expected by {fmtMonth(m)}</th>
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
              <td style={{ textAlign: 'right' }}>{fmt(row.totalMw)}</td>
              {allMonths.map(m => (
                <td key={m} style={{ textAlign: 'right' }}>{fmt(row.months?.[m] ?? 0)}</td>
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

function TransmissionTable({ transmissionRows }) {
  return (
    <table>
      <thead>
        <tr>
          <th style={{ width: 48, textAlign: 'left' }}>Region</th>
          <th style={{ width: 150, textAlign: 'left' }}>Element Type</th>
          <th style={{ width: 70 }}>FTC Completed (No.)</th>
          <th style={{ width: 80 }}>FTC Completed (ckt km / MVA)</th>
          <th style={{ width: 70 }}>FTC Pending (No.)</th>
          <th style={{ width: 80 }}>FTC Pending (ckt km / MVA)</th>
        </tr>
      </thead>
      <tbody>
        {transmissionRows.map((row, i) => {
          const isLine = row.category?.startsWith('LINE');
          return (
            <tr key={i} className={i % 2 === 1 ? 'stripe' : ''}>
              <td>{row.region}</td>
              <td>{CAT_LABEL[row.category] ?? row.category}</td>
              <td style={{ textAlign: 'right' }}>{row.completedCount || '—'}</td>
              <td style={{ textAlign: 'right' }}>{fmt(isLine ? row.completedKm : row.completedMva)}</td>
              <td style={{ textAlign: 'right' }}>{row.pendingCount || '—'}</td>
              <td style={{ textAlign: 'right' }}>{fmt(isLine ? row.pendingKm : row.pendingMva)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Per-source project detail table ──────────────────────────────────────────

function SourceProjectTable({ source, projects, scopeRegionCode }) {
  const cleared = (projects ?? []).filter(p => {
    if (p.contd4?.status !== 'CLEARED') return false;
    return getProjectSource(p) === source;
  });
  if (!cleared.length) return null;

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
            <th style={{ width: 80, textAlign: 'left' }}>Pooling Station</th>
            <th style={{ width: 30, textAlign: 'center' }}>Rgn.</th>
            <th style={{ width: 48 }}>Total Capacity (MW)</th>
            <th style={{ width: 44 }}>Applied (MW)</th>
            <th style={{ width: 44 }}>FTC OK (MW)</th>
            <th style={{ width: 44 }}>FTC Pend (MW)</th>
            <th style={{ width: 44 }}>TOC OK (MW)</th>
            <th style={{ width: 44 }}>TOC Pend (MW)</th>
            <th style={{ width: 44 }}>COD OK (MW)</th>
            <th style={{ width: 44 }}>COD Pend (MW)</th>
            <th style={{ width: 48 }}>Expected (MW)</th>
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
                <td style={{ color: '#475569' }}>{p.poolingStation?.name ?? '—'}</td>
                <td style={{ textAlign: 'center', fontWeight: 700 }}>{p.region?.code}</td>
                <td style={{ textAlign: 'right' }}>{fmt(p.totalCapacityMw)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(ph.capacityAppliedMw)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(ph.ftcCompletedMw)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(ph.capacityUnderFtcMw)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(ph.tocIssuedMw)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(ph.capacityUnderTocMw)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(ph.codDeclaredMw)}</td>
                <td style={{ textAlign: 'right' }}>{codPend > 0.01 ? fmt(codPend) : '—'}</td>
                <td style={{ textAlign: 'right' }}>{fmt(ph.expectedApr26Mw)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="subtotal-row">
            <td colSpan={4} style={{ fontWeight: 700 }}>{scopeRegionCode ?? 'All India'} {source} Total ({sorted.length} projects)</td>
            <td style={{ textAlign: 'right' }}>{fmt(total.total)}</td>
            <td style={{ textAlign: 'right' }}>{fmt(total.applied)}</td>
            <td style={{ textAlign: 'right' }}>{fmt(total.ftcOK)}</td>
            <td style={{ textAlign: 'right' }}>{fmt(total.ftcPend)}</td>
            <td style={{ textAlign: 'right' }}>{fmt(total.tocOK)}</td>
            <td style={{ textAlign: 'right' }}>{fmt(total.tocPend)}</td>
            <td style={{ textAlign: 'right' }}>{fmt(total.codOK)}</td>
            <td style={{ textAlign: 'right' }}>{fmt(total.codPend > 0.01 ? total.codPend : 0)}</td>
            <td style={{ textAlign: 'right' }}>{fmt(total.exp)}</td>
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

const PRINT_TABLES = [
  { id: 'region',       label: 'Region-wise Pipeline' },
  { id: 'source',       label: 'Source-wise Pipeline' },
  { id: 'contd4',       label: 'CONTD-4 Study' },
  { id: 'transmission', label: 'Transmission' },
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

function PrintControls({ tables, setTables, cols, setCols }) {
  const toggle = (set, setter, id) => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    setter(next);
  };
  const allTables = new Set(PRINT_TABLES.map(t => t.id));
  const allCols   = new Set(PIPE_COLUMNS.map(c => c.key));
  const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));

  return (
    <div className="no-print fixed top-[52px] left-0 right-0 z-40 bg-white border-b border-slate-200 shadow-md px-5 py-3">
      <div className="max-w-[1100px] mx-auto grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6">
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
            <CheckRow key={t.id} label={t.label} checked={tables.has(t.id)} onChange={() => toggle(tables, setTables, t.id)} />
          ))}
        </div>
        {/* Pipeline columns */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Pipeline table columns</p>
            <button
              onClick={() => setCols(sameSet(cols, allCols) ? new Set() : new Set(allCols))}
              className="text-[11px] text-blue-600 hover:underline"
            >
              {sameSet(cols, allCols) ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6">
            {PIPE_COLUMNS.map(c => (
              <CheckRow key={c.key} label={c.label.replace(' (MW)', '')} checked={cols.has(c.key)} onChange={() => toggle(cols, setCols, c.key)} />
            ))}
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5">Region &amp; Source label columns are always included. Applies to the two pipeline tables.</p>
        </div>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function PrintSummaryClient({ dateLabel, scopeRegionCode = null, scopeRegionName = null, table2Rows, table5Rows, contd4Study, transmissionRows, projects }) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [tables, setTables] = useState(() => new Set(PRINT_TABLES.map(t => t.id)));
  const [cols, setCols]     = useState(() => new Set(PIPE_COLUMNS.map(c => c.key)));

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
      {panelOpen && <PrintControls tables={tables} setTables={setTables} cols={cols} setCols={setCols} />}

      <div className="print-page">
        <div className="inner">
          <DocHeader dateLabel={dateLabel} scopeRegionCode={scopeRegionCode} scopeRegionName={scopeRegionName} />

          {/* ── Region-wise Pipeline ── */}
          {tables.has('region') && (
            <div className="mb-6">
              <SectionTitle tableNo={nextNo()}>
                Total Generation Capacity Details Under FTC / TOC / COD (MW) — Region-wise
              </SectionTitle>
              <PipelineTable rows={table2Rows} primaryKey="region" scopeRegionCode={scopeRegionCode} cols={cols} />
            </div>
          )}

          {/* ── Source-wise Pipeline ── */}
          {tables.has('source') && (
            <div className="mb-6 page-break">
              <SectionTitle tableNo={nextNo()}>
                Total Generation Capacity Details Under FTC / TOC / COD (MW) — Source-wise
              </SectionTitle>
              <PipelineTable rows={table5Rows} primaryKey="source" scopeRegionCode={scopeRegionCode} cols={cols} />
            </div>
          )}

          {/* ── CONTD-4 Study ── */}
          {tables.has('contd4') && (
            <div className="mb-6">
              <SectionTitle tableNo={nextNo()}>
                Total Capacity Under CONTD-4 Study (MW) — Region &amp; Source-wise
              </SectionTitle>
              <Contd4Table contd4Study={contd4Study} scopeRegionCode={scopeRegionCode} />
            </div>
          )}

          {/* ── Transmission ── */}
          {tables.has('transmission') && (
            <div className="mb-6">
              <SectionTitle tableNo={nextNo()}>
                Transmission Elements Under Process of FTC — Region-wise
              </SectionTitle>
              <TransmissionTable transmissionRows={transmissionRows} />
            </div>
          )}

          {/* ── Per-source project detail tables ── */}
          {tables.has('sources') && (() => {
            const detailNo = nextNo();
            return availableSources.map((src, idx) => (
              <div key={src} className="mb-6 page-break">
                <SectionTitle tableNo={`${detailNo}.${idx + 1}`}>
                  {src} — Project-wise Generation Capacity Details Under FTC / TOC / COD
                </SectionTitle>
                <SourceProjectTable source={src} projects={projects} scopeRegionCode={scopeRegionCode} />
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
