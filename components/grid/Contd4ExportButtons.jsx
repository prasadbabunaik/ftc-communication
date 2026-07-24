'use client';

import * as XLSX from 'xlsx-js-style';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { FileSpreadsheet, Printer } from 'lucide-react';
import { useSettings } from '@/providers/settings-provider';
import { contd4CapacityOf } from '@/lib/grid-computations';

// ── report shaping ─────────────────────────────────────────────────────────────
// Builds the "Generation Capacity Under Process of CONTD-4" register exactly as
// the reference report: one row per project that has a CONTD-4 application, with
// the developer, station, pooling station, region, generation type (hybrids
// broken down by component), capacity, application / proposed-FTC dates, the
// capacity due in the reference month, and the consolidated remarks.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function refMonthLabel(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return `${MONTHS[parseInt(m, 10) - 1]}'${String(y).slice(2)}`;
}

// DD.MM.YYYY, matching the reference report; a lone "." for missing dates.
function fmtDate(v) {
  if (!v) return '.';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '.';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

function num(v) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

// "Wind" / "Solar" … or "Hybrid (Wind - 291 MW + Solar - 50 MW)" for hybrids.
function generationType(p) {
  if (!p.plantType?.isHybrid) return p.plantType?.label ?? '—';
  const parts = [];
  if (p.windCapacityMw  != null) parts.push(`Wind - ${num(p.windCapacityMw)} MW`);
  if (p.solarCapacityMw != null) parts.push(`Solar - ${num(p.solarCapacityMw)} MW`);
  if (p.bessCapacityMw  != null) parts.push(`BESS - ${num(p.bessCapacityMw)} MW`);
  return parts.length ? `Hybrid (${parts.join(' + ')})` : (p.plantType?.label ?? 'Hybrid');
}

// Capacity under CONTD-4: the issued/declared figure when set, else plant total.
function capacityMw(p) {
  const c = contd4CapacityOf(p);
  return c != null && c > 0 ? num(c) : num(p.totalCapacityMw);
}

// Capacity whose target month is the reference month (sum of dated declarations,
// or the single application-level capacity when no dated phases exist).
function capacityInRefMonth(p, refMonth) {
  const phases = p.contd4?.phases ?? [];
  if (phases.length) {
    return num(phases.filter((ph) => ph.capacityMonth === refMonth)
      .reduce((s, ph) => s + Number(ph.capacityMw || 0), 0));
  }
  if (p.contd4?.capacityMonth === refMonth) return num(p.contd4.capacityApr26Mw ?? 0);
  return 0;
}

// Consolidated remarks: every dated phase remark plus the application-level
// remark, newest first, one per line (matches the on-screen Remarks column).
function remarksText(p) {
  const items = (p.contd4?.phases ?? [])
    .filter((ph) => (ph.remarks ?? '').trim())
    .map((ph) => ({ date: ph.declaredDate ? new Date(ph.declaredDate) : null, text: ph.remarks.trim() }));
  if (p.contd4?.remarks?.trim()) {
    const d = p.contd4.remarksUpdatedAt || p.contd4.applicationDate || p.contd4.createdAt;
    items.push({ date: d ? new Date(d) : null, text: p.contd4.remarks.trim() });
  }
  items.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  return items.map((r) => r.text).join('\n');
}

function buildRows(projects, refMonth) {
  return (projects ?? [])
    .filter((p) => p.contd4) // only projects with a CONTD-4 application
    .map((p) => ({
      developer:      p.developerName?.trim() || '—',
      station:        p.name ?? '—',
      poolingStation: p.poolingStation?.name?.trim() || '—',
      region:         p.region?.code ?? '—',
      genType:        generationType(p),
      capacity:       capacityMw(p),
      applicationDate: fmtDate(p.contd4?.applicationDate),
      proposedFtcDate: fmtDate(p.contd4?.proposedFtcDate),
      refMonthCap:    capacityInRefMonth(p, refMonth),
      remarks:        remarksText(p),
    }));
}

const HEADERS = (refLabel) => ([
  'Sr. No',
  'Name of Developer',
  'Generating Station',
  'Pooling Station',
  'Region',
  'Generation Type\n(Wind/Solar/Hybrid/BESS/Coal/Hydro etc)',
  'Capacity(MW)',
  'Application Date',
  'Proposed FTC date',
  `Capacity(MW) to be\ncompleted in ${refLabel}`,
  'Issues if any causing delay/Remark',
]);

const TITLE = 'Generation Capacity Under Process of CONTD-4';

// ── Excel ───────────────────────────────────────────────────────────────────────
function downloadExcel(rows, refLabel) {
  const headers = HEADERS(refLabel);
  const NCOLS = headers.length;

  const border = { style: 'thin', color: { rgb: 'B0B7C3' } };
  const borders = { top: border, bottom: border, left: border, right: border };

  const titleStyle = {
    font: { bold: true, sz: 13, color: { rgb: '1F3864' } },
    fill: { fgColor: { rgb: 'FFFF00' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: borders,
  };
  const headStyle = {
    font: { bold: true, sz: 10, color: { rgb: '1F3864' } },
    fill: { fgColor: { rgb: 'BDD7EE' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: borders,
  };
  const cellBase = { alignment: { vertical: 'center', wrapText: true }, border: borders, font: { sz: 10 } };
  const cellCenter = { ...cellBase, alignment: { ...cellBase.alignment, horizontal: 'center' } };
  const cellLeft   = { ...cellBase, alignment: { ...cellBase.alignment, horizontal: 'left' } };

  const aoa = [];
  // Row 0: Sr.No corner + merged title across the rest
  aoa.push([{ v: 'Sr. No', t: 's', s: { ...headStyle, fill: { fgColor: { rgb: 'FFFF00' } } } },
    ...Array.from({ length: NCOLS - 1 }, (_, i) => ({ v: i === 0 ? TITLE : '', t: 's', s: titleStyle }))]);
  // Row 1: column headers (Sr.No cell blank — the corner above already labels it)
  aoa.push(headers.map((h, i) => ({ v: i === 0 ? '' : h, t: 's', s: headStyle })));
  // Data rows
  rows.forEach((r, i) => {
    aoa.push([
      { v: i + 1, t: 'n', s: cellCenter },
      { v: r.developer, t: 's', s: cellLeft },
      { v: r.station, t: 's', s: cellLeft },
      { v: r.poolingStation, t: 's', s: cellLeft },
      { v: r.region, t: 's', s: cellCenter },
      { v: r.genType, t: 's', s: cellLeft },
      { v: r.capacity, t: 'n', s: cellCenter },
      { v: r.applicationDate, t: 's', s: cellCenter },
      { v: r.proposedFtcDate, t: 's', s: cellCenter },
      { v: r.refMonthCap, t: 'n', s: cellCenter },
      { v: r.remarks, t: 's', s: cellLeft },
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = [{ s: { r: 0, c: 1 }, e: { r: 0, c: NCOLS - 1 } }];
  ws['!cols'] = [
    { wch: 6 },   // Sr.No
    { wch: 26 },  // Developer
    { wch: 18 },  // Station
    { wch: 16 },  // Pooling Station
    { wch: 8 },   // Region
    { wch: 26 },  // Generation Type
    { wch: 12 },  // Capacity
    { wch: 14 },  // Application Date
    { wch: 15 },  // Proposed FTC
    { wch: 14 },  // Ref-month capacity
    { wch: 48 },  // Remarks
  ];
  ws['!rows'] = [{ hpt: 22 }, { hpt: 34 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'CONTD-4 Under Process');
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `CONTD-4_Under_Process_${stamp}.xlsx`);
}

// ── PDF ─────────────────────────────────────────────────────────────────────────
function downloadPdf(rows, refLabel) {
  const headers = HEADERS(refLabel).map((h) => h.replace(/\n/g, ' '));
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFontSize(13);
  doc.setTextColor(31, 56, 100);
  doc.setFont('helvetica', 'bold');
  doc.text(TITLE, pageWidth / 2, 30, { align: 'center' });

  autoTable(doc, {
    startY: 44,
    head: [headers],
    body: rows.map((r, i) => [
      i + 1, r.developer, r.station, r.poolingStation, r.region, r.genType,
      r.capacity, r.applicationDate, r.proposedFtcDate, r.refMonthCap, r.remarks,
    ]),
    styles: { fontSize: 7, cellPadding: 3, valign: 'middle', overflow: 'linebreak', lineColor: [176, 183, 195], lineWidth: 0.5 },
    headStyles: { fillColor: [189, 215, 238], textColor: [31, 56, 100], fontStyle: 'bold', halign: 'center' },
    columnStyles: {
      0: { halign: 'center', cellWidth: 26 },
      1: { cellWidth: 90 },
      2: { cellWidth: 70 },
      3: { cellWidth: 66 },
      4: { halign: 'center', cellWidth: 34 },
      5: { cellWidth: 92 },
      6: { halign: 'center', cellWidth: 44 },
      7: { halign: 'center', cellWidth: 52 },
      8: { halign: 'center', cellWidth: 56 },
      9: { halign: 'center', cellWidth: 52 },
      10: { cellWidth: 'auto' },
    },
    margin: { left: 20, right: 20 },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`CONTD-4_Under_Process_${stamp}.pdf`);
}

/**
 * CONTD-4-specific Excel + PDF export controls. Generates the per-project
 * "Generation Capacity Under Process of CONTD-4" register from the projects
 * already loaded on the page (region-scoped server-side), so the download
 * always matches what the CONTD-4 tab shows.
 */
export function Contd4ExportButtons({ projects, size = 'sm' }) {
  const { settings } = useSettings();
  const refMonth = settings?.referenceMonth;
  const refLabel = refMonthLabel(refMonth);

  const btnSize = size === 'sm' ? 'size-9' : 'size-11';
  const iconSize = size === 'sm' ? 'size-4' : 'size-5';

  const onExcel = () => downloadExcel(buildRows(projects, refMonth), refLabel);
  const onPdf   = () => downloadPdf(buildRows(projects, refMonth), refLabel);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onExcel}
        title="Download CONTD-4 report as Excel"
        aria-label="Download CONTD-4 report as Excel"
        className={`inline-flex items-center justify-center ${btnSize} rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors`}
      >
        <FileSpreadsheet className={iconSize} />
      </button>
      <button
        type="button"
        onClick={onPdf}
        title="Download CONTD-4 report as PDF"
        aria-label="Download CONTD-4 report as PDF"
        className={`inline-flex items-center justify-center ${btnSize} rounded-lg bg-slate-700 hover:bg-slate-800 text-white shadow-sm transition-colors`}
      >
        <Printer className={iconSize} />
      </button>
    </div>
  );
}
