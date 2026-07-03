import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx-js-style';
import { prisma } from '@/lib/prisma';
import { requireServerUser, buildRegionScope } from '@/lib/server-auth';
import {
  n, REGION_ORDER, SOURCE_ORDER, getProjectSource, isInFtcPipeline,
  computePipelineMatrix, buildPipelineRows,
  computeContd4Study, computeTransmission,
  computeHybridBreakdown, computeMonthlyCod,
  buildCodMonths, aggregateProjectForExport, isProjectCommissioned,
} from '@/lib/grid-computations';

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtNum(v) {
  if (v == null || v === 0) return 0;
  const n = Number(v);
  return Math.round(n * 100) / 100; // preserve up to 2 decimal places
}

function fmtMonth(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m) - 1]}'${y.slice(2)}`;
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Navy styling theme ────────────────────────────────────────────────────────
// Shared palette so every sheet matches the clean print / PDF summary view
// (image 1): navy header/title bars with white text, slate subtotal rows,
// navy grand-total rows, white/striped data rows, slate-300 borders.
const NAVY = '1E3A5F';
const X_BORDER  = { style: 'thin', color: { rgb: 'CBD5E1' } };
const X_BORDERS = { top: X_BORDER, bottom: X_BORDER, left: X_BORDER, right: X_BORDER };
const XF = 'Arial';
const xTitle  = ()      => ({ font: { name: XF, sz: 12, bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: NAVY } },     alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: X_BORDERS });
const xHeader = ()      => ({ font: { name: XF, sz: 10, bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: NAVY } },     alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: X_BORDERS });
const xData   = (n, s)  => ({ font: { name: XF, sz: 10, color: { rgb: '1A1A2E' } },            fill: { fgColor: { rgb: s ? 'F1F5F9' : 'FFFFFF' } }, alignment: { horizontal: n ? 'right' : 'left', vertical: 'center', wrapText: true }, border: X_BORDERS });
const xSub    = (n)     => ({ font: { name: XF, sz: 10, bold: true, color: { rgb: '1A1A2E' } }, fill: { fgColor: { rgb: 'E2E8F0' } },  alignment: { horizontal: n ? 'right' : 'left', vertical: 'center', wrapText: true }, border: X_BORDERS });
const xTotal  = (n)     => ({ font: { name: XF, sz: 10, bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: NAVY } },      alignment: { horizontal: n ? 'right' : 'left', vertical: 'center', wrapText: true }, border: X_BORDERS });

// Row-role accumulator: builders push (role, cells) pairs, then finalize()
// turns them into a fully-styled worksheet.
//   role ∈ 'title' | 'header' | 'data' | 'subtotal' | 'total' | 'spacer'
function acc() { return { data: [], roles: [] }; }
function row(a, role, cells) { a.data.push(cells); a.roles.push(role); }

