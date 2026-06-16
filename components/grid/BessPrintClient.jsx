'use client';

// Browser-printable BESS Data view — branded like the dashboard print view
// (PrintSummaryClient): navy DocHeader + section bar, navy table headers,
// slate subtotal rows, navy grand-total, and a footer. Screen shows a toolbar
// (Print / Close); @media print hides it. Reuses prepareBessData so the table
// matches the on-screen BESS table exactly.

import { prepareBessData, fmt } from '@/components/grid/BessDataTab';

const REGION_FULL = { NR: 'Northern Region', WR: 'Western Region', SR: 'Southern Region', ER: 'Eastern Region', NER: 'North-Eastern Region' };

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

function Toolbar({ dateLabel }) {
  return (
    <div className="no-print fixed top-0 left-0 right-0 z-50 bg-slate-800 text-white flex items-center gap-3 px-5 py-2.5 shadow-lg">
      <span className="text-sm font-semibold mr-auto">BESS Data — As on {dateLabel}<span className="text-slate-400 text-xs"> · A3 Landscape recommended</span></span>
      <button
        onClick={() => window.print()}
        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 px-4 py-1.5 rounded text-sm font-semibold transition-colors"
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

function DataRow({ row, sr, intra }) {
  return (
    <tr className={intra ? 'intra-row' : (sr % 2 === 0 ? 'stripe' : '')}>
      <td style={{ color: '#64748b' }}>{sr}</td>
      <td style={{ textAlign: 'left', fontWeight: 500 }}>{row.name}</td>
      <td>{row.poolingStation}</td>
      <td>{row.plantType}</td>
      <td style={{ fontWeight: 700 }}>{row.region}</td>
      <td style={{ textAlign: 'right' }}>{fmt(row.totalCapacityMw)}</td>
      <td>{row.stateName || '—'}</td>
      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(row.codDeclared)}</td>
      <td style={{ textAlign: 'right' }}>{row.energyMwh != null ? fmt(row.energyMwh) : '—'}</td>
      <td style={{ textAlign: 'right', color: '#6d28d9', fontWeight: 600 }}>{fmt(row.codInRefMonth)}</td>
      <td style={{ textAlign: 'left', fontSize: '7pt' }}>
        {row.codDateLines.length ? row.codDateLines.map((l, i) => <div key={i}>{l}</div>) : ''}
      </td>
    </tr>
  );
}

function TotalRow({ label, totals, grand }) {
  return (
    <tr className={grand ? 'total-row' : 'subtotal-row'}>
      <td colSpan={7} style={{ textAlign: 'center' }}>{label}</td>
      <td style={{ textAlign: 'right' }}>{fmt(totals.codDeclared)}</td>
      <td style={{ textAlign: 'right' }}>{totals.energyMwh > 0 ? fmt(totals.energyMwh) : '—'}</td>
      <td style={{ textAlign: 'right' }}>{totals.codInRefMonth > 0 ? fmt(totals.codInRefMonth) : '0'}</td>
      <td />
    </tr>
  );
}

export function BessPrintClient({ bessProjects, referenceMonth, scopeRegionCode = null, scopeRegionName = null, dateLabel }) {
  const { interstate, intrastate, interTotals, intraTotals, grandTotals } = prepareBessData(bessProjects, referenceMonth);
  const refMonthName = fmtRefMonth(referenceMonth);
  const refColLabel = refMonthName ? `COD Declared in ${refMonthName} (BESS)` : 'COD Declared in ref. month (BESS)';
  const hasRows = interstate.length + intrastate.length > 0;
  const generatedLabel = new Date().toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' });
  const regionFooter = scopeRegionCode ? `${scopeRegionCode}LDC` : 'NLDC, New Delhi';

  return (
    <>
      <style>{PRINT_STYLES}</style>
      <Toolbar dateLabel={dateLabel} />

      <div className="bess-print-page">
        <div className="inner">
          <DocHeader dateLabel={dateLabel} scopeRegionCode={scopeRegionCode} scopeRegionName={scopeRegionName} />

          {!hasRows ? (
            <p className="text-[9pt] text-slate-500 italic py-6 text-center">No BESS projects in the current scope.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 26 }}>Sr.</th>
                  <th style={{ textAlign: 'left' }}>Generating Station</th>
                  <th style={{ width: 90 }}>Pooling Station</th>
                  <th style={{ width: 110 }}>Plant Type</th>
                  <th style={{ width: 40 }}>Region</th>
                  <th style={{ width: 64 }}>Total Capacity (MW)</th>
                  <th style={{ width: 80 }}>State (situated)</th>
                  <th style={{ width: 70 }}>COD declared Capacity (MW)</th>
                  <th style={{ width: 76 }}>Energy Commissioned (MWh)</th>
                  <th style={{ width: 78 }}>{refColLabel}</th>
                  <th style={{ width: 130, textAlign: 'left' }}>COD Date Declared</th>
                </tr>
              </thead>
              <tbody>
                {interstate.map((row, i) => <DataRow key={row.id} row={row} sr={i + 1} />)}
                <TotalRow label="Total — Inter-state BESS" totals={interTotals} />
                {intrastate.map((row, i) => <DataRow key={row.id} row={row} sr={i + 1} intra />)}
                {intrastate.length > 0 && <TotalRow label="Total — Intra-state BESS" totals={intraTotals} />}
                <TotalRow label="Total BESS" totals={grandTotals} grand />
              </tbody>
            </table>
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
