'use client';

import * as XLSX from 'xlsx-js-style';
import { FileSpreadsheet, Printer } from 'lucide-react';
import { useSettings } from '@/providers/settings-provider';
import { contd4CapacityOf } from '@/lib/grid-computations';
import { ColumnCustomizer, useColumnVisibility } from '@/components/grid/ColumnCustomizer';
import { openPrintReport, esc } from '@/lib/print-report';

// ── report shaping ─────────────────────────────────────────────────────────────
// Builds the "Generation Capacity Under Process of CONTD-4" register exactly as
// the reference report: one row per project that has a CONTD-4 application. The
// column customizer (next to the buttons) selects which columns land in the
// Excel / print output — the report is customized at DOWNLOAD time.

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

const TITLE = 'Generation Capacity Under Process of CONTD-4';

// Column model. `locked` columns (Sr.No + Generating Station identity) always
// export and aren't listed in the picker. `header`/`headerHtml` are for the
// Excel/print header; `get` reads the shaped row; `w` is the Excel width.
function reportColumns(refLabel) {
  const rl = refLabel || '—';
  return [
    { key: 'srno',           label: 'Sr. No',             locked: true, header: 'Sr. No',
      get: (r, i) => i + 1, align: 'center', num: true, w: 6 },
    { key: 'developer',      label: 'Name of Developer',  header: 'Name of Developer',
      get: (r) => r.developer, align: 'left', w: 26 },
    { key: 'station',        label: 'Generating Station', locked: true, header: 'Generating Station',
      get: (r) => r.station, align: 'left', w: 18 },
    { key: 'poolingStation', label: 'Pooling Station',    header: 'Pooling Station',
      get: (r) => r.poolingStation, align: 'left', w: 16 },
    { key: 'region',         label: 'Region',             header: 'Region',
      get: (r) => r.region, align: 'center', w: 8 },
    { key: 'genType',        label: 'Generation Type',
      header: 'Generation Type\n(Wind/Solar/Hybrid/BESS/Coal/Hydro etc)',
      headerHtml: 'Generation Type<br><span class="hh">(Wind/Solar/Hybrid/BESS/Coal/Hydro etc)</span>',
      get: (r) => r.genType, align: 'left', w: 26 },
    { key: 'capacity',       label: 'Capacity (MW)',      header: 'Capacity (MW)',
      get: (r) => r.capacity, align: 'center', num: true, w: 12 },
    { key: 'applicationDate',label: 'Application Date',   header: 'Application Date',
      get: (r) => r.applicationDate, align: 'center', w: 14 },
    { key: 'proposedFtcDate',label: 'Proposed FTC date',  header: 'Proposed FTC date',
      get: (r) => r.proposedFtcDate, align: 'center', w: 15 },
    { key: 'refMonthCap',    label: `Capacity to complete in ${rl}`,
      header: `Capacity (MW) to be\ncompleted in ${rl}`,
      headerHtml: `Capacity (MW) to be<br>completed in ${esc(rl)}`,
      get: (r) => r.refMonthCap, align: 'center', num: true, w: 14 },
    { key: 'remarks',        label: 'Issues / Remark',    header: 'Issues if any causing delay/Remark',
      get: (r) => r.remarks, align: 'left', w: 48 },
  ];
}