// Build the styled worksheet from an accumulator.
//   opts.numFrom    — first column index treated as numeric (right-aligned)
//   opts.mergeCol   — column to vertically merge across runs of equal value in
//                     consecutive data rows (the "merged region/source" look)
//   opts.cols       — column widths (wch)
//   opts.titleCols  — explicit last column for title merges (defaults to full width)
function finalize(a, opts = {}) {
  const { data, roles } = a;
  const ws = XLSX.utils.aoa_to_sheet(data);
  const ref = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  const lastCol = ref.e.c;
  const numFrom = opts.numFrom ?? 2;
  const merges = [];
  let stripe = false;

  for (let R = 0; R <= ref.e.r; R++) {
    const role = roles[R] ?? 'data';
    if (role === 'spacer') { stripe = false; continue; }
    if (role !== 'data') stripe = false;
    for (let C = 0; C <= lastCol; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };
      const isNum = C >= numFrom;
      ws[addr].s =
        role === 'title'    ? xTitle()
      : role === 'header'   ? xHeader()
      : role === 'subtotal' ? xSub(isNum)
      : role === 'total'    ? xTotal(isNum)
      :                       xData(isNum, stripe);
    }
    if (role === 'title') merges.push({ s: { r: R, c: 0 }, e: { r: R, c: opts.titleCols ?? lastCol } });
    if (role === 'data') stripe = !stripe;
  }

  // Vertically merge the group column across consecutive data rows sharing the
  // same value (Region in region-wise tables, Source in source-wise, etc.).
  if (opts.mergeCol != null) {
    const mc = opts.mergeCol;
    let runStart = -1, runVal = null;
    const flush = (endRow) => {
      if (runStart >= 0 && endRow > runStart) {
        merges.push({ s: { r: runStart, c: mc }, e: { r: endRow, c: mc } });
        // Blank the absorbed cells so only the merged value shows.
        for (let R = runStart + 1; R <= endRow; R++) {
          const addr = XLSX.utils.encode_cell({ r: R, c: mc });
          if (ws[addr]) ws[addr].v = '';
        }
      }
      runStart = -1; runVal = null;
    };
    for (let R = 0; R <= ref.e.r; R++) {
      if (roles[R] === 'data') {
        const addr = XLSX.utils.encode_cell({ r: R, c: mc });
        const v = ws[addr] ? ws[addr].v : '';
        if (v === runVal && runStart >= 0) continue;
        flush(R - 1);
        runStart = R; runVal = v;
      } else {
        flush(R - 1);
      }
    }
    flush(ref.e.r);
    // Centre the merged group column vertically.
    for (const m of merges) {
      if (m.s.c === mc && m.e.r > m.s.r) {
        const addr = XLSX.utils.encode_cell({ r: m.s.r, c: mc });
        if (ws[addr]?.s) ws[addr].s.alignment = { ...ws[addr].s.alignment, vertical: 'center', horizontal: 'center' };
      }
    }
  }

  ws['!merges'] = merges;
  if (opts.cols) ws['!cols'] = opts.cols.map(w => ({ wch: w }));
  return ws;
}

// ── Sheet builders ────────────────────────────────────────────────────────────

function buildPipelineSheet(rows, title, primaryKey) {
  const isRegionPrimary = primaryKey === 'region';
  const col1  = isRegionPrimary ? 'Region' : 'Source (Type)';
  const col2  = isRegionPrimary ? 'Source (Type)' : 'Region';

  const a = acc();
  row(a, 'title',  [title]);
  row(a, 'header', [
    col1, col2,
    'Total Installed Capacity (MW)',
    'Total Capacity (MW) (For which CONTD4 issued)',
    'Capacity applied for FTC',
    'FTC approved', 'FTC Pending', 'TOC Issued', 'TOC Pending',
    'COD Completed', 'COD Pending',
    'Expected Capacity (MW) to be commissioned',
  ]);

  for (const r of rows) {
    const primary   = isRegionPrimary ? r.region : r.source;
    const secondary = isRegionPrimary ? r.source : r.region;
    const label1 = r.isTotal ? 'All India' : r.isSubtotal ? `${primary} Total` : primary;
    const label2 = r.isTotal || r.isSubtotal ? '' : secondary;
    const role   = r.isTotal ? 'total' : r.isSubtotal ? 'subtotal' : 'data';
    row(a, role, [
      label1, label2,
      fmtNum(r.totalCapacityMw), fmtNum(r.contd4CapacityMw), fmtNum(r.appliedMw),
      fmtNum(r.ftcApprovedMw), fmtNum(r.ftcPendingMw), fmtNum(r.tocIssuedMw),
      fmtNum(r.tocPendingMw), fmtNum(r.codCompletedMw), fmtNum(r.codPendingMw), fmtNum(r.expectedMw),
    ]);
  }

  return finalize(a, { numFrom: 2, mergeCol: 0, cols: [18, 14, 20, 26, 22, 14, 14, 14, 14, 16, 14, 28] });
}

