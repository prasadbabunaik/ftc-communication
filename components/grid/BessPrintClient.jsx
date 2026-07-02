'use client';

// Browser-printable BESS Data view — branded like the dashboard print view
// (PrintSummaryClient): navy DocHeader, navy table headers, slate subtotal
// rows, navy grand-total, and a footer. Screen shows a toolbar (Customize /
// Print / Close) with a column picker; @media print hides it. Reuses
// prepareBessData so the table matches the on-screen BESS table exactly.

import { useState } from 'react';
import { prepareBessData, fmt, computeBessCommissioningSummary, monthsInRange, bMonthLabel } from '@/components/grid/BessDataTab';

function fmtRefMonth(ym) {
  if (!ym) return null;
  const [y, m] = ym.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[parseInt(m, 10) - 1]}'${y.slice(2)}`;
}

const PRINT_STYLES = `
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  @page { size: A3 landscape; margin: 12mm 10mm 12mm 10mm; }
  body { font-family: 'Arial', sans-serif; font-size: 8pt; color: #1a1a2e; background: #f1f5f9; }
  .bess-print-page { background: #fff; width: 410mm; min-height: 200mm; margin: 0 auto; }
  .inner { padding: 12mm 10mm; }
  table { border-collapse: collapse; width: 100%; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th, td { border: 1px solid #cbd5e1; padding: 3px 5px; text-align: center; }
  thead th { background-color: #1e3a5f !important; color: #fff !important; font-weight: 700; }
  .subtotal-row td { background-color: #e2e8f0 !important; font-weight: 700; }
  .total-row td { background-color: #1e3a5f !important; color: #fff !important; font-weight: 700; }
  .intra-row td { background-color: #fefce8 !important; }
  .stripe { background-color: #f8fafc !important; }
  @media screen { body { padding-top: 48px; } }
  @media print {
    body { background: #fff !important; padding-top: 0 !important; }
    .bess-print-page { width: 100%; }
    .inner { padding: 0; }
    .no-print { display: none !important; }
  }
`;

// Column model. `group: 'label'` columns form the left identifying block (the
// total rows span across all visible ones); `group: 'value'` columns carry the
// numeric figures and a per-column total renderer. `always` columns can't be
// switched off. `short` is the label shown in the column picker.
function buildColumns(refColLabel, useRange = false) {
  return [
    { key: 'sr',      label: 'Sr.',                        group: 'label', always: true, width: 26,  align: 'center',
      render: (row, sr) => sr, cellStyle: { color: '#64748b' } },
    { key: 'name',    label: 'Generating Station',         group: 'label', always: true, align: 'left',
      render: (row) => row.name, cellStyle: { textAlign: 'left', fontWeight: 500 } },
    { key: 'pooling', label: 'Pooling Station',            group: 'label', width: 90,
      render: (row) => row.poolingStation },
    { key: 'plant',   label: 'Plant Type',                 group: 'label', width: 110,
      render: (row) => row.plantType },
    { key: 'region',  label: 'Region',                     group: 'label', always: true, width: 40,
      render: (row) => row.region, cellStyle: { fontWeight: 700 } },
    { key: 'total',   label: 'Total Capacity (MW)',        group: 'label', width: 64, short: 'Total Capacity',
      render: (row) => fmt(row.totalCapacityMw), cellStyle: { textAlign: 'right' } },
    { key: 'state',   label: 'State (situated)',           group: 'label', width: 80, short: 'State (situated)',
      render: (row) => row.stateName || '—' },
    { key: 'codCap',  label: 'COD declared Capacity (MW)', group: 'value', width: 70, short: 'COD declared Capacity',
      render: (row) => fmt(row.codDeclared), cellStyle: { textAlign: 'right', fontWeight: 600 },
      total: (t) => fmt(t.codDeclared) },
    { key: 'energy',  label: 'Energy Commissioned (MWh)',  group: 'value', width: 76, short: 'Energy Commissioned',
      render: (row) => (row.energyMwh != null ? fmt(row.energyMwh) : '—'), cellStyle: { textAlign: 'right' },
      total: (t) => (t.energyMwh > 0 ? fmt(t.energyMwh) : '—') },
    { key: 'codRef',  label: refColLabel,                  group: 'value', width: 78, short: 'COD in ref. month',
      render: (row) => fmt(useRange ? row.codInRange : row.codInRefMonth), cellStyle: { textAlign: 'right', color: '#6d28d9', fontWeight: 600 },
      total: (t) => ((useRange ? t.codInRange : t.codInRefMonth) > 0 ? fmt(useRange ? t.codInRange : t.codInRefMonth) : '0') },
    { key: 'codDates', label: 'COD Date Declared',         group: 'value', width: 130, align: 'left', short: 'COD Date Declared',
      render: (row) => (row.codDateLines.length ? row.codDateLines.map((l, i) => <div key={i}>{l}</div>) : ''),
      cellStyle: { textAlign: 'left', fontSize: '7pt' }, total: () => '' },
  ];
}

