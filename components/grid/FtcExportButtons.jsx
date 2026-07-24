'use client';

import { FileSpreadsheet, Printer } from 'lucide-react';
import * as XLSX from 'xlsx-js-style';
import { contd4CapacityOf } from '@/lib/grid-computations';
import { ColumnCustomizer, useColumnVisibility } from '@/components/grid/ColumnCustomizer';

// FTC-tracker-specific export (Excel + Print/PDF) — exports the "Generation
// Capacity Under Process of FTC" table itself, NOT the dashboard summary. The
// per-project figures mirror FtcTable exactly (date-gated milestones + funnel-
// gap pending + total-capacity CONTD-4 fallback). `projects` is already the
// FILTERED set the user is looking at, so the export honours active filters.
const r3 = (x) => Math.round(x * 1000) / 1000;
const num = (v) => (v == null ? '' : Number(v));
const fmt1 = (v) => (v == null || v === '' ? '' : Number(v).toFixed(1));

// Short date for the milestone columns, e.g. "12 Jun 26".
function fmtDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

// Milestone date for ONE phase that has actually "arrived" (eventDate ≤ cutoff)
// — gated the same way the displayed MW is, so the date and the MW never
// disagree. Falls back to the phase's single completion-date field when there
// are no per-date events.
function phaseMilestoneDate(ph, eventsKey, fallbackKey, cutoff) {
  const events = (ph[eventsKey] ?? []).filter(
    (e) => e.eventDate && new Date(e.eventDate) <= cutoff,
  );
  if (events.length) {
    let best = null;
    for (const e of events) {
      const dt = new Date(e.eventDate);
      if (!best || dt > best) best = dt;
    }
    return best;
  }
  if (ph[fallbackKey]) {
    const dt = new Date(ph[fallbackKey]);
    if (dt <= cutoff) return dt;
  }
  return null;
}

// Phase-wise milestone dates for a project: one entry per phase (labelled by
// its source type) that has reached the milestone, so hybrids show each
// component's FTC / TOC / COD date separately instead of a single rolled-up date.
function phaseDateList(phases, eventsKey, fallbackKey, mwKey, cutoff) {
  const items = [];
  for (const ph of phases ?? []) {
    if (!(Number(ph[mwKey]) > 0)) continue;
    const dt = phaseMilestoneDate(ph, eventsKey, fallbackKey, cutoff);
    if (dt) items.push({ source: ph.sourceType, date: dt });
  }
  return items;
}

// Render a phase-date list: a bare date when there's a single phase, otherwise
// "SOURCE: date" per phase. `sep` joins them (" / " for Excel, newline-div for PDF).
function dateListText(list) {
  if (!list.length) return '';
  if (list.length === 1) return fmtDate(list[0].date);
  return list.map((x) => `${x.source}: ${fmtDate(x.date)}`).join(' / ');
}
function dateListHtml(list) {
  if (!list.length) return '—';
  if (list.length === 1) return esc(fmtDate(list[0].date));
  return list.map((x) => `<div><span class="src">${esc(x.source)}</span> ${esc(fmtDate(x.date))}</div>`).join('');
}

function buildRows(projects, cutoff) {
  return (projects ?? []).map((p) => {
    const sum = (f) => (p.phases ?? []).reduce((s, ph) => s + (ph[f] ?? 0), 0);
    const applied  = sum('capacityAppliedMw');
    const approved = sum('ftcCompletedMw');
    const toc      = sum('tocIssuedMw');
    const cod      = sum('codDeclaredMw');
    const expected = sum('expectedApr26Mw');
    const total    = Number(p.totalCapacityMw ?? 0);
    // Blank when no CONTD-4 record is linked (matches the tracker/modal/dashboard).
    const contd4   = contd4CapacityOf(p);
    const codComplete = total > 0 && cod >= total - 0.01;
    const status = (codComplete || p.manuallyCommissioned) ? 'Commissioned' : 'Under Process';
    const remarks = (p.phases ?? [])
      .flatMap((ph) => [ph.delayRemarks, ph.otherRemarks].filter((x) => x && x.trim()))
      .join(' | ');
    return {
      station: p.name,
      region: p.region?.code ?? '',
      pooling: p.poolingStation?.name ?? '',
      type: p.plantType?.label ?? '',
      total, contd4, applied, approved,
      ftcPending: Math.max(0, r3(applied - approved)),
      toc, tocPending: Math.max(0, r3(approved - toc)),
      cod, codPending: Math.max(0, r3(toc - cod)),
      expected, status, remarks,
      // Phase-wise, date-gated milestone dates (one entry per source/phase).
      ftcDates: approved > 0 ? phaseDateList(p.phases, 'ftcEvents', 'ftcCompletedDate', 'ftcCompletedMw', cutoff) : [],
      tocDates: toc > 0      ? phaseDateList(p.phases, 'tocEvents', 'tocIssuedDate',    'tocIssuedMw',    cutoff) : [],
      codDates: cod > 0      ? phaseDateList(p.phases, 'codEvents', 'codDeclaredDate',  'codDeclaredMw',  cutoff) : [],
    };
  });
}

