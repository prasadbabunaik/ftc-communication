'use client';

import { FileSpreadsheet, Printer } from 'lucide-react';
import * as XLSX from 'xlsx-js-style';

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
    const contd4   = p.contd4?.capacityApr26Mw != null ? Number(p.contd4.capacityApr26Mw) : total;
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

export function FtcExportButtons({ projects = [], regionLabel = '', refMonthLabel = 'Expected', asOf = null, size = 'sm' }) {
  const expHeader = refMonthLabel?.startsWith('Exp. ') ? `Expected ${refMonthLabel.slice(5)} (MW)` : 'Expected (MW)';
  // Cutoff that gates the milestone dates: the requested asOf, else "today".
  const cutoff = asOf ? new Date(`${asOf}T23:59:59.999Z`) : new Date();
  const asOnLabel = asOf
    ? new Date(`${asOf}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : cutoff.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  // Column layout — milestone date sits right after its MW figure.
  const HEADERS = [
    '#', 'Generating Station', 'Region', 'Pooling Station', 'Plant Type',
    'Total (MW)', 'CONTD-4 (MW)', 'Applied (MW)',
    'FTC Approved (MW)', 'FTC Approved On', 'FTC Pending (MW)',
    'TOC Issued (MW)', 'TOC Issued On', 'TOC Pending (MW)',
    'COD Done (MW)', 'COD Completed On', 'COD Pending (MW)',
    expHeader, 'Status', 'Remarks',
  ];

  function exportExcel() {
    const rows = buildRows(projects, cutoff);
    const aoa = [
      ['Generation Capacity Under Process of FTC'],
      [`${regionLabel || 'All India'} · As on ${asOnLabel}`],
      [],
      HEADERS,
      ...rows.map((r, i) => [
        i + 1, r.station, r.region, r.pooling, r.type,
        num(r.total), num(r.contd4), num(r.applied),
        num(r.approved), dateListText(r.ftcDates), num(r.ftcPending),
        num(r.toc), dateListText(r.tocDates), num(r.tocPending),
        num(r.cod), dateListText(r.codDates), num(r.codPending),
        num(r.expected), r.status, r.remarks,
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = HEADERS.map((h, i) => ({
      wch: i === 1 ? 38 : i === 3 ? 18 : i === 19 ? 40 : Math.max(11, h.length + 1),
    }));
    for (let c = 0; c < HEADERS.length; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 3, c })];
      if (cell) cell.s = { font: { bold: true }, fill: { fgColor: { rgb: 'E2E8F0' } } };
    }
    ws['A1'].s = { font: { bold: true, sz: 14 } };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'FTC Tracker');
    XLSX.writeFile(wb, `FTC_Tracker_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function printPdf() {
    const rows = buildRows(projects, cutoff);
    const th = HEADERS.map((h) => `<th>${esc(h)}</th>`).join('');
    const trs = rows.map((r, i) => `<tr>
      <td class="c">${i + 1}</td><td>${esc(r.station)}</td><td class="c">${esc(r.region)}</td>
      <td>${esc(r.pooling)}</td><td>${esc(r.type)}</td>
      <td class="n">${fmt1(r.total)}</td><td class="n">${fmt1(r.contd4)}</td><td class="n">${fmt1(r.applied)}</td>
      <td class="n">${fmt1(r.approved)}</td><td class="c d">${dateListHtml(r.ftcDates)}</td><td class="n o">${r.ftcPending ? fmt1(r.ftcPending) : '—'}</td>
      <td class="n">${fmt1(r.toc)}</td><td class="c d">${dateListHtml(r.tocDates)}</td><td class="n o">${r.tocPending ? fmt1(r.tocPending) : '—'}</td>
      <td class="n">${fmt1(r.cod)}</td><td class="c d">${dateListHtml(r.codDates)}</td><td class="n o">${r.codPending ? fmt1(r.codPending) : '—'}</td>
      <td class="n">${r.expected ? fmt1(r.expected) : '—'}</td>
      <td class="c"><span class="${r.status === 'Commissioned' ? 'ok' : 'wip'}">${r.status}</span></td>
      <td class="sm">${esc(r.remarks)}</td></tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>FTC Tracker — ${asOnLabel}</title>
      <style>
        @page { size: A3 landscape; margin: 10mm; }
        * { box-sizing: border-box; }
        body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 0; }
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
      </style></head><body>
      <div class="head"><div class="org">National / Regional Load Despatch Centre</div>
        <h1>Generation Capacity Under Process of FTC</h1>
        <div class="sub">${esc(regionLabel || 'All India')} · As on ${asOnLabel} · ${rows.length} project${rows.length === 1 ? '' : 's'}</div></div>
      <table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>
      <script>window.onload=function(){setTimeout(function(){window.print();},250);};</script>
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.open(); w.document.write(html); w.document.close();
  }

  const btnSize = size === 'sm' ? 'size-9' : 'size-11';
  const iconSize = size === 'sm' ? 'size-4' : 'size-5';
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={exportExcel} title="Download FTC tracker as Excel" aria-label="Download as Excel"
        className={`inline-flex items-center justify-center ${btnSize} rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors`}>
        <FileSpreadsheet className={iconSize} />
      </button>
      <button type="button" onClick={printPdf} title="Print / Save FTC tracker as PDF" aria-label="Print / PDF"
        className={`inline-flex items-center justify-center ${btnSize} rounded-lg bg-slate-700 hover:bg-slate-800 text-white shadow-sm transition-colors`}>
        <Printer className={iconSize} />
      </button>
    </div>
  );
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