function DocHeader({ dateLabel, scopeRegionCode, scopeRegionName }) {
  const scopeLabel = scopeRegionName ?? 'All India';
  const issuerLabel = scopeRegionCode
    ? `${scopeRegionCode}LDC — Regional Load Despatch Centre`
    : 'National Load Despatch Centre';
  return (
    <div className="mb-4 border-b-2 border-[#1e3a5f] pb-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[7pt] font-bold text-[#1e3a5f] uppercase tracking-widest mb-0.5">{issuerLabel}</div>
          <h1 className="text-[13pt] font-black text-[#1e3a5f] leading-tight">BESS Data — Battery Energy Storage Systems</h1>
          <h2 className="text-[11pt] font-bold text-[#1e3a5f]">Inter-state &amp; Intra-state — {scopeLabel}</h2>
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

function Toolbar({ dateLabel, panelOpen, onToggleCustomize }) {
  return (
    <div className="no-print fixed top-0 left-0 right-0 z-50 bg-slate-800 text-white flex items-center gap-3 px-5 py-2.5 shadow-lg">
      <span className="text-sm font-semibold mr-auto">
        BESS Data — As on {dateLabel}
        <span className="text-slate-400 text-xs"> · A3 Landscape recommended</span>
      </span>
      <button
        onClick={onToggleCustomize}
        className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${panelOpen ? 'bg-blue-600 hover:bg-blue-500' : 'bg-slate-600 hover:bg-slate-500'}`}
      >
        Customize
      </button>
      <button
        onClick={() => window.print()}
        className="bg-blue-600 hover:bg-blue-500 px-4 py-1.5 rounded text-sm font-semibold transition-colors"
      >
        Print / Save as PDF
      </button>
      <button
        onClick={() => window.close()}
        className="bg-slate-600 hover:bg-slate-500 px-3 py-1.5 rounded text-sm transition-colors"
      >
        Close
      </button>
    </div>
  );
}

function ColumnPanel({ toggleable, enabled, onToggle, allOn, onToggleAll, showSummary, onToggleSummary }) {
  return (
    <div className="no-print fixed top-[48px] left-0 right-0 z-40 bg-white border-b border-slate-200 shadow-md px-5 py-3 max-h-[60vh] overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Columns to include</p>
          <button onClick={onToggleAll} className="text-[11px] text-blue-600 hover:underline">
            {allOn ? 'Clear all' : 'Select all'}
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-6 gap-y-1">
          {toggleable.map((c) => (
            <label key={c.key} className="flex items-center gap-2 py-0.5 cursor-pointer select-none hover:text-slate-900">
              <input type="checkbox" checked={enabled.has(c.key)} onChange={() => onToggle(c.key)} className="size-3.5 accent-blue-600" />
              <span className="text-[12px] text-slate-700">{c.short ?? c.label}</span>
            </label>
          ))}
        </div>
        <p className="text-[10px] text-slate-400 mt-1.5">Sr. No, Generating Station and Region are always included.</p>

        <div className="mt-3 pt-2 border-t border-slate-200">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">Sections</p>
          <label className="flex items-center gap-2 py-0.5 cursor-pointer select-none hover:text-slate-900">
            <input type="checkbox" checked={showSummary} onChange={onToggleSummary} className="size-3.5 accent-blue-600" />
            <span className="text-[12px] text-slate-700">BESS Commissioning Summary</span>
          </label>
        </div>
      </div>
    </div>
  );
}

export function BessPrintClient({ bessProjects, referenceMonth, scopeRegionCode = null, scopeRegionName = null, dateLabel, codFrom = '', codTo = '' }) {
  // COD date-range filter (passed from the BESS page via ?codFrom/?codTo). When
  // present, the "COD in month" column follows the filter rather than the
  // reference month — matching the on-screen table.
  const range = (codFrom || codTo) ? { from: codFrom, to: codTo } : null;
  const rangeMonths = range ? monthsInRange(codFrom, codTo) : null;
  const { interstate, intrastate, interTotals, intraTotals, grandTotals } = prepareBessData(bessProjects, referenceMonth, range);
  const refMonthName = fmtRefMonth(referenceMonth);
  const refColLabel = !rangeMonths
    ? (refMonthName ? `COD Declared in ${refMonthName} (BESS)` : 'COD Declared in ref. month (BESS)')
    : rangeMonths.length <= 1
      ? `COD Declared in ${bMonthLabel(rangeMonths[0])} (BESS)`
      : 'COD Declared in Range (BESS)';

  const allColumns = buildColumns(refColLabel, !!range);
  const toggleable = allColumns.filter((c) => !c.always);

  const [enabled, setEnabled] = useState(() => new Set(allColumns.map((c) => c.key)));
  const [panelOpen, setPanelOpen] = useState(false);
  const [showSummary, setShowSummary] = useState(true);

  const summary = computeBessCommissioningSummary(bessProjects);

  const toggle = (key) => {
    const next = new Set(enabled);
    next.has(key) ? next.delete(key) : next.add(key);
    setEnabled(next);
  };
  const allOn = toggleable.every((c) => enabled.has(c.key));
  const toggleAll = () =>
    setEnabled(allOn ? new Set(allColumns.filter((c) => c.always).map((c) => c.key)) : new Set(allColumns.map((c) => c.key)));

  const cols = allColumns.filter((c) => c.always || enabled.has(c.key));
  const labelCols = cols.filter((c) => c.group === 'label');
  const valueCols = cols.filter((c) => c.group === 'value');

  const hasRows = interstate.length + intrastate.length > 0;
  const generatedLabel = new Date().toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' });
  const regionFooter = scopeRegionCode ? `${scopeRegionCode}LDC` : 'NLDC, New Delhi';

  const dataRow = (row, sr, intra) => (
    <tr key={row.id} className={intra ? 'intra-row' : sr % 2 === 0 ? 'stripe' : ''}>
      {cols.map((c) => (
        <td key={c.key} style={c.cellStyle}>{c.render(row, sr)}</td>
      ))}
    </tr>
  );

  const totalRow = (label, totals, grand, key) => (
    <tr key={key} className={grand ? 'total-row' : 'subtotal-row'}>
      <td colSpan={labelCols.length} style={{ textAlign: 'center' }}>{label}</td>
      {valueCols.map((c) => (
        <td key={c.key} style={{ textAlign: c.key === 'codDates' ? 'left' : 'right' }}>{c.total(totals)}</td>
      ))}
    </tr>
  );

  return (
    <>
      <style>{PRINT_STYLES}</style>
      <Toolbar dateLabel={dateLabel} panelOpen={panelOpen} onToggleCustomize={() => setPanelOpen((o) => !o)} />
      {panelOpen && (
        <ColumnPanel
          toggleable={toggleable}
          enabled={enabled}
          onToggle={toggle}
          allOn={allOn}
          onToggleAll={toggleAll}
          showSummary={showSummary}
          onToggleSummary={() => setShowSummary((s) => !s)}
        />
      )}

      <div className="bess-print-page">
        <div className="inner">
          <DocHeader dateLabel={dateLabel} scopeRegionCode={scopeRegionCode} scopeRegionName={scopeRegionName} />

          {!hasRows ? (
            <p className="text-[9pt] text-slate-500 italic py-6 text-center">No BESS projects in the current scope.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c.key} style={{ width: c.width, textAlign: c.align ?? 'center' }}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {interstate.map((row, i) => dataRow(row, i + 1, false))}
                {totalRow('Total — Inter-state BESS', interTotals, false, 'inter-total')}
                {intrastate.map((row, i) => dataRow(row, i + 1, true))}
                {intrastate.length > 0 && totalRow('Total — Intra-state BESS', intraTotals, false, 'intra-total')}
                {totalRow('Total BESS', grandTotals, true, 'grand-total')}
              </tbody>
            </table>
          )}

          {showSummary && summary.rows.length > 0 && (
            <div className="mt-6">
              <div className="text-[10pt] font-bold text-[#1e3a5f] mb-1">
                BESS Commissioning Summary <span className="font-normal text-slate-500">— as on {dateLabel}</span>
              </div>
              <table style={{ width: '70%' }}>
                <thead>
                  <tr>
                    {summary.showKeys && <th style={{ width: 40 }}>Key</th>}
                    <th style={{ textAlign: 'left' }}>Description</th>
                    <th style={{ width: 110 }}>Capacity (MW)</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.map((r, i) => (
                    <tr key={i} className={r.kind === 'grand' ? 'total-row' : r.kind === 'subtotal' ? 'subtotal-row' : ''}>
                      {summary.showKeys && <td style={{ fontFamily: 'monospace', fontSize: '7pt' }}>{r.key}</td>}
                      <td style={{ textAlign: 'left' }}>{r.label}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(r.value) || '0'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer */}
          <div className="mt-8 pt-3 border-t border-slate-200 flex justify-between text-[7pt] text-slate-400">
            <span>FTC Communication Portal — {regionFooter}</span>
            <span>Generated: {generatedLabel}</span>
            <span>As on: {dateLabel}</span>
          </div>
        </div>
      </div>
    </>
  );
}
