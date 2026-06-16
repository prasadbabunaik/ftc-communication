'use client';

// Standalone BESS Data page — the same table the dashboard surfaces in a tab,
// here as a full sidebar page with dedicated Excel + PDF downloads. Reuses the
// row-shaping helpers from BessDataTab so the export matches the on-screen view.

import { BatteryCharging, Sheet, FileText } from 'lucide-react';
import * as XLSX from 'xlsx-js-style';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useRouter } from 'next/navigation';
import { useSettings } from '@/providers/settings-provider';
import { BessDataTab, prepareBessData, fmt, fmtDate } from '@/components/grid/BessDataTab';
import { updateBessRowFields } from '@/app/actions/grid';

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

function downloadBessExcel(prepared, refMonthName) {
  const { interstate, intrastate, interTotals, intraTotals, grandTotals } = prepared;
  const headers = headerLabels(refMonthName);
  const colCount = headers.length;

  const aoa = [];
  const merges = [];
  const rowMeta = []; // { kind } per aoa row, for styling

  // Title bar
  aoa.push(['BESS Data — Inter-state & Intra-state', ...Array(colCount - 1).fill('')]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } });
  rowMeta.push({ kind: 'title' });

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
      if (kind === 'title') {
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

// ── PDF ───────────────────────────────────────────────────────────────────
function downloadBessPdf(prepared, refMonthName) {
  const { interstate, intrastate, interTotals, intraTotals, grandTotals } = prepared;
  const headers = headerLabels(refMonthName);

  // Total rows: the label spans the first 7 columns (cols 0–6) via colSpan so
  // it gets a full-width bar instead of wrapping inside the Sr. No column.
  const totalRow = (label, totals) => [
    { content: label, colSpan: 7, styles: { halign: 'center', fontStyle: 'bold' } },
    String(totals.codDeclared || ''),
    String(totals.energyMwh > 0 ? totals.energyMwh : ''),
    String(totals.codInRefMonth > 0 ? totals.codInRefMonth : 0),
    '',
  ];

  const body = [];
  const totalRowIdxs = [];
  const grandRowIdxs = [];

  interstate.forEach((row, i) => body.push(rowCells(row, i + 1).map(String)));
  body.push(totalRow('Total — Inter-state BESS', interTotals)); totalRowIdxs.push(body.length - 1);
  intrastate.forEach((row, i) => body.push(rowCells(row, i + 1).map(String)));
  if (intrastate.length) { body.push(totalRow('Total — Intra-state BESS', intraTotals)); totalRowIdxs.push(body.length - 1); }
  body.push(totalRow('Total BESS', grandTotals)); grandRowIdxs.push(body.length - 1);

  // Explicit per-column widths sized to fill the full A3-landscape page width
  // (≈1140pt usable with 25pt side margins). The right-most COD-Date column is
  // wide enough for "33.33 MW on 03-06-2026" without a mid-string wrap.
  const columnStyles = {
    0:  { cellWidth: 40,  halign: 'center' },            // Sr. No
    1:  { cellWidth: 205, halign: 'left' },              // Generating Station
    2:  { cellWidth: 100 },                              // Pooling Station
    3:  { cellWidth: 115 },                              // Plant Type
    4:  { cellWidth: 52 },                               // Region
    5:  { cellWidth: 82 },                               // Total Capacity
    6:  { cellWidth: 92 },                               // State
    7:  { cellWidth: 98 },                               // COD declared Capacity
    8:  { cellWidth: 98 },                               // Energy Commissioned
    9:  { cellWidth: 98 },                               // COD Declared in ref month
    10: { cellWidth: 160, halign: 'left' },              // COD Date Declared
  };

  const SIDE = 25, TOP = 44, BOTTOM = 25;

  // Render the title + table into a fresh doc at the given font scale. Returns
  // the doc and the table's final Y so we can measure whether it fit one page.
  const render = (fontSize, cellPadding) => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a3' });
    doc.setFontSize(16);
    doc.setTextColor(30, 58, 95);
    doc.text('BESS Data — Inter-state & Intra-state', SIDE, 32);
    autoTable(doc, {
      head: [headers],
      body,
      startY: TOP,
      margin: { left: SIDE, right: SIDE, top: TOP, bottom: BOTTOM },
      tableWidth: 'auto',
      styles: { fontSize, cellPadding, halign: 'center', valign: 'middle', overflow: 'linebreak', lineColor: [203, 213, 225], lineWidth: 0.5 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: 'bold', halign: 'center', valign: 'middle', fontSize },
      columnStyles,
      didParseCell: (data) => {
        if (data.section !== 'body') return;
        if (grandRowIdxs.includes(data.row.index)) {
          data.cell.styles.fillColor = [30, 58, 95];
          data.cell.styles.textColor = 255;
          data.cell.styles.fontStyle = 'bold';
        } else if (totalRowIdxs.includes(data.row.index)) {
          data.cell.styles.fillColor = [226, 232, 240];
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });
    return { doc, pages: doc.getNumberOfPages() };
  };

  // Auto-fit to a single page: start large and shrink font + padding until the
  // table fits on one page, so it occupies the page without spilling onto a
  // second one. (Page count is the reliable signal — finalY resets per page.)
  let fontSize = 9, cellPadding = 4;
  let out = render(fontSize, cellPadding);
  while (out.pages > 1 && fontSize > 4) {
    fontSize = Math.round((fontSize - 0.5) * 10) / 10;
    cellPadding = Math.max(1.5, cellPadding - 0.25);
    out = render(fontSize, cellPadding);
  }
  const doc = out.doc;

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`bess-data_${stamp}.pdf`);
}

export function BessDataPageClient({ bessProjects, regionLabel, canEdit = false }) {
  const { settings } = useSettings();
  const router = useRouter();
  const refMonthLabel = fmtRefMonthShort(settings.referenceMonth);
  const refMonthName  = refMonthLabel.startsWith('Exp. ') ? refMonthLabel.slice(5) : 'reference month';
  const prepared = prepareBessData(bessProjects, settings.referenceMonth);
  const hasRows = prepared.rows.length > 0;

  // Persist one inline-edited cell, then refresh the server component so the
  // table (and the totals / exports derived from it) reflect the saved value.
  async function handleSaveField(projectId, field, value) {
    const res = await updateBessRowFields(projectId, { [field]: value });
    if (res?.success) router.refresh();
    return res;
  }

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
            <button
              type="button"
              onClick={() => downloadBessExcel(prepared, refMonthName)}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded px-2 py-1.5 transition-colors"
              title="Download BESS data as Excel"
              aria-label="Download BESS data as Excel"
            >
              <Sheet className="size-4" strokeWidth={2} />
              <span>XLSX</span>
            </button>
            <button
              type="button"
              onClick={() => downloadBessPdf(prepared, refMonthName)}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded px-2 py-1.5 transition-colors"
              title="Download BESS data as PDF"
              aria-label="Download BESS data as PDF"
            >
              <FileText className="size-4" strokeWidth={2} />
              <span>PDF</span>
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        <BessDataTab
          bessProjects={bessProjects}
          referenceMonth={settings.referenceMonth}
          refMonthName={refMonthName}
          stickyTopClass="top-0"
          editable={canEdit}
          onSaveField={handleSaveField}
        />
      </div>
    </div>
  );
}
