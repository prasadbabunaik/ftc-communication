'use client';

// Standalone BESS Data page — the same table the dashboard surfaces in a tab,
// here as a full sidebar page with an Excel download and a print / PDF view.
// Reuses the row-shaping helpers from BessDataTab so the export matches the
// on-screen view.

import { useState, useMemo } from 'react';
import { BatteryCharging, Sheet, Printer, CalendarRange, X } from 'lucide-react';
import * as XLSX from 'xlsx-js-style';
import { useSettings } from '@/providers/settings-provider';
import { BessDataTab, prepareBessData, projectCodDates, fmt, fmtDate } from '@/components/grid/BessDataTab';
import { BessEditModal } from '@/components/grid/BessEditModal';

function fmtRefMonthShort(ym) {
  if (!ym) return 'Expected';
  try {
    const d = new Date(`${ym}-01`);
    return `Exp. ${d.toLocaleString('en-US', { month: 'short' })}'${String(d.getFullYear()).slice(2)}`;
  } catch { return 'Expected'; }
}

// Display column headers, in order. `{ref}` placeholder is filled with the
// reference-month label so the export header matches the table header.
function headerLabels(refMonthName) {
  return [
    'Sr. No',
    'Generating Station',
    'Pooling Station',
    'Plant Type',
    'Region',
    'Total Capacity (MW)',
    'State (situated)',
    'COD declared Capacity (MW)',
    'Energy Commissioned (MWh)',
    `COD Declared in ${refMonthName} (BESS)`,
    'COD Date Declared',
  ];
}

// Round to 2 decimals, returning a real Number (so Excel keeps it numeric) but
// without floating-point noise like 245.54000000000002. Empty string for blanks.
function round2(v) {
  if (v == null || Number(v) === 0) return '';
  return Math.round(Number(v) * 100) / 100;
}

// One display row → array of cell values (Sr. No prepended by the caller).
function rowCells(row, sr) {
  return [
    sr,
    row.name,
    row.poolingStation,
    row.plantType,
    row.region,
    round2(row.totalCapacityMw),
    row.stateName || '',
    round2(row.codDeclared),
    row.energyMwh != null ? round2(row.energyMwh) : '',
    round2(row.codInRefMonth),
    row.codDateLines.join('\n'),
  ];
}

function totalCells(label, totals) {
  return [
    label, '', '', '', '', '', '',
    round2(totals.codDeclared),
    totals.energyMwh > 0 ? round2(totals.energyMwh) : '',
    totals.codInRefMonth > 0 ? round2(totals.codInRefMonth) : 0,
    '',
  ];
}

// ── Excel ───────────────────────────────────────────────────────────────────
const NAVY = '1E3A5F';
const X_BORDER  = { style: 'thin', color: { rgb: 'CBD5E1' } };
const X_BORDERS = { top: X_BORDER, bottom: X_BORDER, left: X_BORDER, right: X_BORDER };