function buildContd4Sheet(contd4Study) {
  const { rows, allMonths } = contd4Study;

  const a = acc();
  row(a, 'title',  ['Total Capacity Under CONTD-4 Study (MW)']);
  row(a, 'header', ['Region', 'Source (Type)', 'Total Capacity (MW)', ...allMonths.map(fmtMonth)]);

  for (const r of rows) {
    const label1 = r.isTotal ? 'All India' : r.isSubtotal ? `${r.region} Total` : r.region;
    const label2 = r.isTotal || r.isSubtotal ? '' : r.source;
    const role   = r.isTotal ? 'total' : r.isSubtotal ? 'subtotal' : 'data';
    row(a, role, [label1, label2, fmtNum(r.totalMw), ...allMonths.map(m => fmtNum(r.months?.[m] ?? 0))]);
  }

  return finalize(a, { numFrom: 2, mergeCol: 0, cols: [18, 14, 20, ...allMonths.map(() => 14)] });
}

function buildTransmissionSheet(txRows) {
  const a = acc();
  row(a, 'title',  ['Transmission Elements Under Process of FTC']);
  row(a, 'header', ['Region', 'Element Type', 'FTC Done (No.)', 'FTC Done (MVA/ckt km)', 'FTC Pending (No.)', 'FTC Pending (MVA/ckt km)']);

  const CAT_LABELS = {
    LINE_RE: 'Transmission Line (RE Pocket)',
    LINE_NONRE: 'Transmission Line (Non-RE Pocket)',
    ICT_RE: 'ICT (RE Pocket)',
    ICT_NONRE: 'ICT (Non-RE Pocket)',
    GT: 'GT', ST: 'ST',
  };

  for (const r of txRows) {
    const isLine = r.category.startsWith('LINE');
    row(a, 'data', [
      r.region,
      CAT_LABELS[r.category] ?? r.category,
      r.completedCount || 0,
      fmtNum(isLine ? r.completedKm : r.completedMva),
      r.pendingCount || 0,
      fmtNum(isLine ? r.pendingKm : r.pendingMva),
    ]);
  }

  return finalize(a, { numFrom: 2, mergeCol: 0, cols: [10, 32, 16, 22, 18, 24] });
}

function buildHybridSheet(hybridRows) {
  const a = acc();
  row(a, 'title',  ['Source-wise Segregation of Hybrid Capacity']);
  row(a, 'header', ['Region', 'Hybrid Type', 'Source Component', 'Total (MW)', 'Applied (MW)', 'FTC (MW)', 'TOC (MW)', 'COD (MW)', 'Expected (MW)']);

  for (const r of hybridRows) {
    row(a, 'data', [
      r.region, r.hybridType, r.sourceType,
      fmtNum(r.totalMw), fmtNum(r.appliedMw), fmtNum(r.ftcMw),
      fmtNum(r.tocMw), fmtNum(r.codMw), fmtNum(r.expectedMw),
    ]);
  }

  // Hybrid Type also repeats per region run — merge both Region (0) and the
  // Hybrid Type (1) is left un-merged to avoid spanning across regions.
  return finalize(a, { numFrom: 3, mergeCol: 0, cols: [10, 36, 18, 14, 14, 14, 14, 14, 14] });
}

function buildMonthlyCodSheet(monthlyCod) {
  const { rows, months } = monthlyCod;

  const a = acc();
  row(a, 'title',  ['Monthly COD — Capacity Commissioned (MW)']);
  row(a, 'header', ['Source (Type)', ...REGION_ORDER, 'All India']);

  for (const month of months) {
    row(a, 'title', [`— ${fmtMonth(month)} —`]);   // navy band per month
    for (const r of rows) {
      const allIndia = REGION_ORDER.reduce((s, rg) => s + (r.byRegion?.[rg]?.[month] ?? 0), 0);
      if (allIndia === 0 && !r.isTotal) continue;
      row(a, r.isTotal ? 'total' : 'data', [
        r.source,
        ...REGION_ORDER.map(rg => fmtNum(r.byRegion?.[rg]?.[month] ?? 0)),
        fmtNum(allIndia),
      ]);
    }
    row(a, 'spacer', []);
  }

  return finalize(a, { numFrom: 1, cols: [14, ...REGION_ORDER.map(() => 12), 14] });
}