// Column model. `locked` columns (# + Station identity) always export and don't
// appear in the picker. `excel` yields the Excel cell value; `html`/`cls` render
// the print cell; `w` is the Excel column width.
function reportColumns(expHeader) {
  return [
    { key: 'num',        label: '#',                 locked: true, excel: (r, i) => i + 1, html: (r, i) => i + 1, cls: 'c', w: 5 },
    { key: 'station',    label: 'Generating Station',locked: true, excel: (r) => r.station, html: (r) => esc(r.station), cls: '', w: 38 },
    { key: 'region',     label: 'Region',            excel: (r) => r.region, html: (r) => esc(r.region), cls: 'c', w: 9 },
    { key: 'pooling',    label: 'Pooling Station',   excel: (r) => r.pooling, html: (r) => esc(r.pooling), cls: '', w: 18 },
    { key: 'type',       label: 'Plant Type',        excel: (r) => r.type, html: (r) => esc(r.type), cls: '', w: 14 },
    { key: 'total',      label: 'Total (MW)',        excel: (r) => num(r.total), html: (r) => fmt1(r.total), cls: 'n', w: 11 },
    { key: 'contd4',     label: 'CONTD-4 (MW)',      excel: (r) => num(r.contd4), html: (r) => fmt1(r.contd4), cls: 'n', w: 13 },
    { key: 'applied',    label: 'Applied (MW)',      excel: (r) => num(r.applied), html: (r) => fmt1(r.applied), cls: 'n', w: 11 },
    { key: 'approvedMw', label: 'FTC Approved (MW)', excel: (r) => num(r.approved), html: (r) => fmt1(r.approved), cls: 'n', w: 13 },
    { key: 'approvedOn', label: 'FTC Approved On',   excel: (r) => dateListText(r.ftcDates), html: (r) => dateListHtml(r.ftcDates), cls: 'c d', w: 16 },
    { key: 'ftcPending', label: 'FTC Pending (MW)',  excel: (r) => num(r.ftcPending), html: (r) => (r.ftcPending ? fmt1(r.ftcPending) : '—'), cls: 'n o', w: 13 },
    { key: 'tocIssued',  label: 'TOC Issued (MW)',   excel: (r) => num(r.toc), html: (r) => fmt1(r.toc), cls: 'n', w: 12 },
    { key: 'tocOn',      label: 'TOC Issued On',     excel: (r) => dateListText(r.tocDates), html: (r) => dateListHtml(r.tocDates), cls: 'c d', w: 16 },
    { key: 'tocPending', label: 'TOC Pending (MW)',  excel: (r) => num(r.tocPending), html: (r) => (r.tocPending ? fmt1(r.tocPending) : '—'), cls: 'n o', w: 13 },
    { key: 'codDone',    label: 'COD Done (MW)',     excel: (r) => num(r.cod), html: (r) => fmt1(r.cod), cls: 'n', w: 12 },
    { key: 'codOn',      label: 'COD Completed On',  excel: (r) => dateListText(r.codDates), html: (r) => dateListHtml(r.codDates), cls: 'c d', w: 16 },
    { key: 'codPending', label: 'COD Pending (MW)',  excel: (r) => num(r.codPending), html: (r) => (r.codPending ? fmt1(r.codPending) : '—'), cls: 'n o', w: 13 },
    { key: 'expected',   label: expHeader,           excel: (r) => num(r.expected), html: (r) => (r.expected ? fmt1(r.expected) : '—'), cls: 'n', w: 14 },
    { key: 'status',     label: 'Status',            excel: (r) => r.status, html: (r) => `<span class="${r.status === 'Commissioned' ? 'ok' : 'wip'}">${esc(r.status)}</span>`, cls: 'c', w: 14 },
    { key: 'remarks',    label: 'Remarks',           excel: (r) => r.remarks, html: (r) => esc(r.remarks), cls: 'sm', w: 40 },
  ];
}