function downloadBessExcel(prepared, refMonthName, headerInfo = {}) {
  const { interstate, intrastate, interTotals, intraTotals, grandTotals } = prepared;
  const headers = headerLabels(refMonthName);
  const colCount = headers.length;

  const issuerLabel = headerInfo.issuerLabel ?? 'National Load Despatch Centre';
  const scopeLabel  = headerInfo.scopeLabel ?? 'All India';
  const asOn        = headerInfo.dateLabel ?? new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const aoa = [];
  const merges = [];
  const rowMeta = []; // { kind } per aoa row, for styling

  // Branded header block — mirrors the PDF / Dashboard print view: issuer
  // label, title, region-scoped subtitle + as-on date. Each spans all columns.
  const pushBanner = (text, kind) => {
    aoa.push([text, ...Array(colCount - 1).fill('')]);
    rowMeta.push({ kind });
    merges.push({ s: { r: aoa.length - 1, c: 0 }, e: { r: aoa.length - 1, c: colCount - 1 } });
  };
  pushBanner(issuerLabel.toUpperCase(), 'issuer');
  pushBanner('BESS Data — Battery Energy Storage Systems', 'title');
  pushBanner(`Inter-state & Intra-state — ${scopeLabel}    ·    As on: ${asOn}`, 'subtitle');

  // Header
  aoa.push(headers);
  rowMeta.push({ kind: 'header' });

  // Total rows merge their label across the first 7 columns (cols 0–6), the
  // same span the on-screen table uses, so the label isn't crushed into the
  // narrow Sr. No column.
  const pushTotal = (label, totals, kind) => {
    aoa.push(totalCells(label, totals));
    rowMeta.push({ kind });
    merges.push({ s: { r: aoa.length - 1, c: 0 }, e: { r: aoa.length - 1, c: 6 } });
  };

  interstate.forEach((row, i) => { aoa.push(rowCells(row, i + 1)); rowMeta.push({ kind: 'data' }); });
  pushTotal('Total — Inter-state BESS', interTotals, 'sub');

  intrastate.forEach((row, i) => { aoa.push(rowCells(row, i + 1)); rowMeta.push({ kind: 'data' }); });
  if (intrastate.length) pushTotal('Total — Intra-state BESS', intraTotals, 'sub');

  pushTotal('Total BESS', grandTotals, 'grand');

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges;
  ws['!cols'] = [6, 26, 22, 16, 8, 14, 16, 18, 18, 18, 26].map((wch) => ({ wch }));

  // Style cells.
  for (let r = 0; r < aoa.length; r++) {
    const kind = rowMeta[r].kind;
    for (let c = 0; c < colCount; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (!cell) continue;
      const base = { font: { name: 'Arial', sz: 10 }, border: X_BORDERS, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } };
      if (kind === 'issuer') {
        cell.s = { font: { name: 'Arial', sz: 9, bold: true, color: { rgb: NAVY } }, alignment: { horizontal: 'left', vertical: 'center' } };
      } else if (kind === 'subtitle') {
        cell.s = { font: { name: 'Arial', sz: 10, bold: true, color: { rgb: NAVY } }, alignment: { horizontal: 'left', vertical: 'center' } };
      } else if (kind === 'title') {
        cell.s = { font: { name: 'Arial', sz: 13, bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: NAVY } }, alignment: { horizontal: 'center', vertical: 'center' } };
      } else if (kind === 'header') {
        cell.s = { font: { name: 'Arial', sz: 10, bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: NAVY } }, border: X_BORDERS, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } };
      } else if (kind === 'sub') {
        cell.s = { ...base, font: { name: 'Arial', sz: 10, bold: true }, fill: { fgColor: { rgb: 'E2E8F0' } } };
      } else if (kind === 'grand') {
        cell.s = { ...base, font: { name: 'Arial', sz: 10, bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: NAVY } } };
      } else {
        cell.s = base;
      }
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'BESS Data');
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `bess-data_${stamp}.xlsx`);
}