// Per-source detail sheet (one per source type, matching PDF section format)
function buildSourceDetailSheet(source, projects, asOf) {
  const sourceProjects = projects
    .filter(p => {
      if (!isInFtcPipeline(p)) return false;
      return getProjectSource(p) === source;
    })
    .sort((a, b) => REGION_ORDER.indexOf(a.region.code) - REGION_ORDER.indexOf(b.region.code));

  const a = acc();
  row(a, 'title',  [`${source} Generation Capacity Details Under FTC/TOC/COD`]);
  row(a, 'header', [
    'Sr. No', 'Generating Station', 'Pooling Station',
    'Plant Type', 'Region',
    'Total Capacity (MW)',
    'Total Capacity (MW) (For which CONTD4 issued)',
    'Capacity (MW) applied for FTC',
    'FTC Approved Capacity (MW)',
    'TOC Issued Capacity (MW)',
    'COD declared Capacity (MW)',
    'Capacity (MW) commissioning expected',
  ]);

  let srNo   = 1;
  let currentRegion = null;
  const regionTotals = {};

  for (const proj of sourceProjects) {
    const agg = aggregateProjectForExport(proj, asOf);
    if (agg.region !== currentRegion) {
      currentRegion = agg.region;
      if (!regionTotals[currentRegion]) {
        regionTotals[currentRegion] = {
          total: 0, contd4: 0, applied: 0, ftcApproved: 0,
          tocIssued: 0, codDeclared: 0, expected: 0,
        };
      }
    }

    regionTotals[currentRegion].total      += agg.totalCapacityMw;
    regionTotals[currentRegion].contd4     += agg.contd4CapacityMw;
    regionTotals[currentRegion].applied    += agg.applied;
    regionTotals[currentRegion].ftcApproved+= agg.ftcApproved;
    regionTotals[currentRegion].tocIssued  += agg.tocIssued;
    regionTotals[currentRegion].codDeclared+= agg.codDeclared;
    regionTotals[currentRegion].expected   += agg.expected;

    row(a, 'data', [
      srNo++, agg.name, agg.poolingStation, agg.plantTypeLabel, agg.region,
      fmtNum(agg.totalCapacityMw), fmtNum(agg.contd4CapacityMw), fmtNum(agg.applied),
      fmtNum(agg.ftcApproved), fmtNum(agg.tocIssued), fmtNum(agg.codDeclared), fmtNum(agg.expected),
    ]);
  }

  // Region subtotals
  row(a, 'spacer', []);
  for (const [region, t] of Object.entries(regionTotals)) {
    row(a, 'subtotal', [
      '', `Total ${region} ${source}`, '', '', '',
      fmtNum(t.total), fmtNum(t.contd4), fmtNum(t.applied),
      fmtNum(t.ftcApproved), fmtNum(t.tocIssued), fmtNum(t.codDeclared), fmtNum(t.expected),
    ]);
  }

  // All India total
  const allIndia = Object.values(regionTotals).reduce((acc2, t) => {
    for (const k of Object.keys(acc2)) acc2[k] += t[k] ?? 0;
    return acc2;
  }, { total: 0, contd4: 0, applied: 0, ftcApproved: 0, tocIssued: 0, codDeclared: 0, expected: 0 });

  row(a, 'total', [
    '', `All India ${source}`, '', '', '',
    fmtNum(allIndia.total), fmtNum(allIndia.contd4), fmtNum(allIndia.applied),
    fmtNum(allIndia.ftcApproved), fmtNum(allIndia.tocIssued), fmtNum(allIndia.codDeclared), fmtNum(allIndia.expected),
  ]);

  // Merge the Region column (idx 4) across each region's run of projects.
  return finalize(a, { numFrom: 5, mergeCol: 4, cols: [8, 46, 22, 28, 8, 18, 28, 22, 22, 20, 22, 26] });
}

