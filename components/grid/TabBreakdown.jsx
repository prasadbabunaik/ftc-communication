'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { ListTree, Search, X, ChevronRight, Rows3, Columns3, LayoutGrid, Sheet, FileText } from 'lucide-react';
// xlsx-js-style is a drop-in replacement for SheetJS that supports cell
// styling (fills, fonts, borders) — used to give the Excel download the same
// clean navy-header look as the print / PDF summary view.
import * as XLSX from 'xlsx-js-style';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  Dialog, DialogContent, DialogTitle,
} from '@/components/ui/dialog';
import { CONTD4_SOURCE_LABEL, isInFtcPipeline, milestoneAsOf } from '@/lib/grid-computations';

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(v) {
  if (v == null) return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  if (n === 0) return '0';
  const p = n.toFixed(2).split('.');
  p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const d = p[1]?.replace(/0+$/, '');
  return d ? `${p[0]}.${d}` : p[0];
}

// Short "13 Mar 26" date for table cells; "—" when empty.
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

// Flatten contributor.ftcEvents into a string like "13.03.2026 / 18.03.2026"
// (mirrors the Excel "FTC date if completed" cell format). For COD where
// the partial MW matters, includes the MW: "150MW (30.03.2026) / 50MW (01.04.2026)".
function flattenEventDates(events, showMw) {
  if (!events?.length) return '';
  return events.map((e) => {
    const d = e.date ? new Date(e.date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
    return showMw && e.mw > 0 ? `${e.mw}MW (${d})` : d;
  }).join(' / ');
}

// Excel headers in the same order as the original "X Generation Capacity
// Details Under FTC/TOC/COD" tables. Each row becomes one project line.
const SOURCEWISE_HEADERS = [
  'Generating Station', 'Pooling Station', 'Region',
  'Total Plant Capacity (MW)',
  'Total Capacity (MW) (For which CONTD4 issued)',
  'Total Capacity (MW) applied for FTC',
  'FTC Completed Capacity (MW)', 'FTC date if completed',
  'TOC Issued Capacity (MW)',    'TOC issuance date if Completed',
  'COD declared Capacity (MW)',  'COD Date if Declared',
  'Proposed FTC date if Under process',
  'Capacity Under Process for FTC',
  'Capacity Under Process for TOC',
  'Capacity Pending for COD',
  'Capacity (MW) commissioning expected in Apr\'26',
  'Issues if any causing delay in FTC/TOC/COD',
  'Any Other remark',
];

// Convert a contributor row (already built by buildPipelineGroups) into the
// 19-column array-of-cells matching SOURCEWISE_HEADERS. Used by both the
// Excel and PDF exporters.
function contributorToRow(c, region) {
  return [
    c.name ?? '',
    c.poolingStation ?? '',
    region,
    c.total || 0,
    c.contd4 || 0,
    c.applied || 0,
    c.ftc || 0,
    flattenEventDates(c.ftcEvents, true),
    c.toc || 0,
    flattenEventDates(c.tocEvents, true),
    c.cod || 0,
    flattenEventDates(c.codEvents, true),
    c.proposedFtcDate ? new Date(c.proposedFtcDate).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '',
    c.uftc || 0,
    c.utoc || 0,
    c.pendcod || 0,
    c.exp || 0,
    c.delayRemarks ?? '',
    c.otherRemarks ?? '',
  ];
}

// Sum helper used by every exporter — keeps the long subtotal rows readable.
function sumField(rows, k) { return rows.reduce((s, c) => s + (Number(c[k]) || 0), 0); }

// Build the totals row in the SOURCEWISE_HEADERS column order. `label` goes
// in column 1 ("Generating Station"); everything else is positional.
function makeTotalRow(label, rows) {
  return [
    label, '', '',
    sumField(rows, 'total'), sumField(rows, 'contd4'), sumField(rows, 'applied'),
    sumField(rows, 'ftc'), '', sumField(rows, 'toc'), '', sumField(rows, 'cod'), '',
    '', sumField(rows, 'uftc'), sumField(rows, 'utoc'), sumField(rows, 'pendcod'), sumField(rows, 'exp'), '', '',
  ];
}

// Normalise the visible `filtered` array (which has different shapes per
// layout) into a uniform { outerLabel, sectionTitle, clusters: [{ key, label,
// rows }] } structure that both exporters can iterate over identically.
function normaliseSections(filteredGroups, layout) {
  if (layout === 'split') {
    // Split: each `g` is one cluster on its own; group sections by the outer
    // axis (source) to preserve the existing "one sheet per source" output.
    const bySource = {};
    for (const g of filteredGroups) {
      if (!bySource[g.source]) bySource[g.source] = [];
      bySource[g.source].push(g);
    }
    return Object.entries(bySource).map(([source, regionGroups]) => ({
      outerLabel: source,
      sectionTitle: `${source} Generation Capacity Details Under FTC/TOC/COD`,
      clusters: regionGroups.map((g) => ({
        key: g.region,
        label: `Total ${g.region} ${source}`,
        rows: g.contributors,
      })),
    }));
  }
  if (layout === 'region') {
    // Region-wise: one section per region, clusters per source inside.
    return filteredGroups.map((g) => {
      const clusters = clusterContributors(g.contributors, 'source', []);
      return {
        outerLabel: g.region,
        sectionTitle: `${g.region} Generation Capacity Under Process of FTC`,
        clusters: clusters.map((cl) => ({
          key: cl.key,
          label: `Total ${g.region} ${CONTD4_SOURCE_LABEL[cl.key] ?? cl.key}`,
          rows: cl.rows,
        })),
      };
    });
  }
  // Source-wise: one section per source, clusters per region inside.
  return filteredGroups.map((g) => {
    const clusters = clusterContributors(g.contributors, 'region', []);
    return {
      outerLabel: g.source,
      sectionTitle: `${g.source} Generation Capacity Details Under FTC/TOC/COD`,
      clusters: clusters.map((cl) => ({
        key: cl.key,
        label: `Total ${cl.key} ${g.source}`,
        rows: cl.rows,
      })),
    };
  });
}

// ── Excel styling tokens ─────────────────────────────────────────────────────
// Clean navy palette — matches the print/PDF summary view (image 1):
//   1E3A5F (deep navy)   — section title + column-header bar, white text
//   FFFFFF / F1F5F9      — data rows (alternating white / slate-50 stripe)
//   E2E8F0 (slate-200)   — per-cluster subtotal background
//   1E3A5F (deep navy)   — grand-total background, white text
//   CBD5E1 (slate-300)   — cell borders
const NAVY  = '1E3A5F';
const SLATE_BORDER = { style: 'thin', color: { rgb: 'CBD5E1' } };
const ALL_BORDERS = { top: SLATE_BORDER, bottom: SLATE_BORDER, left: SLATE_BORDER, right: SLATE_BORDER };

const STYLE_TITLE = {
  font:      { name: 'Arial', sz: 13, bold: true, color: { rgb: 'FFFFFF' } },
  fill:      { fgColor: { rgb: NAVY } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border:    ALL_BORDERS,
};
const STYLE_HEADER = {
  font:      { name: 'Arial', sz: 10, bold: true, color: { rgb: 'FFFFFF' } },
  fill:      { fgColor: { rgb: NAVY } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border:    ALL_BORDERS,
};
// `stripe` toggles the subtle slate-50 background on alternating data rows so
// long sections stay readable, just like the striped print view.
function styleData(isNum, stripe = false) {
  return {
    font:      { name: 'Arial', sz: 10, color: { rgb: '1A1A2E' } },
    fill:      { fgColor: { rgb: stripe ? 'F1F5F9' : 'FFFFFF' } },
    alignment: { horizontal: isNum ? 'right' : 'left', vertical: 'center', wrapText: true },
    border:    ALL_BORDERS,
  };
}
function styleSubtotal(isNum) {
  return {
    font:      { name: 'Arial', sz: 10, bold: true, color: { rgb: '1A1A2E' } },
    fill:      { fgColor: { rgb: 'E2E8F0' } },
    alignment: { horizontal: isNum ? 'right' : 'left', vertical: 'center', wrapText: true },
    border:    ALL_BORDERS,
  };
}
function styleGrandTotal(isNum) {
  return {
    font:      { name: 'Arial', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
    fill:      { fgColor: { rgb: NAVY } },
    alignment: { horizontal: isNum ? 'right' : 'left', vertical: 'center', wrapText: true },
    border:    ALL_BORDERS,
  };
}

// Which columns hold numbers in the SOURCEWISE_HEADERS order — used to align
// data cells to the right (matches Google Sheet behaviour for capacity cols).
const NUMERIC_COL_IDX = new Set([3, 4, 5, 6, 8, 10, 13, 14, 15, 16]);

// Wrap a raw value into a styled cell object that aoa_to_sheet understands.
function cell(value, style) {
  const isNum = typeof value === 'number' && Number.isFinite(value);
  return { v: value == null ? '' : value, t: isNum ? 'n' : 's', s: style };
}

// Column-width preset — tuned so all 19 columns fit a typical Excel
// viewport (~1900px) at 100% zoom, with multi-line cells (dates, remarks,
// long project names) still legible via wrap-text. Total ≈ 250 wch keeps
// the rightmost "Any Other remark" column visible without horizontal
// scrolling. Indexes line up with SOURCEWISE_HEADERS.
const COL_WIDTHS = [
  28, // Generating Station   (wraps for very long names)
  13, // Pooling Station
   6, // Region               (always 2-3 chars: NR/WR/SR/ER/NER)
  10, // Total Plant Capacity
  11, // Total Capacity (CONTD4)
  10, // Capacity applied for FTC
  10, // FTC Completed Capacity
  16, // FTC date if completed (multi-line)
  10, // TOC Issued Capacity
  16, // TOC issuance date     (multi-line)
  10, // COD declared Capacity
  20, // COD Date if Declared  (longest multi-line: "150MW (30.03.2026)\n50MW (01.04.2026)")
  13, // Proposed FTC date
  10, // Capacity Under Process for FTC
  10, // Capacity Under Process for TOC
  10, // Capacity Pending for COD
  12, // Capacity expected in Apr'26
  20, // Issues delaying FTC/TOC/COD (wraps)
  20, // Any Other remark            (wraps)
];

// Append one styled section's rows to the running `aoa` array. Returns the
// updated row index (so the next section knows where it starts) and pushes
// any title-row merge ranges onto `merges`.
function appendSectionToAoa(aoa, merges, sec, startRowIdx, colCount, spacerBefore) {
  let rowIdx = startRowIdx;
  // Spacer between sections.
  if (spacerBefore) { aoa.push([]); rowIdx += 1; }
  // Title row (merged across all columns).
  const titleRow = [cell(sec.sectionTitle, STYLE_TITLE)];
  for (let i = 1; i < colCount; i++) titleRow.push(cell('', STYLE_TITLE));
  aoa.push(titleRow);
  merges.push({ s: { c: 0, r: rowIdx }, e: { c: colCount - 1, r: rowIdx } });
  const titleRowIdx = rowIdx;
  rowIdx += 1;
  // Header row.
  aoa.push(SOURCEWISE_HEADERS.map((h) => cell(h, STYLE_HEADER)));
  const headerRowIdx = rowIdx;
  rowIdx += 1;
  // Data rows clustered by inner key, with a subtotal after each cluster.
  // The Region column (idx 2) is constant within a cluster, so we vertically
  // merge it into one cell per cluster (matching the merged-region look of the
  // summary sheets) and blank the absorbed cells.
  const allRows = [];
  const dataRowIdxs = [];
  const subRowIdxs = [];
  let stripe = false;
  for (const cl of sec.clusters) {
    const clusterStart = rowIdx;
    cl.rows.forEach((c, ri) => {
      const region = c.region ?? sec.outerLabel;
      const row = contributorToRow(c, region);
      if (ri > 0) row[2] = '';                       // absorbed by the merge above
      aoa.push(row.map((v, i) => cell(v, styleData(NUMERIC_COL_IDX.has(i), stripe))));
      allRows.push(c);
      dataRowIdxs.push(rowIdx);
      rowIdx += 1;
      stripe = !stripe;
    });
    if (cl.rows.length > 1) {
      merges.push({ s: { c: 2, r: clusterStart }, e: { c: 2, r: rowIdx - 1 } });
    }
    const subRow = makeTotalRow(cl.label, cl.rows);
    aoa.push(subRow.map((v, i) => cell(v, styleSubtotal(NUMERIC_COL_IDX.has(i)))));
    subRowIdxs.push(rowIdx);
    rowIdx += 1;
    stripe = false;                                  // each cluster restarts striping
  }
  // Grand-total row for the whole section.
  const grandRow = makeTotalRow(`Total ${sec.outerLabel}`, allRows);
  aoa.push(grandRow.map((v, i) => cell(v, styleGrandTotal(NUMERIC_COL_IDX.has(i)))));
  const grandRowIdx = rowIdx;
  rowIdx += 1;
  return { rowIdx, titleRowIdx, headerRowIdx, dataRowIdxs, subRowIdxs, grandRowIdx };
}

// Excel exporter.
//   region / source layouts → one single sheet ("Region wise" / "Source wise")
//                             that concatenates every section, matching the
//                             Google-Sheet workbook tab of the same name.
//   split layout            → one sheet per source (legacy behaviour).
// Either way: navy title + header bar, white/striped data, slate subtotal,
// navy grand-total — matching the print / PDF summary view.
function downloadBreakupExcel(filteredGroups, layout, selectedSources, selectedRegions = new Set()) {
  if (!filteredGroups.length) return;
  const sections = normaliseSections(filteredGroups, layout);
  const wb = XLSX.utils.book_new();
  const colCount = SOURCEWISE_HEADERS.length;
  const colsSpec = SOURCEWISE_HEADERS.map((_, i) => ({ wch: COL_WIDTHS[i] ?? 16 }));

  // Row-height defaults — generous so wrapped multi-line cells render
  // without truncation.
  const TITLE_HPT  = 36;
  const SPACER_HPT = 12;
  const HEADER_HPT = 68;
  const DATA_HPT   = 30;
  const SUB_HPT    = 26;
  const GRAND_HPT  = 30;

  if (layout === 'region' || layout === 'source') {
    // ── Consolidated single-sheet layout ───────────────────────────────────
    const aoa = [];
    const merges = [];
    const rows = [];
    let rowIdx = 0;
    let isFirst = true;
    for (const sec of sections) {
      const before = rowIdx;
      const meta = appendSectionToAoa(aoa, merges, sec, rowIdx, colCount, !isFirst);
      // Fill row-height entries up to the new rowIdx — index into `rows`
      // must match the current aoa length.
      if (!isFirst) rows[before] = { hpt: SPACER_HPT };
      rows[meta.titleRowIdx]  = { hpt: TITLE_HPT };
      rows[meta.headerRowIdx] = { hpt: HEADER_HPT };
      for (const i of meta.dataRowIdxs) rows[i] = { hpt: DATA_HPT };
      for (const i of meta.subRowIdxs)  rows[i] = { hpt: SUB_HPT };
      rows[meta.grandRowIdx]  = { hpt: GRAND_HPT };
      rowIdx = meta.rowIdx;
      isFirst = false;
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = merges;
    ws['!cols']   = colsSpec;
    ws['!rows']   = rows;
    // Print setup: fit all 19 columns onto one page wide (landscape A3) so
    // the rightmost "Any Other remark" never slips onto a second printed
    // page. Pagination still happens vertically.
    ws['!pageSetup'] = { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0, scale: 100, paperSize: 8 };
    ws['!margins']   = { left: 0.2, right: 0.2, top: 0.3, bottom: 0.3, header: 0.1, footer: 0.1 };
    // Freeze nothing here — title bars repeat per section so users navigate
    // by scrolling rather than via a sticky header.
    XLSX.utils.book_append_sheet(wb, ws, layout === 'region' ? 'Region wise' : 'Source wise');
  } else {
    // ── Split layout: one sheet per section (original behaviour) ───────────
    for (const sec of sections) {
      const aoa = [];
      const merges = [];
      const meta = appendSectionToAoa(aoa, merges, sec, 0, colCount, false);
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!merges'] = merges;
      ws['!cols']   = colsSpec;
      const rows = [];
      rows[meta.titleRowIdx]  = { hpt: TITLE_HPT };
      rows[meta.headerRowIdx] = { hpt: HEADER_HPT };
      for (const i of meta.dataRowIdxs) rows[i] = { hpt: DATA_HPT };
      for (const i of meta.subRowIdxs)  rows[i] = { hpt: SUB_HPT };
      rows[meta.grandRowIdx]  = { hpt: GRAND_HPT };
      ws['!rows'] = rows;
      ws['!pageSetup'] = { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0, scale: 100, paperSize: 8 };
      ws['!margins']   = { left: 0.2, right: 0.2, top: 0.3, bottom: 0.3, header: 0.1, footer: 0.1 };
      XLSX.utils.book_append_sheet(wb, ws, String(sec.outerLabel).slice(0, 31));
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const srcTag = selectedSources.size > 0 ? `_${Array.from(selectedSources).join('-')}` : '';
  const regTag = selectedRegions.size > 0 ? `_${Array.from(selectedRegions).join('-')}` : '';
  const tag    = srcTag || regTag ? `${srcTag}${regTag}` : '_all';
  const layoutTag = layout === 'region' ? 'region-wise' : layout === 'source' ? 'source-wise' : 'breakup';
  XLSX.writeFile(wb, `${layoutTag}${tag}_${stamp}.xlsx`);
}

// PDF exporter.
//   region / source layouts → one continuous document — each section flows
//                             after the previous (with a navy title bar)
//                             instead of forcing a page break per section.
//                             Mirrors the Google Sheet's "Region wise" /
//                             "Source wise" tab where every section sits in
//                             a single stream.
//   split layout            → page-per-section (legacy behaviour).
function downloadBreakupPdf(filteredGroups, layout, selectedSources, selectedRegions = new Set()) {
  if (!filteredGroups.length) return;
  const sections = normaliseSections(filteredGroups, layout);
  // A3 landscape — the table has 19 columns and many carry multi-line dates
  // so we need the wider sheet to keep cells legible.
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a3' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const MARGIN = 18;
  const consolidated = layout === 'region' || layout === 'source';

  // Tag rows so the autotable didParseCell hook can apply the cluster /
  // grand-total fill. Stored as the first cell's "_kind" property.
  const ROW_SUB  = 'sub';
  const ROW_GRAND = 'grand';
  function rowOf(kind, cells) {
    const out = cells.slice();
    out._kind = kind;
    return out;
  }

  // Title-bar height — drawn once per section above the autotable.
  const TITLE_H = 32;

  // Per-column widths (points), tuned for A3 landscape so dates wrap to two
  // lines max and the Generating Station column never truncates.
  const PDF_COL_WIDTHS = {
    0:  120,  // Generating Station
    1:   60,  // Pooling Station
    2:   34,  // Region
    3:   46,  // Total Plant Cap
    4:   52,  // CONTD-4 Cap
    5:   52,  // Applied
    6:   52,  // FTC Completed
    7:   78,  // FTC date(s)
    8:   52,  // TOC Issued
    9:   78,  // TOC date(s)
    10:  52,  // COD Declared
    11:  90,  // COD date(s)
    12:  62,  // Proposed FTC
    13:  52,  // U.FTC
    14:  52,  // U.TOC
    15:  52,  // Pend COD
    16:  56,  // Expected
    17: 100,  // Issues
    18: 100,  // Other Remarks
  };

  function drawTitleBar(y, text) {
    doc.setFillColor(30, 58, 95);              // deep navy — matches the print view
    doc.rect(MARGIN, y, W - MARGIN * 2, TITLE_H, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(text, W / 2, y + TITLE_H / 2 + 5, { align: 'center' });
  }

  let firstSection = true;
  let nextY = MARGIN + 8;

  for (const sec of sections) {
    // Decide where the next section starts.
    if (consolidated) {
      // After the first section, leave a small gap and stay on the same
      // page if there's room; otherwise let autotable's natural pagination
      // continue. We force a page break only if the title bar alone won't
      // fit (margin from bottom).
      if (!firstSection) nextY += 14;
      if (nextY + TITLE_H + 40 > H - MARGIN) { doc.addPage(); nextY = MARGIN + 8; }
    } else {
      // Split mode keeps the original page-per-section layout.
      if (!firstSection) { doc.addPage(); nextY = MARGIN + 8; }
    }
    firstSection = false;

    drawTitleBar(nextY, sec.sectionTitle);
    const tableY = nextY + TITLE_H + 4;

    const body = [];
    const allRows = [];
    for (const cl of sec.clusters) {
      let stripe = false;
      cl.rows.forEach((c, ri) => {
        const region = c.region ?? sec.outerLabel;
        const full = contributorToRow(c, region);
        let rowCells;
        if (ri === 0) {
          // First row of the cluster carries the Region cell, spanning the
          // whole cluster (vertical merge). rowSpan:1 is a harmless no-op when
          // the cluster has a single project.
          rowCells = full.slice();
          rowCells[2] = { content: region, rowSpan: cl.rows.length, styles: { valign: 'middle', halign: 'center' } };
        } else {
          // Absorbed rows drop the Region cell so autoTable slots the rest
          // under the spanned cell.
          rowCells = full.slice(0, 2).concat(full.slice(3));
        }
        rowCells._stripe = stripe;
        body.push(rowCells);
        allRows.push(c);
        stripe = !stripe;
      });
      body.push(rowOf(ROW_SUB, makeTotalRow(cl.label, cl.rows)));
    }
    body.push(rowOf(ROW_GRAND, makeTotalRow(`Total ${sec.outerLabel}`, allRows)));

    autoTable(doc, {
      startY: tableY,
      head: [SOURCEWISE_HEADERS],
      body,
      theme: 'grid',
      styles: {
        font: 'helvetica', fontSize: 8, cellPadding: { top: 4, right: 4, bottom: 4, left: 4 },
        valign: 'middle', halign: 'center', overflow: 'linebreak',
        textColor: [26, 26, 46],         // near-black body text
        lineColor: [203, 213, 225], lineWidth: 0.3,   // slate-300 borders
        fillColor: [255, 255, 255],      // white data fill (striped via didParseCell)
        minCellHeight: 18,
      },
      headStyles: {
        fillColor: [30, 58, 95],         // navy header bar
        textColor: [255, 255, 255],
        fontStyle: 'bold', fontSize: 8.5,
        halign: 'center', valign: 'middle',
        lineColor: [203, 213, 225], lineWidth: 0.4,
        minCellHeight: 34,
        cellPadding: { top: 5, right: 4, bottom: 5, left: 4 },
      },
      columnStyles: {
        ...Object.fromEntries(
          Object.entries(PDF_COL_WIDTHS).map(([i, w]) => [Number(i), { cellWidth: w }]),
        ),
        // Right-align every numeric column to match the Google Sheet.
        ...Object.fromEntries(
          Array.from(NUMERIC_COL_IDX).map((i) => [i, { halign: 'right', cellWidth: PDF_COL_WIDTHS[i] ?? 50 }]),
        ),
        // Left-align long text columns (project name, remarks).
        0:  { halign: 'left',   cellWidth: PDF_COL_WIDTHS[0] },
        17: { halign: 'left',   cellWidth: PDF_COL_WIDTHS[17] },
        18: { halign: 'left',   cellWidth: PDF_COL_WIDTHS[18] },
      },
      didParseCell: (data) => {
        if (data.section !== 'body') return;
        const raw = data.row.raw;
        const kind = raw && raw._kind;
        if (kind === ROW_SUB) {
          data.cell.styles.fillColor = [226, 232, 240]; // slate-200 subtotal
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.textColor = [26, 26, 46];
        } else if (kind === ROW_GRAND) {
          data.cell.styles.fillColor = [30, 58, 95];     // navy grand-total
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.textColor = [255, 255, 255];
          data.cell.styles.fontSize = 9;
        } else if (raw && raw._stripe) {
          data.cell.styles.fillColor = [241, 245, 249];  // slate-50 stripe
        }
      },
      didDrawPage: () => {
        const p = doc.getCurrentPageInfo().pageNumber;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8); doc.setTextColor(110);
        doc.text(`Page ${p}`, W - MARGIN - 30, H - 10);
        doc.text(`${layout}-wise breakup · ${new Date().toLocaleDateString('en-IN')}`, MARGIN, H - 10);
      },
      margin: { left: MARGIN, right: MARGIN, top: MARGIN + 8 },
    });

    // Track where the next section should start (autotable updates
    // doc.lastAutoTable for us).
    nextY = (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY : tableY + 40;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const srcTag = selectedSources.size > 0 ? `_${Array.from(selectedSources).join('-')}` : '';
  const regTag = selectedRegions.size > 0 ? `_${Array.from(selectedRegions).join('-')}` : '';
  const tag    = srcTag || regTag ? `${srcTag}${regTag}` : '_all';
  const layoutTag = layout === 'region' ? 'region-wise' : layout === 'source' ? 'source-wise' : 'breakup';
  doc.save(`${layoutTag}${tag}_${stamp}.pdf`);
}

// ── Activity-tab exporters (FTC/TOC/COD in-range MW + dates) ──────────────────
// The generic breakup exporters above are built around the funnel columns
// (SOURCEWISE_HEADERS). The activity tab's rows are per-milestone MW + dated
// events, so it gets dedicated Excel/PDF exporters that mirror the modal.
const ACTIVITY_HEADERS = ['Region', 'Source', 'Project', 'Pooling Stn', 'Plant Type', 'FTC (MW)', 'FTC Dates', 'TOC (MW)', 'TOC Dates', 'COD (MW)', 'COD Dates'];
const ACT_NUM_IDX = new Set([5, 7, 9]);
const ACT_COL_WIDTHS = [7, 9, 30, 14, 18, 9, 22, 9, 22, 9, 22];
const SRC_LABEL = { WIND: 'Wind', SOLAR: 'Solar', BESS: 'BESS', HYBRID: 'Hybrid', COAL: 'Coal', HYDRO: 'Hydro', PSP: 'PSP' };
const srcLabel = (s) => SRC_LABEL[s] ?? s;

// One event list → "33.33 MW · 03 Jun 26 / 33.33 MW · 12 Jun 26".
function eventsToStr(events) {
  return (events ?? [])
    .filter((e) => e && (e.mw > 0 || e.date))
    .map((e) => `${e.mw > 0 ? `${fmt(e.mw)} MW · ` : ''}${fmtDate(e.date)}`)
    .join('\n');
}
function activityRangeLabel(from, to) {
  const d = (s) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '…');
  return `${d(from)} → ${d(to)}`;
}

function downloadActivityExcel(filteredGroups, from, to) {
  if (!filteredGroups.length) return;
  const colCount = ACTIVITY_HEADERS.length;
  const aoa = [];
  const merges = [];
  let r = 0;
  aoa.push([cell(`FTC / TOC / COD Activity — Contributors   (${activityRangeLabel(from, to)})`, STYLE_TITLE),
    ...Array.from({ length: colCount - 1 }, () => cell('', STYLE_TITLE))]);
  merges.push({ s: { c: 0, r }, e: { c: colCount - 1, r } }); r += 1;
  aoa.push(ACTIVITY_HEADERS.map((h) => cell(h, STYLE_HEADER))); r += 1;

  const gtot = { ftc: 0, toc: 0, cod: 0 };
  let stripe = false;
  for (const g of filteredGroups) {
    const sub = { ftc: 0, toc: 0, cod: 0 };
    for (const c of g.contributors) {
      const row = [
        g.region, srcLabel(g.source), c.name, c.poolingStation ?? '—', c.plantType ?? '—',
        Number(c.ftc) || 0, eventsToStr(c.ftcEvents),
        Number(c.toc) || 0, eventsToStr(c.tocEvents),
        Number(c.cod) || 0, eventsToStr(c.codEvents),
      ];
      aoa.push(row.map((v, i) => cell(v, styleData(ACT_NUM_IDX.has(i), stripe)))); r += 1;
      stripe = !stripe;
      sub.ftc += Number(c.ftc) || 0; sub.toc += Number(c.toc) || 0; sub.cod += Number(c.cod) || 0;
    }
    const subRow = [`Total ${g.region} · ${srcLabel(g.source)}`, '', '', '', '', sub.ftc, '', sub.toc, '', sub.cod, ''];
    aoa.push(subRow.map((v, i) => cell(v, styleSubtotal(ACT_NUM_IDX.has(i)))));
    merges.push({ s: { c: 0, r }, e: { c: 4, r } }); r += 1;
    stripe = false;
    gtot.ftc += sub.ftc; gtot.toc += sub.toc; gtot.cod += sub.cod;
  }
  const grand = ['Grand Total', '', '', '', '', gtot.ftc, '', gtot.toc, '', gtot.cod, ''];
  aoa.push(grand.map((v, i) => cell(v, styleGrandTotal(ACT_NUM_IDX.has(i)))));
  merges.push({ s: { c: 0, r }, e: { c: 4, r } });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges;
  ws['!cols'] = ACT_COL_WIDTHS.map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'FTC-TOC-COD Activity');
  XLSX.writeFile(wb, `ftc-toc-cod-activity_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function downloadActivityPdf(filteredGroups, from, to) {
  if (!filteredGroups.length) return;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a3' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const MARGIN = 24;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(30, 58, 95);
  doc.text('FTC / TOC / COD Activity — Contributors', MARGIN, MARGIN + 6);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90);
  doc.text(activityRangeLabel(from, to), MARGIN, MARGIN + 22);

  const SUB = 'S', GRAND = 'G';
  const body = [];
  const gtot = { ftc: 0, toc: 0, cod: 0 };
  for (const g of filteredGroups) {
    const sub = { ftc: 0, toc: 0, cod: 0 };
    for (const c of g.contributors) {
      body.push({ kind: null, cells: [g.region, srcLabel(g.source), c.name, c.poolingStation ?? '—', c.plantType ?? '—',
        fmt(c.ftc), eventsToStr(c.ftcEvents), fmt(c.toc), eventsToStr(c.tocEvents), fmt(c.cod), eventsToStr(c.codEvents)] });
      sub.ftc += Number(c.ftc) || 0; sub.toc += Number(c.toc) || 0; sub.cod += Number(c.cod) || 0;
    }
    body.push({ kind: SUB, cells: [`Total ${g.region} · ${srcLabel(g.source)}`, '', '', '', '', fmt(sub.ftc), '', fmt(sub.toc), '', fmt(sub.cod), ''] });
    gtot.ftc += sub.ftc; gtot.toc += sub.toc; gtot.cod += sub.cod;
  }
  body.push({ kind: GRAND, cells: ['Grand Total', '', '', '', '', fmt(gtot.ftc), '', fmt(gtot.toc), '', fmt(gtot.cod), ''] });

  autoTable(doc, {
    startY: MARGIN + 32,
    head: [ACTIVITY_HEADERS],
    body: body.map((b) => b.cells),
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8, valign: 'middle', halign: 'center', overflow: 'linebreak', textColor: [26, 26, 46], lineColor: [203, 213, 225], lineWidth: 0.3, minCellHeight: 16 },
    headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5, minCellHeight: 22 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 36 }, 1: { halign: 'center', cellWidth: 46 },
      2: { halign: 'left', cellWidth: 190 }, 3: { halign: 'left', cellWidth: 96 }, 4: { halign: 'left', cellWidth: 116 },
      5: { halign: 'right', cellWidth: 52 }, 6: { halign: 'left', cellWidth: 118 },
      7: { halign: 'right', cellWidth: 52 }, 8: { halign: 'left', cellWidth: 118 },
      9: { halign: 'right', cellWidth: 52 }, 10: { halign: 'left', cellWidth: 118 },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const k = body[data.row.index]?.kind;
      if (k === SUB) { data.cell.styles.fillColor = [226, 232, 240]; data.cell.styles.fontStyle = 'bold'; }
      else if (k === GRAND) { data.cell.styles.fillColor = [30, 58, 95]; data.cell.styles.textColor = [255, 255, 255]; data.cell.styles.fontStyle = 'bold'; }
    },
    didDrawPage: () => {
      const p = doc.getCurrentPageInfo().pageNumber;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110);
      doc.text(`Page ${p}`, W - MARGIN - 30, H - 10);
      doc.text(`FTC/TOC/COD activity · ${new Date().toLocaleDateString('en-IN')}`, MARGIN, H - 10);
    },
    margin: { left: MARGIN, right: MARGIN, top: MARGIN },
  });
  doc.save(`ftc-toc-cod-activity_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// "MW + event-dates" stacked cell. Top line: total MW. Stack underneath:
// one line per event — "150 MW · 30 Mar 26" when `showMw` is set (the
// default for FTC / TOC / COD so partial commissioning quantum is visible
// per date), or a bare "13 Mar 26" otherwise. Matches the Excel "FTC/TOC/COD
// date if completed" cell formats where each partial date carries its MW.
function EventStackCell({ total, events, showMw }) {
  const totalN = Number(total) || 0;
  const list   = (events ?? []).filter((e) => e && (e.mw > 0 || e.date));
  return (
    <div className="flex flex-col items-end gap-0.5 leading-tight">
      <span className={totalN > 0 ? 'text-slate-800 font-semibold' : 'text-slate-300'}>{fmt(total)}</span>
      {list.length > 0 && (
        <div className="text-[10px] text-slate-500 font-normal space-y-0.5">
          {list.map((e, i) => (
            <div key={i} className="whitespace-nowrap">
              {showMw && e.mw > 0 ? `${fmt(e.mw)} MW · ` : ''}{fmtDate(e.date)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const REGION_BADGE = {
  NR:  'bg-indigo-100 text-indigo-700', WR: 'bg-orange-100 text-orange-700',
  SR:  'bg-pink-100 text-pink-700',     ER: 'bg-cyan-100 text-cyan-700',
  NER: 'bg-lime-100 text-lime-700',
};
const SOURCE_BADGE = {
  WIND:'bg-sky-100 text-sky-700', SOLAR:'bg-amber-100 text-amber-700',
  BESS:'bg-violet-100 text-violet-700', HYBRID:'bg-teal-100 text-teal-700',
  COAL:'bg-stone-100 text-stone-700', HYDRO:'bg-blue-100 text-blue-700',
  PSP: 'bg-emerald-100 text-emerald-700',
  HYBRID_WS:'bg-teal-100 text-teal-700', HYBRID_SB:'bg-teal-100 text-teal-700',
  HYBRID_WSB:'bg-teal-100 text-teal-700',
};

function Chip({ label, cls }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${cls ?? 'bg-slate-100 text-slate-700'}`}>
      {label}
    </span>
  );
}

// One contributor row — extracted so the consolidated layouts (which render
// rows interleaved with subtotal rows) can reuse exactly the same cell
// rendering as the original split layout.
function ContribRow({ c, cols, sub = false }) {
  // Sub-row: a per-source bifurcation line under a hybrid project. Show the
  // component label (indented) in the first column, numeric + event-stack cells,
  // and leave the descriptive (tag/text) cells blank.
  if (sub) {
    let firstTextDone = false;
    return (
      <tr className="border-b border-slate-100/70 last:border-b-0 bg-slate-50/40 align-top">
        {cols.map((col) => {
          let content = null;
          if (col.isEventStack) content = <EventStackCell total={c[col.key]} events={c[`${col.isEventStack}Events`]} showMw />;
          else if (col.isNum) content = <span className={Number(c[col.key]) > 0 ? 'text-slate-600' : 'text-slate-300'}>{fmt(c[col.key])}</span>;
          else if (!firstTextDone) { firstTextDone = true; content = <span className="pl-5 text-[10px] font-medium text-slate-500">↳ {CONTD4_SOURCE_LABEL[c.component] ?? c.component}</span>; }
          return (
            <td key={col.key} className={`px-3 py-1 ${col.align === 'right' ? 'text-right tabular-nums' : 'text-left'} ${col.flex}`}>{content}</td>
          );
        })}
      </tr>
    );
  }
  return (
    <tr className="border-b border-slate-100 last:border-b-0 hover:bg-blue-50/30 align-top">
      {cols.map((col) => (
        <td key={col.key} className={`px-3 py-1.5 ${col.align === 'right' ? 'text-right tabular-nums' : 'text-left'} ${col.flex}`}>
          {/* Event-stack cells (FTC / TOC / COD) — show the total MW
              on the first line, then a stack of per-event entries
              below: "150 MW · 13 Mar 26". Matches the Excel where
              partial commissioning dates are listed under the total. */}
          {col.isEventStack
            ? <EventStackCell total={c[col.key]} events={c[`${col.isEventStack}Events`]} showMw />
            : col.isTag === 'region'
            ? (c.region ? <Chip label={c.region} cls={REGION_BADGE[c.region]} /> : <span className="text-slate-300">—</span>)
            : col.isTag === 'source'
            ? (c.source ? <Chip label={CONTD4_SOURCE_LABEL[c.source] ?? c.source} cls={SOURCE_BADGE[c.source] ?? 'bg-slate-100 text-slate-700'} /> : <span className="text-slate-300">—</span>)
            : col.isNum
            ? <span className={Number(c[col.key]) > 0 ? 'text-slate-800' : 'text-slate-300'}>{fmt(c[col.key])}</span>
            : col.key === 'pending'
            ? (c.pending
                ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">Yes</span>
                : <span className="text-[10px] text-slate-400">No</span>)
            : col.key === 'status'
            ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">{c.status}</span>
            : col.key === 'proposedFtcDate'
            ? <span className="text-slate-700">{fmtDate(c.proposedFtcDate)}</span>
            : (col.key === 'delayRemarks' || col.key === 'otherRemarks')
            ? (c[col.key]
                ? <span className="text-[11px] text-slate-700 line-clamp-2" title={c[col.key]}>{c[col.key]}</span>
                : <span className="text-slate-300">—</span>)
            : <span className="text-slate-700">{c[col.key] ?? '—'}</span>}
        </td>
      ))}
    </tr>
  );
}

// Classify a project's source like grid-computations.getProjectSource()
function projectSource(p) {
  if (p.plantType?.isHybrid) return 'HYBRID';
  if ((p.phases ?? []).length > 0) return p.phases[0].sourceType;
  const l = (p.plantType?.label ?? '').toUpperCase();
  if (l.includes('WIND'))                            return 'WIND';
  if (l.includes('SOLAR'))                           return 'SOLAR';
  if (l.includes('BESS') || l.includes('BATTERY'))   return 'BESS';
  if (l.includes('COAL') || l.includes('THERMAL'))   return 'COAL';
  if (l.includes('HYDRO'))                           return 'HYDRO';
  if (l.includes('PSP')  || l.includes('PUMP'))      return 'PSP';
  return 'OTHER';
}

function contd4StudySource(p) {
  return p.plantType?.isHybrid ? p.plantType.code : projectSource(p);
}

// ── Builders: one per tab — return [{ region, source, label, contributors: [...] }] ─

function buildPipelineGroups(projects, asOf = null) {
  const cleared = projects.filter(isInFtcPipeline);
  const groups = {};
  // Normalise an event row to { mw, date } so the renderer can build the
  // Excel-style "150MW (30.03.2026), 50MW (01.04.2026)" cells without
  // worrying about which source-shape it came from.
  const mapEv = (e) => ({
    mw: Number(e.capacityMw ?? e.mw ?? 0),
    date: e.eventDate ?? e.date ?? null,
    remarks: e.remarks ?? null,
  });
  const num = (v) => Number(v) || 0;
  const r3 = (x) => Math.round(x * 1000) / 1000;
  for (const p of cleared) {
    const region = p.region.code;
    const source = projectSource(p);
    const key = `${region}|${source}`;
    if (!groups[key]) groups[key] = { region, source, contributors: [] };

    // Aggregate across ALL phases (hybrids have one per component) and use the
    // SAME date-gated milestone logic as computePipelineMatrix, so the breakup
    // totals exactly equal the values shown in the FTC Pipeline table.
    const phases = p.phases ?? [];
    const isHybrid = !!p.plantType?.isHybrid && phases.length > 1;
    // Per-component plant capacity (for the sub-row "Total" column).
    const hcomp = {};
    for (const c of (p.hybridComponentsJson?.components ?? [])) hcomp[c.sourceType] = c;
    const agg = { applied: 0, ftc: 0, uftc: 0, toc: 0, utoc: 0, cod: 0, pendcod: 0, exp: 0 };
    const ftcEvents = [], tocEvents = [], codEvents = [];
    const components = [];
    for (const ph of phases) {
      const cFtc = milestoneAsOf(ph.ftcEvents, asOf, ph.ftcCompletedDate, ph.ftcCompletedMw);
      const cToc = milestoneAsOf(ph.tocEvents, asOf, ph.tocIssuedDate,    ph.tocIssuedMw);
      const cCod = milestoneAsOf(ph.codEvents, asOf, ph.codDeclaredDate,  ph.codDeclaredMw);
      agg.applied += num(ph.capacityAppliedMw);
      agg.ftc += cFtc; agg.toc += cToc; agg.cod += cCod;
      agg.uftc    += num(ph.capacityUnderFtcMw);
      agg.utoc    += num(ph.capacityUnderTocMw);
      agg.pendcod += num(ph.capacityPendingCodMw);
      agg.exp     += num(ph.expectedApr26Mw);
      const fe = (ph.ftcEvents ?? []).map(mapEv), te = (ph.tocEvents ?? []).map(mapEv), ce = (ph.codEvents ?? []).map(mapEv);
      ftcEvents.push(...fe); tocEvents.push(...te); codEvents.push(...ce);
      // One bifurcation sub-row per source component (hybrids only). Pending
      // columns are funnel gaps (clamped ≥ 0), matching the matrix.
      if (isHybrid) {
        const cApplied = num(ph.capacityAppliedMw);
        components.push({
          component: ph.sourceType,
          total:   num(hcomp[ph.sourceType]?.totalMw),
          contd4:  num(hcomp[ph.sourceType]?.contd4Mw),
          applied: cApplied,
          ftc: cFtc, uftc: Math.max(0, r3(cApplied - cFtc)),
          toc: cToc, utoc: Math.max(0, r3(cFtc - cToc)),
          cod: cCod, pendcod: Math.max(0, r3(cToc - cCod)),
          exp: num(ph.expectedApr26Mw),
          ftcEvents: fe, tocEvents: te, codEvents: ce,
        });
      }
    }
    const first = phases[0] ?? {};
    groups[key].contributors.push({
      id: p.id, name: p.name, plantType: p.plantType?.label, region,
      poolingStation: p.poolingStation?.name ?? null,
      total:   num(p.totalCapacityMw),
      contd4:  num(p.contd4?.capacityApr26Mw),
      applied: agg.applied,
      ftc:     agg.ftc,
      uftc:    Math.max(0, r3(agg.applied - agg.ftc)),
      toc:     agg.toc,
      utoc:    Math.max(0, r3(agg.ftc - agg.toc)),
      cod:     agg.cod,
      pendcod: Math.max(0, r3(agg.toc - agg.cod)),
      exp:     agg.exp,
      // Per-event timelines (across all components) for the Excel-style date cells.
      ftcEvents, tocEvents, codEvents,
      components: isHybrid ? components : null,
      proposedFtcDate: first.proposedFtcDate ?? null,
      delayRemarks:    first.delayRemarks ?? null,
      otherRemarks:    first.otherRemarks ?? null,
    });
  }
  return Object.values(groups).sort((a, b) =>
    (a.region.localeCompare(b.region) || a.source.localeCompare(b.source)),
  );
}

// ── Consolidation helpers ────────────────────────────────────────────────────
// Reshape the Region × Source split groups into the two consolidated layouts
// that match the Excel sheets:
//
//   region layout → one section per region (NR / WR / SR / ER / NER), every
//                   row carries its source. Inside, rows are clustered by
//                   source with a "Total <region> <source>" subtotal row,
//                   then a grand "Total <region>" at the bottom. This matches
//                   the per-region sheets ("NR Generation Capacity Under
//                   Process of FTC", etc.).
//
//   source layout → one section per source (Wind / Solar / BESS / …), every
//                   row carries its region. Rows are clustered by region with
//                   a "Total <source> <region>" subtotal, plus a grand
//                   "Total <source>" at the bottom. This matches the "Source
//                   wise" sheet ("Wind Generation Capacity Details Under
//                   FTC/TOC/COD", etc.).
//
// Each contributor in the consolidated section already has its `region` and
// the source is added; that's what powers the inline Region/Source column.
const SOURCE_ORDER = ['WIND', 'SOLAR', 'BESS', 'HYBRID', 'COAL', 'HYDRO', 'PSP'];
const REGION_ORDER = ['NR', 'WR', 'SR', 'ER', 'NER'];

function orderIndex(arr, v) {
  const i = arr.indexOf(v);
  return i < 0 ? arr.length : i;
}

function consolidateByRegion(groups) {
  const byRegion = {};
  for (const g of groups) {
    if (!byRegion[g.region]) byRegion[g.region] = { region: g.region, contributors: [] };
    for (const c of g.contributors) {
      byRegion[g.region].contributors.push({ ...c, source: g.source, region: g.region });
    }
  }
  for (const r of Object.values(byRegion)) {
    r.contributors.sort((a, b) =>
      (orderIndex(SOURCE_ORDER, a.source) - orderIndex(SOURCE_ORDER, b.source))
      || (a.source || '').localeCompare(b.source || '')
      || (a.name   || '').localeCompare(b.name   || ''),
    );
  }
  return Object.values(byRegion).sort((a, b) =>
    (orderIndex(REGION_ORDER, a.region) - orderIndex(REGION_ORDER, b.region))
    || a.region.localeCompare(b.region),
  );
}

function consolidateBySource(groups) {
  const bySource = {};
  for (const g of groups) {
    if (!bySource[g.source]) bySource[g.source] = { source: g.source, contributors: [] };
    for (const c of g.contributors) {
      bySource[g.source].contributors.push({ ...c, source: g.source, region: g.region });
    }
  }
  for (const s of Object.values(bySource)) {
    s.contributors.sort((a, b) =>
      (orderIndex(REGION_ORDER, a.region) - orderIndex(REGION_ORDER, b.region))
      || (a.region || '').localeCompare(b.region || '')
      || (a.name   || '').localeCompare(b.name   || ''),
    );
  }
  return Object.values(bySource).sort((a, b) =>
    (orderIndex(SOURCE_ORDER, a.source) - orderIndex(SOURCE_ORDER, b.source))
    || a.source.localeCompare(b.source),
  );
}

// Cluster a section's contributors by the inner key (source for region
// layout, region for source layout). Returns an array of
// { key, label, rows, totals } in display order, so the renderer can drop in
// a "Total <outer> <inner>" subtotal row between clusters.
function clusterContributors(contributors, innerKey, numCols) {
  const order = innerKey === 'source' ? SOURCE_ORDER : REGION_ORDER;
  const buckets = new Map();
  for (const c of contributors) {
    const k = c[innerKey] ?? '—';
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(c);
  }
  const keys = Array.from(buckets.keys()).sort((a, b) =>
    (orderIndex(order, a) - orderIndex(order, b)) || a.localeCompare(b),
  );
  return keys.map((k) => {
    const rows = buckets.get(k);
    const totals = {};
    for (const c of numCols) totals[c.key] = rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
    return { key: k, rows, totals };
  });
}

function buildContd4Groups(projects) {
  const active = projects.filter(p => p.contd4 && !['CLEARED','REJECTED'].includes(p.contd4.status));
  const groups = {};
  for (const p of active) {
    const region = p.region.code;
    const source = contd4StudySource(p);
    const key = `${region}|${source}`;
    if (!groups[key]) groups[key] = { region, source, contributors: [] };
    groups[key].contributors.push({
      id: p.id, name: p.name, plantType: p.plantType?.label, region,
      total:   Number(p.totalCapacityMw) || 0,
      capInMonth: Number(p.contd4?.capacityApr26Mw) || 0,
      month:   p.contd4?.capacityMonth || '—',
      status:  p.contd4?.status,
      appDate: p.contd4?.applicationDate ? new Date(p.contd4.applicationDate).toISOString().slice(0,10) : '—',
    });
  }
  return Object.values(groups).sort((a, b) =>
    (a.region.localeCompare(b.region) || a.source.localeCompare(b.source)),
  );
}

function buildHybridGroups(projects, asOf = null) {
  // Mirror computeHybridBreakdown EXACTLY — same attribution ladder, so the
  // breakup equals the matrix: 1. commissioning PHASES (live tracker data),
  // 2. segregation JSON (legacy phaseless seeds, deduped by name),
  // 3. per-source capacity columns (totals only).
  const hybrids = projects.filter(p => p.plantType?.isHybrid && isInFtcPipeline(p));
  let cutoff = asOf; if (!cutoff) { cutoff = new Date(); cutoff.setUTCHours(23, 59, 59, 999); }
  const gate = (mw, date) => { const m = Number(mw) || 0; if (!date) return m; return new Date(date) <= cutoff ? m : 0; };
  const N = (v) => Number(v) || 0;
  const groups = {};
  const seenJson = new Set();
  const push = (region, ht, contrib) => {
    const key = `${region}|${ht}`;
    if (!groups[key]) groups[key] = { region, source: ht, contributors: [] };
    groups[key].contributors.push(contrib);
  };
  const CAP_COL = { WIND: 'windCapacityMw', SOLAR: 'solarCapacityMw', BESS: 'bessCapacityMw' };

  for (const p of hybrids) {
    const region = p.region.code;
    const phases = p.phases ?? [];

    // 1. Phase-level split.
    if (phases.length) {
      const ht = p.plantType.label;
      const bySource = {};
      for (const ph of phases) {
        const acc = (bySource[ph.sourceType] ??= { applied: 0, ftc: 0, toc: 0, cod: 0, exp: 0 });
        acc.applied += N(ph.capacityAppliedMw);
        acc.ftc     += milestoneAsOf(ph.ftcEvents, asOf, ph.ftcCompletedDate, ph.ftcCompletedMw);
        acc.toc     += milestoneAsOf(ph.tocEvents, asOf, ph.tocIssuedDate,    ph.tocIssuedMw);
        acc.cod     += milestoneAsOf(ph.codEvents, asOf, ph.codDeclaredDate,  ph.codDeclaredMw);
        acc.exp     += N(ph.expectedApr26Mw);
      }
      const sources = Object.keys(bySource);
      let weights = sources.map((s) => bySource[s].applied);
      if (!weights.some((w) => w > 0)) weights = sources.map((s) => N(p[CAP_COL[s]]));
      if (!weights.some((w) => w > 0)) weights = sources.map(() => 1);
      const wBase = weights.reduce((a, b) => a + b, 0);
      const totalCap = N(p.totalCapacityMw);
      sources.forEach((s, i) => {
        push(region, ht, {
          id: `${p.id}|${s}`, name: p.name, plantType: ht, region, component: s,
          total:   totalCap * (weights[i] / wBase),
          applied: bySource[s].applied,
          ftc: bySource[s].ftc, toc: bySource[s].toc, cod: bySource[s].cod,
          exp: bySource[s].exp,
        });
      });
      continue;
    }

    // 2. Segregation JSON (phaseless legacy).
    const data = p.hybridComponentsJson;
    if ((data?.components ?? []).length) {
      if (seenJson.has(p.name)) continue;
      seenJson.add(p.name);
      const ht = data.hybridType || p.plantType.label;
      for (const c of data.components) {
        push(region, ht, {
          id: `${p.id}|${c.sourceType}`, name: p.name, plantType: ht, region,
          component: c.sourceType,
          total:   N(c.totalMw),
          applied: N(c.appliedMw),
          ftc: gate(c.ftcMw, c.ftcDate), toc: gate(c.tocMw, c.tocDate), cod: gate(c.codMw, c.codDate),
          exp: N(c.expectedMw),
        });
      }
      continue;
    }

    // 3. Capacity-column split (totals only).
    const capSplit = [['WIND', N(p.windCapacityMw)], ['SOLAR', N(p.solarCapacityMw)], ['BESS', N(p.bessCapacityMw)]].filter(([, v]) => v > 0);
    if (capSplit.length) {
      const base = capSplit.reduce((s, [, v]) => s + v, 0);
      const ht = p.plantType.label;
      for (const [s, v] of capSplit) {
        push(region, ht, {
          id: `${p.id}|${s}`, name: p.name, plantType: ht, region, component: s,
          total: N(p.totalCapacityMw) * (v / base), applied: 0, ftc: 0, toc: 0, cod: 0, exp: 0,
        });
      }
    }
  }
  return Object.values(groups).sort((a, b) =>
    (a.region.localeCompare(b.region) || a.source.localeCompare(b.source)),
  );
}

function buildTransmissionGroups(txElements) {
  const CAT_LABELS = {
    LINE_RE:'Line — RE Pocket', LINE_NONRE:'Line — Non-RE',
    ICT_RE: 'ICT — RE Pocket',  ICT_NONRE: 'ICT — Non-RE',
    GT: 'GT', ST: 'ST',
  };
  function cat(el) {
    if (el.elementType === 'LINE') return el.isRe ? 'LINE_RE' : 'LINE_NONRE';
    if (el.elementType === 'ICT')  return el.isRe ? 'ICT_RE'  : 'ICT_NONRE';
    return el.elementType;
  }
  const groups = {};
  for (const e of txElements) {
    const region = e.region.code;
    const c      = cat(e);
    const key = `${region}|${c}`;
    if (!groups[key]) groups[key] = { region, source: CAT_LABELS[c] ?? c, contributors: [] };
    groups[key].contributors.push({
      id: e.id, name: e.elementName, plantType: e.elementType, region,
      agency: e.agencyOwner, voltage: e.voltageRatingKv,
      cap:     Number(e.capacityMva) || 0,
      length:  Number(e.lineLengthKm) || 0,
      pendCap: Number(e.capacityApr26Mva) || 0,
      pendLen: Number(e.lineLengthApr26Km) || 0,
      pending: !!e.pendingFtc,
    });
  }
  return Object.values(groups).sort((a, b) =>
    (a.region.localeCompare(b.region) || a.source.localeCompare(b.source)),
  );
}

// Activity breakup: per-project FTC / TOC / COD milestones whose eventDate
// falls within [from, to], grouped by Region × Source — mirrors the
// FTC/TOC/COD Activity tab's matrix. `from`/`to` are YYYY-MM-DD strings.
function buildActivityGroups(projects, from, to) {
  const cleared = projects.filter(isInFtcPipeline);
  const fromT = from ? new Date(from + 'T00:00:00.000Z').getTime() : null;
  const toT   = to   ? new Date(to   + 'T23:59:59.999Z').getTime() : null;
  const inRange = (d) => {
    if (!d) return false;
    const t = new Date(d).getTime();
    if (fromT != null && t < fromT) return false;
    if (toT   != null && t > toT)   return false;
    return true;
  };
  const mapEv = (e) => ({ mw: Number(e.capacityMw ?? e.mw ?? 0), date: e.eventDate ?? e.date ?? null });
  const sum = (arr) => arr.reduce((s, e) => s + e.mw, 0);

  const groups = {};
  for (const p of cleared) {
    const region = p.region.code;
    const source = projectSource(p);
    // Aggregate the in-range events across all of the project's phases.
    const ftcEvents = [], tocEvents = [], codEvents = [];
    for (const ph of (p.phases ?? [])) {
      for (const e of (ph.ftcEvents ?? [])) if (inRange(e.eventDate)) ftcEvents.push(mapEv(e));
      for (const e of (ph.tocEvents ?? [])) if (inRange(e.eventDate)) tocEvents.push(mapEv(e));
      for (const e of (ph.codEvents ?? [])) if (inRange(e.eventDate)) codEvents.push(mapEv(e));
    }
    if (ftcEvents.length + tocEvents.length + codEvents.length === 0) continue;
    const key = `${region}|${source}`;
    if (!groups[key]) groups[key] = { region, source, contributors: [] };
    groups[key].contributors.push({
      id: p.id, name: p.name, region, plantType: p.plantType?.label,
      poolingStation: p.poolingStation?.name ?? null,
      ftc: sum(ftcEvents), toc: sum(tocEvents), cod: sum(codEvents),
      ftcEvents, tocEvents, codEvents,
    });
  }
  return Object.values(groups).sort((a, b) =>
    (a.region.localeCompare(b.region) || a.source.localeCompare(b.source)),
  );
}

// ── Per-tab column definitions ────────────────────────────────────────────────

// Inline tag columns used by the consolidated layouts:
//  - region layout: each row carries its source → prepend Source after Project
//  - source layout: each row carries its region → prepend Region after Project
const SOURCE_INLINE_COL = { key: 'source', label: 'Source', align: 'left', flex: 'w-20', isTag: 'source' };
const REGION_INLINE_COL = { key: 'region', label: 'Region', align: 'left', flex: 'w-16', isTag: 'region' };

const COLUMNS = {
  pipeline: [
    { key: 'name',         label: 'Project',         align: 'left',  flex: 'min-w-[200px]' },
    { key: 'poolingStation', label: 'Pooling Stn',   align: 'left',  flex: 'min-w-[100px]' },
    { key: 'plantType',    label: 'Type',            align: 'left',  flex: 'min-w-[110px]' },
    { key: 'total',        label: 'Total Cap',       align: 'right', flex: 'w-20', isNum: true },
    { key: 'contd4',       label: 'CONTD-4 Cap',     align: 'right', flex: 'w-24', isNum: true },
    { key: 'applied',      label: 'Applied',         align: 'right', flex: 'w-20', isNum: true },
    { key: 'ftc',          label: 'FTC + Dates',     align: 'right', flex: 'min-w-[140px]', isNum: true, isEventStack: 'ftc' },
    { key: 'uftc',         label: '↳ U.FTC',         align: 'right', flex: 'w-20', isNum: true },
    { key: 'toc',          label: 'TOC + Dates',     align: 'right', flex: 'min-w-[140px]', isNum: true, isEventStack: 'toc' },
    { key: 'utoc',         label: '↳ U.TOC',         align: 'right', flex: 'w-20', isNum: true },
    { key: 'cod',          label: 'COD + Dates',     align: 'right', flex: 'min-w-[160px]', isNum: true, isEventStack: 'cod' },
    { key: 'pendcod',      label: 'Pend COD',        align: 'right', flex: 'w-20', isNum: true },
    { key: 'proposedFtcDate', label: 'Proposed FTC', align: 'left',  flex: 'min-w-[100px]' },
    { key: 'exp',          label: 'Expected',        align: 'right', flex: 'w-20', isNum: true },
    { key: 'delayRemarks', label: 'Issues',          align: 'left',  flex: 'min-w-[160px]' },
    { key: 'otherRemarks', label: 'Other Remarks',   align: 'left',  flex: 'min-w-[160px]' },
  ],
  contd4: [
    { key: 'name',     label: 'Project',         align: 'left',  flex: 'flex-1 min-w-[200px]' },
    { key: 'plantType',label: 'Type',            align: 'left',  flex: 'min-w-[120px]' },
    { key: 'status',   label: 'Status',          align: 'left',  flex: 'w-24' },
    { key: 'month',    label: 'Target Mo.',      align: 'left',  flex: 'w-24' },
    { key: 'appDate',  label: 'Applied',         align: 'left',  flex: 'w-28' },
    { key: 'total',    label: 'Total MW',        align: 'right', flex: 'w-24', isNum: true },
    { key: 'capInMonth', label: 'In Month MW',   align: 'right', flex: 'w-24', isNum: true },
  ],
  hybrid: [
    { key: 'name',     label: 'Project',     align: 'left',  flex: 'flex-1 min-w-[200px]' },
    { key: 'plantType',label: 'Hybrid Type', align: 'left',  flex: 'min-w-[160px]' },
    { key: 'component',label: 'Component',   align: 'left',  flex: 'w-20' },
    { key: 'total',    label: 'Total',       align: 'right', flex: 'w-20', isNum: true },
    { key: 'applied',  label: 'Applied',     align: 'right', flex: 'w-20', isNum: true },
    { key: 'ftc',      label: 'FTC',         align: 'right', flex: 'w-20', isNum: true },
    { key: 'toc',      label: 'TOC',         align: 'right', flex: 'w-20', isNum: true },
    { key: 'cod',      label: 'COD',         align: 'right', flex: 'w-20', isNum: true },
    { key: 'exp',      label: 'Expected',    align: 'right', flex: 'w-20', isNum: true },
  ],
  transmission: [
    { key: 'name',     label: 'Element',     align: 'left',  flex: 'flex-1 min-w-[220px]' },
    { key: 'agency',   label: 'Agency',      align: 'left',  flex: 'min-w-[140px]' },
    { key: 'plantType',label: 'Type',        align: 'left',  flex: 'w-16' },
    { key: 'voltage',  label: 'kV',          align: 'right', flex: 'w-14', isNum: true },
    { key: 'cap',      label: 'MVA',         align: 'right', flex: 'w-20', isNum: true },
    { key: 'length',   label: 'km',          align: 'right', flex: 'w-20', isNum: true },
    { key: 'pendCap',  label: 'Pend MVA',    align: 'right', flex: 'w-24', isNum: true },
    { key: 'pendLen',  label: 'Pend km',     align: 'right', flex: 'w-24', isNum: true },
    { key: 'pending',  label: 'Pend FTC',    align: 'left',  flex: 'w-16' },
  ],
  // `w` (fixed column width) is set on every activity column so the modal
  // renders with `table-fixed` — otherwise each group's own <table> auto-sizes
  // to its content and the columns don't line up vertically across groups.
  activity: [
    { key: 'name',         label: 'Project',     align: 'left',  flex: 'min-w-[200px]', w: '24%' },
    { key: 'poolingStation', label: 'Pooling Stn', align: 'left', flex: 'min-w-[100px]', w: '13%' },
    { key: 'plantType',    label: 'Plant Type',  align: 'left',  flex: 'min-w-[130px]', w: '15%' },
    { key: 'ftc',          label: 'FTC + Dates', align: 'right', flex: 'min-w-[150px]', w: '16%', isNum: true, isEventStack: 'ftc' },
    { key: 'toc',          label: 'TOC + Dates', align: 'right', flex: 'min-w-[150px]', w: '16%', isNum: true, isEventStack: 'toc' },
    { key: 'cod',          label: 'COD + Dates', align: 'right', flex: 'min-w-[150px]', w: '16%', isNum: true, isEventStack: 'cod' },
  ],
};

const TAB_META = {
  pipeline:     { title: 'FTC Pipeline — Contributors',     subtitle: 'CLEARED projects, grouped per the chosen layout. Region layout mirrors the NR/WR/SR/ER/NER sheets; Source layout mirrors the Source-wise sheet.' },
  contd4:       { title: 'CONTD-4 Study — Contributors',    subtitle: 'Active (Under Process) applications grouped by Region × Source.' },
  hybrid:       { title: 'Hybrid Breakdown — Contributors', subtitle: 'CLEARED hybrid projects, split by their constituent source components.' },
  sourcewise:   { title: 'Source-wise Pipeline — Contributors', subtitle: 'Same CLEARED projects as FTC Pipeline, grouped by Source × Region.' },
  transmission: { title: 'Transmission — Contributors',     subtitle: 'Transmission elements grouped by Region × Element Type.' },
  activity:     { title: 'FTC / TOC / COD Activity — Contributors', subtitle: 'Each row is a project whose FTC / TOC / COD milestone date falls inside the selected range; cells show the in-range MW with dates.' },
};

// Layout modes for the pipeline + sourcewise tabs.
//   region : one section per region, all sources inside, source subtotals.
//   source : one section per source, all regions inside, region subtotals.
//   split  : one section per Region × Source pair (the original behaviour).
const LAYOUTS = [
  { id: 'region', label: 'Region-wise', icon: Rows3,
    hint: 'One table per region with all sources inside — like the NR / WR / SR / ER / NER sheets.' },
  { id: 'source', label: 'Source-wise', icon: Columns3,
    hint: 'One table per source with all regions inside — like the "Source wise" sheet.' },
  { id: 'split',  label: 'Region × Source', icon: LayoutGrid,
    hint: 'Granular split — one section per Region × Source pair.' },
];

// ── Component ────────────────────────────────────────────────────────────────

// `asPage` renders the breakdown inline (no Dialog chrome) for the dedicated
// Source-wise / Region-wise sidebar pages; the default modal behaviour is
// unchanged. When asPage, the view is always active (no open gate).
export function TabBreakdown({ open, onOpenChange, activeTab, projects, txElements, activityFrom, activityTo, asOf = null, asPage = false, titleOverride, subtitleOverride }) {
  const isActive = asPage || open;
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState({});
  // Multi-select source filter — mirrors the Excel's "Source wise" sheet
  // (Wind / Solar / BESS / Hybrid / Coal / Hydro / PSP). Empty set = all
  // sources shown. Only used by the pipeline & sourcewise tabs.
  const [selectedSources, setSelectedSources] = useState(() => new Set());
  // Region filter (NR / WR / SR / ER / NER) — paired with the source filter
  // so the user can drill down both axes simultaneously, e.g. "WR · Solar".
  const [selectedRegions, setSelectedRegions] = useState(() => new Set());

  const tabKey = activeTab === 'sourcewise' ? 'pipeline' : activeTab;
  const meta   = TAB_META[activeTab] ?? TAB_META.pipeline;
  const baseCols = COLUMNS[tabKey === 'sourcewise' ? 'pipeline' : tabKey] ?? COLUMNS.pipeline;
  const supportsSourceFilter = activeTab === 'pipeline' || activeTab === 'sourcewise';
  // Region filter is useful on every tab — all of them group by region.
  const supportsRegionFilter = true;
  // Layout toggle is only meaningful for the pipeline / sourcewise tabs;
  // the other tabs always use their original split layout.
  const supportsLayoutToggle = activeTab === 'pipeline' || activeTab === 'sourcewise';

  // Default layout: pipeline tab → region-wise (mirrors the NR/WR/SR/…
  // sheets); sourcewise tab → source-wise (mirrors the Source-wise sheet);
  // anything else falls back to the split view.
  const defaultLayout = activeTab === 'sourcewise' ? 'source'
    : activeTab === 'pipeline' ? 'region'
    : 'split';
  const [layout, setLayout] = useState(defaultLayout);

  // Re-sync the layout whenever the calling tab changes — opening the modal
  // from the "Source-wise" main tab should always start in source layout.
  useEffect(() => {
    if (isActive) setLayout(defaultLayout);
  }, [isActive, defaultLayout]);

  // Active column list — prepend a Source or Region tag column on the
  // consolidated layouts so each row clearly identifies its bucket.
  const cols = useMemo(() => {
    if (!supportsLayoutToggle || layout === 'split') return baseCols;
    const inject = layout === 'region' ? SOURCE_INLINE_COL : REGION_INLINE_COL;
    // Insert right after the first column (Project name).
    return [baseCols[0], inject, ...baseCols.slice(1)];
  }, [baseCols, layout, supportsLayoutToggle]);

  const groups = useMemo(() => {
    if (!isActive) return [];
    if (activeTab === 'pipeline' || activeTab === 'sourcewise') return buildPipelineGroups(projects, asOf);
    if (activeTab === 'contd4')       return buildContd4Groups(projects);
    if (activeTab === 'hybrid')       return buildHybridGroups(projects, asOf);
    if (activeTab === 'transmission') return buildTransmissionGroups(txElements ?? []);
    if (activeTab === 'activity')     return buildActivityGroups(projects, activityFrom, activityTo);
    return [];
  }, [isActive, activeTab, projects, txElements, activityFrom, activityTo, asOf]);

  // First-stage filter on the original Region × Source split (so the
  // chip/search semantics stay identical regardless of layout). We
  // re-shape this into the consolidated view afterwards.
  const splitFiltered = useMemo(() => {
    let result = groups;
    // Region filter is an AND with the source filter — both must match.
    if (supportsRegionFilter && selectedRegions.size > 0) {
      result = result.filter((g) => selectedRegions.has(g.region));
    }
    if (supportsSourceFilter && selectedSources.size > 0) {
      result = result.filter((g) => selectedSources.has(g.source));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result
        .map(g => ({
          ...g,
          contributors: g.contributors.filter(c =>
            (c.name ?? '').toLowerCase().includes(q)
            || (c.plantType ?? '').toLowerCase().includes(q)
            || (c.poolingStation ?? '').toLowerCase().includes(q)
            || (c.agency ?? '').toLowerCase().includes(q),
          ),
        }))
        .filter(g => g.contributors.length > 0);
    }
    return result;
  }, [groups, search, selectedSources, selectedRegions, supportsSourceFilter, supportsRegionFilter]);

  // Consolidated view: one section per region (or per source) — the
  // sub-clustering by the *other* axis is computed at render time from
  // `clusterContributors` so we can drop a subtotal row between clusters.
  const filtered = useMemo(() => {
    if (!supportsLayoutToggle || layout === 'split') {
      // Original layout: sort by source first if a source filter is active
      // (matches the Excel table-per-source layout).
      if (supportsSourceFilter && selectedSources.size > 0) {
        return [...splitFiltered].sort((a, b) =>
          a.source.localeCompare(b.source) || a.region.localeCompare(b.region),
        );
      }
      return splitFiltered;
    }
    return layout === 'region'
      ? consolidateByRegion(splitFiltered)
      : consolidateBySource(splitFiltered);
  }, [splitFiltered, layout, supportsLayoutToggle, supportsSourceFilter, selectedSources]);

  // Available source values present in the current pipeline data — used to
  // populate the multi-select chips (only sources that actually have
  // contributors).
  const availableSources = useMemo(() => {
    if (!supportsSourceFilter) return [];
    const set = new Set();
    for (const g of groups) set.add(g.source);
    // Stable display order: Wind, Solar, BESS, Hybrid, Coal, Hydro, PSP.
    const ORDER = ['WIND', 'SOLAR', 'BESS', 'HYBRID', 'COAL', 'HYDRO', 'PSP'];
    return Array.from(set).sort((a, b) => {
      const ai = ORDER.indexOf(a); const bi = ORDER.indexOf(b);
      if (ai < 0 && bi < 0) return a.localeCompare(b);
      if (ai < 0) return 1;
      if (bi < 0) return -1;
      return ai - bi;
    });
  }, [groups, supportsSourceFilter]);

  // Available regions (NR / WR / SR / ER / NER). Same pattern as sources.
  const availableRegions = useMemo(() => {
    if (!supportsRegionFilter) return [];
    const set = new Set();
    for (const g of groups) if (g.region) set.add(g.region);
    const ORDER = ['NR', 'WR', 'SR', 'ER', 'NER'];
    return Array.from(set).sort((a, b) => {
      const ai = ORDER.indexOf(a); const bi = ORDER.indexOf(b);
      if (ai < 0 && bi < 0) return a.localeCompare(b);
      if (ai < 0) return 1;
      if (bi < 0) return -1;
      return ai - bi;
    });
  }, [groups, supportsRegionFilter]);

  const toggleSource = (s) => setSelectedSources((prev) => {
    const next = new Set(prev);
    if (next.has(s)) next.delete(s); else next.add(s);
    return next;
  });
  const clearSourceFilter = () => setSelectedSources(new Set());
  const toggleRegion = (r) => setSelectedRegions((prev) => {
    const next = new Set(prev);
    if (next.has(r)) next.delete(r); else next.add(r);
    return next;
  });
  const clearRegionFilter = () => setSelectedRegions(new Set());

  // Each section's accordion key depends on the layout:
  //  split  → "<region>|<source>"  (same key the original UI used)
  //  region → "r:<region>"         (consolidated by region, source-detail inside)
  //  source → "s:<source>"         (consolidated by source, region-detail inside)
  function sectionKey(g) {
    if (!supportsLayoutToggle || layout === 'split') return `${g.region ?? ''}|${g.source ?? ''}`;
    return layout === 'region' ? `r:${g.region}` : `s:${g.source}`;
  }

  // Default: groups read as open via `expanded[key] ?? true`. So the toggle
  // must respect that default — otherwise the first click flips
  // `undefined → true` (the default-open state) and nothing visibly changes.
  function toggle(key) {
    setExpanded(s => ({ ...s, [key]: !(s[key] ?? true) }));
  }

  function expandAll() {
    setExpanded(Object.fromEntries(filtered.map(g => [sectionKey(g), true])));
  }
  // Set every visible group explicitly to false so the `?? true` fallback
  // can't re-open them.
  function collapseAll() {
    setExpanded(Object.fromEntries(filtered.map(g => [sectionKey(g), false])));
  }

  const panel = (
    <>
        <div className="px-5 py-3 border-b bg-slate-50">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                <ListTree className="size-4 text-slate-500" />
                {titleOverride ?? meta.title}
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">{subtitleOverride ?? meta.subtitle}</p>
            </div>
            {!asPage && (
              <button onClick={() => onOpenChange(false)} className="rounded p-1 text-slate-500 hover:text-foreground hover:bg-slate-200 transition-colors" aria-label="Close">
                <X className="size-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 mt-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by project, type, or agency…"
                className="w-full h-8 pl-8 pr-3 text-xs rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
            <button onClick={expandAll}   className="text-[11px] font-semibold text-slate-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-slate-100">Expand all</button>
            <button onClick={collapseAll} className="text-[11px] font-semibold text-slate-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-slate-100">Collapse all</button>

            {/* Export buttons — Excel + PDF, both export whatever's currently
                visible (search + source-filter applied) so the download
                matches the on-screen view exactly. */}
            {(supportsSourceFilter || activeTab === 'activity') && (
              <>
                <button
                  type="button"
                  onClick={() => (activeTab === 'activity'
                    ? downloadActivityExcel(filtered, activityFrom, activityTo)
                    : downloadBreakupExcel(filtered, layout, selectedSources, selectedRegions))}
                  className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded px-1.5 py-1 transition-colors"
                  title={activeTab === 'activity'
                    ? 'Download as Excel — FTC/TOC/COD in-range MW with dates'
                    : `Download as Excel — one sheet per ${layout === 'region' ? 'region' : 'source'}`}
                  aria-label="Download as Excel"
                >
                  <Sheet className="size-4" strokeWidth={2} />
                  <span>XLSX</span>
                </button>
                <button
                  type="button"
                  onClick={() => (activeTab === 'activity'
                    ? downloadActivityPdf(filtered, activityFrom, activityTo)
                    : downloadBreakupPdf(filtered, layout, selectedSources, selectedRegions))}
                  className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded px-1.5 py-1 transition-colors"
                  title={activeTab === 'activity'
                    ? 'Download as PDF — FTC/TOC/COD in-range MW with dates'
                    : `Download as PDF — one page per ${layout === 'region' ? 'region' : 'source'}`}
                  aria-label="Download as PDF"
                >
                  <FileText className="size-4" strokeWidth={2} />
                  <span>PDF</span>
                </button>
              </>
            )}

            <span className="text-[11px] text-muted-foreground tabular-nums">
              {filtered.reduce((s, g) => s + g.contributors.length, 0)} contributors · {filtered.length} groups
            </span>
          </div>

          {/* Layout toggle — pick between the three Excel-style table
              layouts. Hidden in page mode: the dedicated Region-wise /
              Source-wise sidebar pages lock the layout to their own intent,
              so the toggle would be redundant. */}
          {supportsLayoutToggle && !asPage && (
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mr-1">Layout:</span>
              {LAYOUTS.map((l) => {
                const Icon = l.icon;
                const active = layout === l.id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setLayout(l.id)}
                    title={l.hint}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${
                      active
                        ? 'bg-blue-600 text-white border-blue-600 ring-2 ring-blue-200'
                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="size-3" />
                    {l.label}
                  </button>
                );
              })}
              <span className="text-[10px] text-muted-foreground ml-auto">
                {LAYOUTS.find((l) => l.id === layout)?.hint}
              </span>
            </div>
          )}

          {/* Source filter chips — replicates the Excel "Source wise" sheet
              behaviour: click a source to filter, click again to deselect.
              Multi-select supported — pick two and see both Wind + Solar
              sections at once. Hidden for non-pipeline tabs. */}
          {supportsSourceFilter && availableSources.length > 0 && (
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mr-1">Sources:</span>
              {availableSources.map((s) => {
                const active = selectedSources.has(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSource(s)}
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${
                      active
                        ? `${SOURCE_BADGE[s] ?? 'bg-blue-100 text-blue-700 border-blue-200'} ring-2 ring-blue-300`
                        : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
              {selectedSources.size > 0 && (
                <button
                  type="button"
                  onClick={clearSourceFilter}
                  className="text-[10px] font-medium text-slate-500 hover:text-slate-700 px-1"
                >
                  clear
                </button>
              )}
              <span className="text-[10px] text-muted-foreground ml-auto">
                {selectedSources.size === 0
                  ? 'showing all sources'
                  : `showing ${selectedSources.size} of ${availableSources.length}`}
              </span>
            </div>
          )}

          {/* Region multi-select — pairs with the source chips above so the
              user can drill the breakup by both axes. AND-combined: e.g.
              "WR + Solar" shows only WR · Solar groups. */}
          {supportsRegionFilter && availableRegions.length > 0 && (
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mr-1">Regions:</span>
              {availableRegions.map((r) => {
                const active = selectedRegions.has(r);
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => toggleRegion(r)}
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${
                      active
                        ? `${REGION_BADGE[r] ?? 'bg-blue-100 text-blue-700 border-blue-200'} ring-2 ring-blue-300`
                        : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {r}
                  </button>
                );
              })}
              {selectedRegions.size > 0 && (
                <button
                  type="button"
                  onClick={clearRegionFilter}
                  className="text-[10px] font-medium text-slate-500 hover:text-slate-700 px-1"
                >
                  clear
                </button>
              )}
              <span className="text-[10px] text-muted-foreground ml-auto">
                {selectedRegions.size === 0
                  ? 'showing all regions'
                  : `showing ${selectedRegions.size} of ${availableRegions.length}`}
              </span>
            </div>
          )}
        </div>

        <div className="overflow-auto" style={{ maxHeight: asPage ? 'calc(100vh - 220px)' : '70vh' }}>
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No contributors match your search.</div>
          ) : filtered.map((g) => {
            const key = sectionKey(g);
            const isOpen = expanded[key] ?? true;
            // Grand totals for this section header.
            const numCols = cols.filter(c => c.isNum);
            const totals = {};
            for (const c of numCols) {
              totals[c.key] = g.contributors.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
            }
            // Section header config — which chips to render + headline label.
            const consolidated = supportsLayoutToggle && layout !== 'split';
            const headerInnerKey = consolidated ? (layout === 'region' ? 'source' : 'region') : null;
            const clusters = consolidated
              ? clusterContributors(g.contributors, headerInnerKey, numCols)
              : null;
            // "Total NR" style label used by the grand-total row of a
            // consolidated section, and "Total NR Solar" for each subtotal.
            const sectionLabel = consolidated
              ? (layout === 'region' ? g.region : (CONTD4_SOURCE_LABEL[g.source] ?? g.source))
              : null;
            return (
              <div key={key} className="border-b border-slate-200 last:border-b-0">
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  className="w-full flex items-center gap-3 px-4 py-2 bg-slate-50/60 hover:bg-slate-100 transition-colors text-left"
                >
                  <ChevronRight className={`size-3.5 text-slate-500 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  {/* Header badges: split = both chips; region = region only;
                      source = source only. Mirrors the Excel sheet header. */}
                  {(!consolidated || layout === 'region') && g.region && (
                    <Chip label={g.region} cls={REGION_BADGE[g.region]} />
                  )}
                  {(!consolidated || layout === 'source') && g.source && (
                    <Chip label={CONTD4_SOURCE_LABEL[g.source] ?? g.source} cls={SOURCE_BADGE[g.source] ?? 'bg-slate-100 text-slate-700'} />
                  )}
                  {consolidated && clusters && (
                    <span className="text-[10px] text-slate-500">
                      {clusters.length} {layout === 'region' ? 'source' : 'region'}{clusters.length !== 1 ? 's' : ''} · {g.contributors.length} project{g.contributors.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  {!consolidated && (
                    <span className="text-[10px] text-slate-500">{g.contributors.length} project{g.contributors.length !== 1 ? 's' : ''}</span>
                  )}
                  <span className="ml-auto flex items-center gap-3 text-[11px] text-slate-600 tabular-nums">
                    {numCols.slice(0, 4).map(c => (
                      <span key={c.key}><span className="text-slate-400 mr-1">{c.label}:</span><span className="font-semibold">{fmt(totals[c.key])}</span></span>
                    ))}
                  </span>
                </button>

                {isOpen && (
                  <div className="bg-white">
                    <div className="overflow-x-auto">
                      <table className={`w-full text-[11px] ${cols.every((c) => c.w) ? 'table-fixed' : ''}`}>
                        {/* Fixed column widths (when defined) so every group's
                            table lines up vertically instead of auto-sizing to
                            its own content. */}
                        {cols.every((c) => c.w) && (
                          <colgroup>
                            {cols.map((c) => <col key={c.key} style={{ width: c.w }} />)}
                          </colgroup>
                        )}
                        <thead>
                          <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                            {cols.map(c => (
                              <th key={c.key} className={`px-3 py-1.5 font-semibold whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'} ${c.flex}`}>{c.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {consolidated && clusters
                            // ─ Consolidated layouts: emit rows per cluster
                            //   with a "Total <outer> <inner>" subtotal in
                            //   between. Looks like the Excel sheet's
                            //   per-source breaks ("Total NR Solar"). ────────
                            ? clusters.map((cl, idx) => (
                                <Fragment key={cl.key}>
                                  {cl.rows.map((c, i) => (
                                    <Fragment key={c.id ?? `${cl.key}-${i}`}>
                                      <ContribRow c={c} cols={cols} />
                                      {(c.components ?? []).map((sc, si) => (
                                        <ContribRow key={`${c.id}-c${si}`} c={sc} cols={cols} sub />
                                      ))}
                                    </Fragment>
                                  ))}
                                  <tr className="bg-slate-50/80 border-t border-slate-200 font-semibold">
                                    {cols.map((col, i) => (
                                      <td key={col.key} className={`px-3 py-1.5 ${col.align === 'right' ? 'text-right tabular-nums' : 'text-left'} ${col.flex}`}>
                                        {i === 0
                                          ? <span className="text-[10px] uppercase tracking-wide text-slate-500">
                                              Total {sectionLabel} {layout === 'region'
                                                ? (CONTD4_SOURCE_LABEL[cl.key] ?? cl.key)
                                                : cl.key}
                                            </span>
                                          : col.isNum ? <span className="text-slate-800">{fmt(cl.totals[col.key])}</span>
                                          : null}
                                      </td>
                                    ))}
                                  </tr>
                                  {idx < clusters.length - 1 && (
                                    <tr aria-hidden="true"><td colSpan={cols.length} className="p-0 h-1 bg-white" /></tr>
                                  )}
                                </Fragment>
                              ))
                            // ─ Split layout: original flat list of rows ────
                            : g.contributors.map((c, i) => (
                                <Fragment key={c.id ?? i}>
                                  <ContribRow c={c} cols={cols} />
                                  {(c.components ?? []).map((sc, si) => (
                                    <ContribRow key={`${c.id}-c${si}`} c={sc} cols={cols} sub />
                                  ))}
                                </Fragment>
                              ))}
                          {numCols.length > 0 && (
                            <tr className="bg-blue-50 border-t-2 border-blue-200 font-bold">
                              {cols.map((col, i) => (
                                <td key={col.key} className={`px-3 py-1.5 ${col.align === 'right' ? 'text-right tabular-nums' : 'text-left'} ${col.flex}`}>
                                  {i === 0
                                    ? <span className="text-[10px] uppercase tracking-wide text-blue-700">
                                        {consolidated ? `Total ${sectionLabel}` : 'Group total'}
                                      </span>
                                    : col.isNum ? <span className="text-blue-900">{fmt(totals[col.key])}</span>
                                    : null}
                                </td>
                              ))}
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
    </>
  );

  // Page mode: render inline (used by the Source-wise / Region-wise sidebar
  // pages). Modal mode: wrap in the Dialog chrome (the existing behaviour).
  if (asPage) {
    return (
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden flex flex-col min-h-0 flex-1">
        {panel}
      </div>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Fluid width — 95% of the viewport so the wide pipeline table fits
          without horizontal scrolling on standard laptop screens. */}
      <DialogContent className="!max-w-[95vw] w-[95vw] p-0 overflow-hidden" showClose={false}>
        {/* sr-only title satisfies the Dialog a11y requirement; the visible
            heading is rendered inside `panel`. */}
        <DialogTitle className="sr-only">{meta.title}</DialogTitle>
        {panel}
      </DialogContent>
    </Dialog>
  );
}