// ── Excel ───────────────────────────────────────────────────────────────────────
function downloadExcel(rows, cols) {
  const border = { style: 'thin', color: { rgb: 'B0B7C3' } };
  const borders = { top: border, bottom: border, left: border, right: border };
  const titleStyle = { font: { bold: true, sz: 13, color: { rgb: '1F3864' } }, fill: { fgColor: { rgb: 'FFFF00' } },
    alignment: { horizontal: 'center', vertical: 'center' }, border: borders };
  const headStyle = { font: { bold: true, sz: 10, color: { rgb: '1F3864' } }, fill: { fgColor: { rgb: 'BDD7EE' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: borders };
  const cellBase = { alignment: { vertical: 'center', wrapText: true }, border: borders, font: { sz: 10 } };
  const cellFor = (align) => ({ ...cellBase, alignment: { ...cellBase.alignment, horizontal: align } });

  const NCOLS = cols.length;
  const aoa = [];
  // Title row: Sr.No corner (yellow) + merged report title across the rest.
  aoa.push([{ v: 'Sr. No', t: 's', s: { ...titleStyle } },
    ...Array.from({ length: NCOLS - 1 }, (_, i) => ({ v: i === 0 ? TITLE : '', t: 's', s: titleStyle }))]);
  // Header row (Sr.No cell blank — labelled by the corner above).
  aoa.push(cols.map((c, i) => ({ v: i === 0 ? '' : c.header, t: 's', s: headStyle })));
  // Data rows.
  rows.forEach((r, i) => {
    aoa.push(cols.map((c) => ({
      v: c.get(r, i), t: c.num ? 'n' : 's', s: cellFor(c.align),
    })));
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = NCOLS > 1 ? [{ s: { r: 0, c: 1 }, e: { r: 0, c: NCOLS - 1 } }] : [];
  ws['!cols'] = cols.map((c) => ({ wch: c.w }));
  ws['!rows'] = [{ hpt: 22 }, { hpt: 34 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'CONTD-4 Under Process');
  XLSX.writeFile(wb, `CONTD-4_Under_Process_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ── Print preview (HTML → browser Print / Save as PDF) ──────────────────────────
// Renders ALL columns tagged with data-col; `hiddenKeys` start hidden and the
// preview's Customize panel toggles them live. Uses the shared dashboard-style
// print shell (navy DocHeader + navy table headers).
const CONTD4_TABLE_CSS = `
  thead th .hh { font-weight: 400; font-size: 7px; opacity: .9; }
  td.rmk { font-size: 8px; color: #334155; max-width: 340px; }
`;

function openPrintView(rows, allCols, hiddenKeys, regionLabel) {
  const headerCells = allCols.map((c) => `<th data-col="${c.key}">${c.headerHtml || esc(c.header)}</th>`).join('');
  const body = rows.map((r, i) => `<tr>${allCols.map((c) => {
    const v = c.get(r, i);
    const cls = `${c.align === 'center' ? 'c ' : ''}${c.num ? 'n ' : ''}${c.key === 'remarks' ? 'rmk' : ''}`.trim();
    const val = c.key === 'remarks' ? esc(v).replace(/\n/g, '<br>') : esc(v);
    return `<td${cls ? ` class="${cls}"` : ''} data-col="${c.key}">${val}</td>`;
  }).join('')}</tr>`).join('');
  const tableHtml = `<table><thead><tr>${headerCells}</tr></thead><tbody>${body}</tbody></table>`;

  const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const subtitle = `${regionLabel ? `${regionLabel} · ` : ''}${rows.length} project${rows.length === 1 ? '' : 's'}`;

  openPrintReport({
    documentTitle: TITLE,
    toolbarTitle: 'CONTD-4 Report',
    dateLabel: dateStr,
    header: { title: TITLE, subtitle },
    page: { size: 'A4', orientation: 'landscape' },
    columns: allCols,
    initiallyHidden: hiddenKeys,
    tableMinWidth: 1150,
    tableHtml,
    tableCss: CONTD4_TABLE_CSS,
  });
}

/**
 * CONTD-4-specific Excel + PDF export controls with a column picker. Generates
 * the per-project "Generation Capacity Under Process of CONTD-4" register from
 * the projects already loaded on the page (region-scoped server-side). The
 * "Columns" picker chooses which columns land in the downloaded report.
 */
export function Contd4ExportButtons({ projects, size = 'sm' }) {
  const { settings } = useSettings();
  const refMonth = settings?.referenceMonth;
  const refLabel = refMonthLabel(refMonth);
  const allCols = reportColumns(refLabel);
  const { hidden, isVisible, toggle, reset } = useColumnVisibility('contd4-report', allCols);
  const visibleCols = allCols.filter((c) => isVisible(c.key));

  const btnSize = size === 'sm' ? 'size-9' : 'size-11';
  const iconSize = size === 'sm' ? 'size-4' : 'size-5';

  const onExcel = () => downloadExcel(buildRows(projects, refMonth), visibleCols);
  // Print renders all columns; those hidden in the page picker start hidden but
  // can be re-enabled live via the preview's own Customize panel.
  const onPrint = () => openPrintView(buildRows(projects, refMonth), allCols, [...hidden], null);

  return (
    <div className="flex items-center gap-2">
      <ColumnCustomizer columns={allCols} hidden={hidden} onToggle={toggle} onReset={reset} size={size} />
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
        onClick={onPrint}
        title="Print / Save CONTD-4 report as PDF"
        aria-label="Print CONTD-4 report"
        className={`inline-flex items-center justify-center ${btnSize} rounded-lg bg-slate-700 hover:bg-slate-800 text-white shadow-sm transition-colors`}
      >
        <Printer className={iconSize} />
      </button>
    </div>
  );
}