function exportExcel(rows, cols, regionLabel, asOnLabel) {
  const aoa = [
    ['Generation Capacity Under Process of FTC'],
    [`${regionLabel || 'All India'} · As on ${asOnLabel}`],
    [],
    cols.map((c) => c.label),
    ...rows.map((r, i) => cols.map((c) => c.excel(r, i))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = cols.map((c) => ({ wch: c.w }));
  for (let c = 0; c < cols.length; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 3, c })];
    if (cell) cell.s = { font: { bold: true }, fill: { fgColor: { rgb: 'E2E8F0' } } };
  }
  if (ws['A1']) ws['A1'].s = { font: { bold: true, sz: 14 } };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'FTC Tracker');
  XLSX.writeFile(wb, `FTC_Tracker_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function printPdf(rows, cols, regionLabel, asOnLabel) {
  const th = cols.map((c) => `<th>${esc(c.label)}</th>`).join('');
  const trs = rows.map((r, i) => `<tr>${cols.map((c) => {
    const cls = c.cls ? ` class="${c.cls}"` : '';
    return `<td${cls}>${c.html(r, i)}</td>`;
  }).join('')}</tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>FTC Tracker — ${asOnLabel}</title>
    <style>
      @page { size: A3 landscape; margin: 10mm; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 0; background: #f1f5f9; }
      .toolbar { position: fixed; top: 0; left: 0; right: 0; height: 46px; background: #1e293b; color: #fff;
        display: flex; align-items: center; gap: 12px; padding: 0 18px; z-index: 50; box-shadow: 0 2px 8px rgba(0,0,0,.25); }
      .toolbar .tt { font-weight: 600; font-size: 13px; margin-right: auto; }
      .toolbar button { border: 0; border-radius: 6px; padding: 7px 14px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
      .toolbar .print { background: #2563eb; color: #fff; }
      .toolbar .print:hover { background: #1d4ed8; }
      .toolbar .close { background: #475569; color: #fff; }
      .toolbar .close:hover { background: #334155; }
      .sheet { background: #fff; max-width: 1680px; margin: 16px auto; padding: 18px 22px; box-shadow: 0 1px 6px rgba(0,0,0,.12); }
      .head { border-bottom: 2px solid #1e293b; padding-bottom: 8px; margin-bottom: 12px; }
      .head .org { font-size: 10px; letter-spacing: 1px; color: #64748b; text-transform: uppercase; }
      .head h1 { font-size: 18px; margin: 2px 0; }
      .head .sub { font-size: 12px; color: #475569; }
      table { width: 100%; border-collapse: collapse; font-size: 8.5px; }
      th, td { border: 1px solid #cbd5e1; padding: 3px 4px; text-align: left; }
      th { background: #1e293b; color: #fff; font-size: 8px; }
      td.n, th { white-space: nowrap; } td.n { text-align: right; font-variant-numeric: tabular-nums; }
      td.c { text-align: center; } td.o { color: #c2410c; } td.d { color: #1d4ed8; white-space: nowrap; }
      td.d div { text-align: left; line-height: 1.35; }
      td.d .src { font-size: 7px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-right: 2px; }
      td.sm { font-size: 8px; color: #475569; }
      .ok { color: #047857; font-weight: 700; } .wip { color: #b45309; font-weight: 700; }
      tbody tr:nth-child(even) { background: #f8fafc; }
      @media screen { body { padding-top: 46px; } }
      @media print {
        body { background: #fff !important; padding-top: 0 !important; }
        .no-print { display: none !important; }
        .sheet { max-width: none; margin: 0; padding: 0; box-shadow: none; }
      }
    </style></head><body>
    <div class="toolbar no-print">
      <span class="tt">FTC Tracker — Print Preview</span>
      <button class="print" onclick="window.print()">Print / Save as PDF</button>
      <button class="close" onclick="window.close()">Close</button>
    </div>
    <div class="sheet">
      <div class="head"><div class="org">National / Regional Load Despatch Centre</div>
        <h1>Generation Capacity Under Process of FTC</h1>
        <div class="sub">${esc(regionLabel || 'All India')} · As on ${asOnLabel} · ${rows.length} project${rows.length === 1 ? '' : 's'}</div></div>
      <table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>
    </div>
    </body></html>`;
  const w = window.open('', '_blank');
  if (!w) { alert('Please allow pop-ups for this site to open the print preview.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

export function FtcExportButtons({ projects = [], regionLabel = '', refMonthLabel = 'Expected', asOf = null, size = 'sm' }) {
  const expHeader = refMonthLabel?.startsWith('Exp. ') ? `Expected ${refMonthLabel.slice(5)} (MW)` : 'Expected (MW)';
  // Cutoff that gates the milestone dates: the requested asOf, else "today".
  const cutoff = asOf ? new Date(`${asOf}T23:59:59.999Z`) : new Date();
  const asOnLabel = asOf
    ? new Date(`${asOf}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : cutoff.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const allCols = reportColumns(expHeader);
  const { hidden, isVisible, toggle, reset } = useColumnVisibility('ftc-report', allCols);
  const visibleCols = allCols.filter((c) => isVisible(c.key));

  const btnSize = size === 'sm' ? 'size-9' : 'size-11';
  const iconSize = size === 'sm' ? 'size-4' : 'size-5';

  const onExcel = () => exportExcel(buildRows(projects, cutoff), visibleCols, regionLabel, asOnLabel);
  const onPrint = () => printPdf(buildRows(projects, cutoff), visibleCols, regionLabel, asOnLabel);

  return (
    <div className="flex items-center gap-2">
      <ColumnCustomizer columns={allCols} hidden={hidden} onToggle={toggle} onReset={reset} size={size} />
      <button type="button" onClick={onExcel} title="Download FTC tracker as Excel" aria-label="Download as Excel"
        className={`inline-flex items-center justify-center ${btnSize} rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors`}>
        <FileSpreadsheet className={iconSize} />
      </button>
      <button type="button" onClick={onPrint} title="Print / Save FTC tracker as PDF" aria-label="Print / PDF"
        className={`inline-flex items-center justify-center ${btnSize} rounded-lg bg-slate-700 hover:bg-slate-800 text-white shadow-sm transition-colors`}>
        <Printer className={iconSize} />
      </button>
    </div>
  );
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