// Combined Summary sheet (mirrors the Excel Summary tab exactly)
function buildSummarySheet(table2Rows, table5Rows, contd4Study, dateLabel) {
  const a = acc();
  const PIPE_HEADER = (primary) => [
    primary, primary === 'Region' ? 'Source (Type)' : 'Region',
    'Total Installed\nCapacity (MW)',
    'Total Capacity (MW)\n(For which CONTD4 issued)',
    'Capacity applied\nfor FTC',
    'FTC Approved', 'FTC Pending', 'TOC Issued', 'TOC Pending',
    'COD Completed', 'COD Pending',
    'Expected Capacity\n(MW) to be commissioned',
  ];

  row(a, 'title', [`Summary of Generation Capacity Under FTC / TOC / COD (as on ${dateLabel})`]);
  row(a, 'spacer', []);

  // ── Table 2: Region-wise ──────────────────────────────────────────────────
  row(a, 'title',  ['Total Generation Capacity Details Under FTC / TOC / COD (MW) — Region-wise']);
  row(a, 'header', PIPE_HEADER('Region'));
  for (const r of table2Rows) {
    const label1 = r.isTotal ? 'All India' : r.isSubtotal ? `${r.region} Total` : r.region;
    const label2 = r.isTotal || r.isSubtotal ? '' : r.source;
    row(a, r.isTotal ? 'total' : r.isSubtotal ? 'subtotal' : 'data', [
      label1, label2,
      fmtNum(r.totalCapacityMw), fmtNum(r.contd4CapacityMw), fmtNum(r.appliedMw),
      fmtNum(r.ftcApprovedMw), fmtNum(r.ftcPendingMw), fmtNum(r.tocIssuedMw),
      fmtNum(r.tocPendingMw), fmtNum(r.codCompletedMw), fmtNum(r.codPendingMw), fmtNum(r.expectedMw),
    ]);
  }
  row(a, 'spacer', []);

  // ── Table 5: Source-wise ──────────────────────────────────────────────────
  row(a, 'title',  ['Total Generation Capacity Details Under FTC / TOC / COD (MW) — Source-wise']);
  row(a, 'header', PIPE_HEADER('Source (Type)'));
  for (const r of table5Rows) {
    const label1 = r.isTotal ? 'All India' : r.isSubtotal ? `${r.source} Total` : r.source;
    const label2 = r.isTotal || r.isSubtotal ? '' : r.region;
    row(a, r.isTotal ? 'total' : r.isSubtotal ? 'subtotal' : 'data', [
      label1, label2,
      fmtNum(r.totalCapacityMw), fmtNum(r.contd4CapacityMw), fmtNum(r.appliedMw),
      fmtNum(r.ftcApprovedMw), fmtNum(r.ftcPendingMw), fmtNum(r.tocIssuedMw),
      fmtNum(r.tocPendingMw), fmtNum(r.codCompletedMw), fmtNum(r.codPendingMw), fmtNum(r.expectedMw),
    ]);
  }
  row(a, 'spacer', []);

  // ── Table 1: CONTD-4 Study ────────────────────────────────────────────────
  const { rows: c4Rows, allMonths } = contd4Study;
  row(a, 'title',  ['Total Capacity Under CONTD-4 Study (MW)']);
  row(a, 'header', ['Region', 'Source (Type)', 'Total Capacity (MW)', ...allMonths.map(fmtMonth)]);
  for (const r of c4Rows) {
    const label1 = r.isTotal ? 'All India' : r.isSubtotal ? `${r.region} Total` : r.region;
    const label2 = r.isTotal || r.isSubtotal ? '' : r.source;
    row(a, r.isTotal ? 'total' : r.isSubtotal ? 'subtotal' : 'data',
      [label1, label2, fmtNum(r.totalMw), ...allMonths.map(m => fmtNum(r.months?.[m] ?? 0))]);
  }

  return finalize(a, { numFrom: 2, mergeCol: 0, cols: [18, 14, 18, 26, 20, 13, 13, 13, 13, 14, 13, 28] });
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request) {
  let user;
  try { user = await requireServerUser(); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  const { searchParams } = new URL(request.url);
  const asOfStr   = searchParams.get('asOf')   ?? null;
  const fromMonth = searchParams.get('from')   ?? null;
  const toMonth   = searchParams.get('to')     ?? null;
  const asOf      = asOfStr ? new Date(asOfStr) : null;
  const excludeCommissioned = searchParams.get('excludeCommissioned') === '1';

  const scope = await buildRegionScope(user.role);

  const [projects, txElements] = await Promise.all([
    prisma.generationProject.findMany({
      where: scope,
      include: {
        region: true, plantType: true, contd4: true,
        phases: true, poolingStation: true,
      },
    }),
    prisma.transmissionElement.findMany({
      where: scope,
      include: { region: true },
    }),
  ]);

  // Build computations
  // "Exclude Commissioned" narrows only the FTC pipeline sheets (matching the
  // dashboard + PDF); other sheets keep the full set.
  const pipelineProjects = excludeCommissioned
    ? projects.filter((p) => !isProjectCommissioned(p))
    : projects;
  const pipelineMatrix   = computePipelineMatrix(pipelineProjects, asOf);
  const table2Rows       = buildPipelineRows(pipelineMatrix, 'region', 'source');
  const table5Rows       = buildPipelineRows(pipelineMatrix, 'source', 'region');
  const contd4Study      = computeContd4Study(projects);
  const txRows           = computeTransmission(txElements);
  const hybridRows       = computeHybridBreakdown(projects, asOf);
  const monthlyCod       = computeMonthlyCod(projects, fromMonth, toMonth);

  const dateLabel  = asOfStr
    ? new Date(asOfStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  // Build workbook
  const wb = XLSX.utils.book_new();

  // Summary sheet (combined, mirrors Excel Summary tab)
  XLSX.utils.book_append_sheet(
    wb,
    buildSummarySheet(table2Rows, table5Rows, contd4Study, dateLabel),
    'Summary',
  );

  XLSX.utils.book_append_sheet(
    wb,
    buildPipelineSheet(table2Rows, `Total Generation Capacity Details Under FTC/TOC/COD (MW) as on ${dateLabel} (Region-wise)`, 'region'),
    'Region-wise',
  );

  XLSX.utils.book_append_sheet(
    wb,
    buildPipelineSheet(table5Rows, `Total Generation Capacity Details Under FTC/TOC/COD (MW) as on ${dateLabel} (Source-wise)`, 'source'),
    'Source-wise',
  );

  // Per-source detail sheets
  for (const source of SOURCE_ORDER) {
    const hasData = projects.some(p =>
      isInFtcPipeline(p) && getProjectSource(p) === source
    );
    if (!hasData) continue;
    const sheetName = source.charAt(0) + source.slice(1).toLowerCase(); // Wind, Solar, etc.
    XLSX.utils.book_append_sheet(wb, buildSourceDetailSheet(source, projects, asOf), sheetName);
  }

  XLSX.utils.book_append_sheet(wb, buildContd4Sheet(contd4Study), 'CONTD-4 Study');
  XLSX.utils.book_append_sheet(wb, buildHybridSheet(hybridRows), 'Hybrid Breakdown');
  XLSX.utils.book_append_sheet(wb, buildTransmissionSheet(txRows), 'Transmission');
  XLSX.utils.book_append_sheet(wb, buildMonthlyCodSheet(monthlyCod), 'Monthly COD');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const filename = `FTC_Summary_${dateLabel.replace(/ /g, '_')}.xlsx`;

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