export function BessDataPageClient({ bessProjects, regionLabel, scopeRegionCode = null, scopeRegionName = null, canEdit = false }) {
  const { settings } = useSettings();
  const [editRow, setEditRow] = useState(null);
  const refMonthLabel = fmtRefMonthShort(settings.referenceMonth);
  const refMonthName  = refMonthLabel.startsWith('Exp. ') ? refMonthLabel.slice(5) : 'reference month';

  // COD-declared date-range filter. When either bound is set, keep only
  // projects with at least one BESS COD declaration inside [from, to]. Both
  // bounds are inclusive; an open bound (blank) means "no limit on that side".
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate]     = useState('');
  const dateActive = !!(fromDate || toDate);
  const filteredProjects = useMemo(() => {
    if (!dateActive) return bessProjects ?? [];
    return (bessProjects ?? []).filter((p) =>
      projectCodDates(p).some((d) => (!fromDate || d >= fromDate) && (!toDate || d <= toDate)),
    );
  }, [bessProjects, fromDate, toDate, dateActive]);
  const clearDates = () => { setFromDate(''); setToDate(''); };

  const prepared = prepareBessData(filteredProjects, settings.referenceMonth);
  const hasRows = prepared.rows.length > 0;

  // Branded export header info — mirrors the Dashboard print view's scope
  // labelling (RLDC name for region users, All India / NLDC otherwise).
  const brandHeader = {
    scopeLabel:   scopeRegionName ?? 'All India',
    issuerLabel:  scopeRegionCode ? `${scopeRegionCode}LDC — Regional Load Despatch Centre` : 'National Load Despatch Centre',
    regionFooter: scopeRegionCode ? `${scopeRegionCode}LDC` : 'NLDC, New Delhi',
    dateLabel:    new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
  };

  return (
    <div className="px-6 pt-3 pb-3 space-y-2 flex flex-col h-[calc(100vh-110px)] min-h-0">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
            <BatteryCharging className="size-4 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">BESS Data</h1>
            <p className="text-[12px] text-muted-foreground leading-tight">{regionLabel}</p>
          </div>
        </div>

        {hasRows && (
          <div className="flex items-center gap-2">
            <a
              href={`/bess-data/print?${new URLSearchParams({
                ...(settings.referenceMonth ? { ref: settings.referenceMonth } : {}),
                ...(fromDate ? { codFrom: fromDate } : {}),
                ...(toDate ? { codTo: toDate } : {}),
              }).toString()}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded px-2 py-1.5 transition-colors"
              title="Open print / PDF view"
              aria-label="Open print / PDF view"
            >
              <Printer className="size-4" strokeWidth={2} />
              <span>Print</span>
            </a>
            <button
              type="button"
              onClick={() => downloadBessExcel(prepared, refMonthName, brandHeader)}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded px-2 py-1.5 transition-colors"
              title="Download BESS data as Excel"
              aria-label="Download BESS data as Excel"
            >
              <Sheet className="size-4" strokeWidth={2} />
              <span>XLSX</span>
            </button>
          </div>
        )}
      </div>

      {/* COD-declared date-range filter */}
      <div className="flex items-center flex-wrap gap-2 text-[12px]">
        <span className="inline-flex items-center gap-1.5 font-medium text-muted-foreground">
          <CalendarRange className="size-4" /> COD Declared
        </span>
        <label className="inline-flex items-center gap-1 text-muted-foreground">
          From
          <input
            type="date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-foreground"
          />
        </label>
        <label className="inline-flex items-center gap-1 text-muted-foreground">
          To
          <input
            type="date"
            value={toDate}
            min={fromDate || undefined}
            onChange={(e) => setToDate(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-foreground"
          />
        </label>
        {dateActive && (
          <>
            <button
              type="button"
              onClick={clearDates}
              className="inline-flex items-center gap-1 rounded-md border border-input px-2 h-8 text-muted-foreground hover:bg-muted transition-colors"
            >
              <X className="size-3.5" /> Clear
            </button>
            <span className="text-muted-foreground">
              {prepared.rows.length} project{prepared.rows.length === 1 ? '' : 's'} with COD in range
            </span>
          </>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {dateActive && !hasRows ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            No BESS projects have a COD declared in the selected date range.
          </div>
        ) : (
          <BessDataTab
            bessProjects={filteredProjects}
            referenceMonth={settings.referenceMonth}
            refMonthName={refMonthName}
            stickyTopClass="top-0"
            editable={canEdit}
            onEditRow={setEditRow}
          />
        )}
      </div>

      {canEdit && (
        <BessEditModal
          row={editRow}
          open={!!editRow}
          onOpenChange={(o) => { if (!o) setEditRow(null); }}
        />
      )}
    </div>
  );
}
