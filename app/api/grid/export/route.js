import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { prisma } from '@/lib/prisma';
import { requireServerUser, buildRegionScope } from '@/lib/server-auth';
import {
  n, REGION_ORDER, SOURCE_ORDER, getProjectSource,
  computePipelineMatrix, buildPipelineRows,
  computeContd4Study, computeTransmission,
  computeHybridBreakdown, computeMonthlyCod,
  buildCodMonths, aggregateProjectForExport,
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

// Set column widths on a sheet
function setCols(ws, widths) {
  ws['!cols'] = widths.map(w => ({ wch: w }));
}

// ── Sheet builders ────────────────────────────────────────────────────────────

function buildPipelineSheet(rows, title, primaryKey) {
  const isRegionPrimary = primaryKey === 'region';
  const col1  = isRegionPrimary ? 'Region' : 'Source (Type)';
  const col2  = isRegionPrimary ? 'Source (Type)' : 'Region';

  const data = [
    [title],
    [
      col1, col2,
      'Total Installed Capacity (MW)',
      'Total Capacity (MW) (For which CONTD4 issued)',
      'Capacity applied for FTC',
      'FTC approved',
      'FTC Pending',
      'TOC Issued',
      'TOC Pending',
      'COD Completed',
      'COD Pending',
      'Expected Capacity (MW) to be commissioned',
    ],
  ];

  for (const row of rows) {
    const primary   = isRegionPrimary ? row.region : row.source;
    const secondary = isRegionPrimary ? row.source : row.region;
    const label1 = row.isTotal ? 'All India' : row.isSubtotal ? `${primary} Total` : primary;
    const label2 = row.isTotal || row.isSubtotal ? '' : secondary;

    data.push([
      label1, label2,
      fmtNum(row.totalCapacityMw),
      fmtNum(row.contd4CapacityMw),
      fmtNum(row.appliedMw),
      fmtNum(row.ftcApprovedMw),
      fmtNum(row.ftcPendingMw),
      fmtNum(row.tocIssuedMw),
      fmtNum(row.tocPendingMw),
      fmtNum(row.codCompletedMw),
      fmtNum(row.codPendingMw),
      fmtNum(row.expectedMw),
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 11 } }];
  setCols(ws, [18, 14, 20, 26, 22, 14, 14, 14, 14, 16, 14, 28]);
  return ws;
}

function buildContd4Sheet(contd4Study) {
  const { rows, allMonths } = contd4Study;

  const headers = [
    'Region', 'Source (Type)',
    'Total Capacity (MW)',
    ...allMonths.map(fmtMonth),
  ];

  const data = [
    ['Total Capacity Under CONTD-4 Study (MW)'],
    headers,
  ];

  for (const row of rows) {
    const label1 = row.isTotal ? 'All India' : row.isSubtotal ? `${row.region} Total` : row.region;
    const label2 = row.isTotal || row.isSubtotal ? '' : row.source;
    data.push([
      label1, label2,
      fmtNum(row.totalMw),
      ...allMonths.map(m => fmtNum(row.months?.[m] ?? 0)),
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];
  setCols(ws, [18, 14, 20, ...allMonths.map(() => 14)]);
  return ws;
}

function buildTransmissionSheet(txRows) {
  const data = [
    ['Transmission Elements Under Process of FTC'],
    ['Region', 'Element Type', 'FTC Done (No.)', 'FTC Done (MVA/ckt km)', 'FTC Pending (No.)', 'FTC Pending (MVA/ckt km)'],
  ];

  const CAT_LABELS = {
    LINE_RE: 'Transmission Line (RE Pocket)',
    LINE_NONRE: 'Transmission Line (Non-RE Pocket)',
    ICT_RE: 'ICT (RE Pocket)',
    ICT_NONRE: 'ICT (Non-RE Pocket)',
    GT: 'GT', ST: 'ST',
  };

  for (const row of txRows) {
    const isLine = row.category.startsWith('LINE');
    data.push([
      row.region,
      CAT_LABELS[row.category] ?? row.category,
      row.completedCount || 0,
      fmtNum(isLine ? row.completedKm : row.completedMva),
      row.pendingCount || 0,
      fmtNum(isLine ? row.pendingKm : row.pendingMva),
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
  setCols(ws, [10, 32, 16, 22, 18, 24]);
  return ws;
}

function buildHybridSheet(hybridRows) {
  const data = [
    ['Source-wise Segregation of Hybrid Capacity'],
    ['Region', 'Hybrid Type', 'Source Component', 'Total (MW)', 'Applied (MW)', 'FTC (MW)', 'TOC (MW)', 'COD (MW)', 'Expected (MW)'],
  ];

  for (const row of hybridRows) {
    data.push([
      row.region,
      row.hybridType,
      row.sourceType,
      fmtNum(row.totalMw),
      fmtNum(row.appliedMw),
      fmtNum(row.ftcMw),
      fmtNum(row.tocMw),
      fmtNum(row.codMw),
      fmtNum(row.expectedMw),
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }];
  setCols(ws, [10, 36, 18, 14, 14, 14, 14, 14, 14]);
  return ws;
}

function buildMonthlyCodSheet(monthlyCod) {
  const { rows, months } = monthlyCod;

  const data = [
    ['Monthly COD — Capacity Commissioned (MW)'],
    ['Source (Type)', ...REGION_ORDER, 'All India'],
  ];

  for (const month of months) {
    data.push([`— ${fmtMonth(month)} —`]);
    for (const row of rows) {
      const allIndia = REGION_ORDER.reduce((s, r) => s + (row.byRegion?.[r]?.[month] ?? 0), 0);
      if (allIndia === 0 && !row.isTotal) continue;
      data.push([
        row.source,
        ...REGION_ORDER.map(r => fmtNum(row.byRegion?.[r]?.[month] ?? 0)),
        fmtNum(allIndia),
      ]);
    }
    data.push([]); // blank separator
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  setCols(ws, [14, ...REGION_ORDER.map(() => 12), 14]);
  return ws;
}

// Per-source detail sheet (one per source type, matching PDF section format)
function buildSourceDetailSheet(source, projects, asOf) {
  const sourceProjects = projects
    .filter(p => {
      if (p.contd4?.status !== 'CLEARED') return false;
      return getProjectSource(p) === source;
    })
    .sort((a, b) => REGION_ORDER.indexOf(a.region.code) - REGION_ORDER.indexOf(b.region.code));

  const data = [
    [`${source} Generation Capacity Details Under FTC/TOC/COD`],
    [
      'Sr. No', 'Generating Station', 'Pooling Station',
      'Plant Type', 'Region',
      'Total Capacity (MW)',
      'Total Capacity (MW) (For which CONTD4 issued)',
      'Capacity (MW) applied for FTC',
      'FTC Approved Capacity (MW)',
      'TOC Issued Capacity (MW)',
      'COD declared Capacity (MW)',
      'Capacity (MW) commissioning expected',
    ],
  ];

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

    data.push([
      srNo++,
      agg.name,
      agg.poolingStation,
      agg.plantTypeLabel,
      agg.region,
      fmtNum(agg.totalCapacityMw),
      fmtNum(agg.contd4CapacityMw),
      fmtNum(agg.applied),
      fmtNum(agg.ftcApproved),
      fmtNum(agg.tocIssued),
      fmtNum(agg.codDeclared),
      fmtNum(agg.expected),
    ]);
  }

  // Region subtotals
  data.push([]); // blank
  for (const [region, t] of Object.entries(regionTotals)) {
    data.push([
      '', `Total ${region} ${source}`, '', '', '',
      fmtNum(t.total), fmtNum(t.contd4), fmtNum(t.applied),
      fmtNum(t.ftcApproved), fmtNum(t.tocIssued), fmtNum(t.codDeclared), fmtNum(t.expected),
    ]);
  }

  // All India total
  const allIndia = Object.values(regionTotals).reduce((acc, t) => {
    for (const k of Object.keys(acc)) acc[k] += t[k] ?? 0;
    return acc;
  }, { total: 0, contd4: 0, applied: 0, ftcApproved: 0, tocIssued: 0, codDeclared: 0, expected: 0 });

  data.push([
    '', `All India ${source}`, '', '', '',
    fmtNum(allIndia.total), fmtNum(allIndia.contd4), fmtNum(allIndia.applied),
    fmtNum(allIndia.ftcApproved), fmtNum(allIndia.tocIssued), fmtNum(allIndia.codDeclared), fmtNum(allIndia.expected),
  ]);

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 11 } }];
  setCols(ws, [8, 46, 22, 28, 8, 18, 28, 22, 22, 20, 22, 26]);
  return ws;
}

// Combined Summary sheet (mirrors the Excel Summary tab exactly)
function buildSummarySheet(table2Rows, table5Rows, contd4Study, dateLabel) {
  const data = [];
  const merges = [];
  let r = 0;

  const H1 = `Summary of Generation Capacity Under FTC / TOC / COD (as on ${dateLabel})`;

  // ── Title ─────────────────────────────────────────────────────────────────
  data.push([H1]);
  merges.push({ s: { r, c: 0 }, e: { r, c: 11 } });
  r++;

  data.push([]);
  r++;

  // ── Table 2: Region-wise ──────────────────────────────────────────────────
  data.push(['Total Generation Capacity Details Under FTC / TOC / COD (MW) — Region-wise']);
  merges.push({ s: { r, c: 0 }, e: { r, c: 11 } });
  r++;

  data.push([
    'Region', 'Source (Type)',
    'Total Installed\nCapacity (MW)',
    'Total Capacity (MW)\n(For which CONTD4 issued)',
    'Capacity applied\nfor FTC',
    'FTC Approved',
    'FTC Pending',
    'TOC Issued',
    'TOC Pending',
    'COD Completed',
    'COD Pending',
    'Expected Capacity\n(MW) to be commissioned',
  ]);
  r++;

  for (const row of table2Rows) {
    const primary   = row.region;
    const secondary = row.source;
    const label1 = row.isTotal ? 'All India' : row.isSubtotal ? `${primary} Total` : primary;
    const label2 = row.isTotal || row.isSubtotal ? '' : secondary;
    data.push([
      label1, label2,
      fmtNum(row.totalCapacityMw), fmtNum(row.contd4CapacityMw),
      fmtNum(row.appliedMw), fmtNum(row.ftcApprovedMw), fmtNum(row.ftcPendingMw),
      fmtNum(row.tocIssuedMw), fmtNum(row.tocPendingMw),
      fmtNum(row.codCompletedMw), fmtNum(row.codPendingMw), fmtNum(row.expectedMw),
    ]);
    r++;
  }

  data.push([]);
  r++;

  // ── Table 5: Source-wise ──────────────────────────────────────────────────
  data.push(['Total Generation Capacity Details Under FTC / TOC / COD (MW) — Source-wise']);
  merges.push({ s: { r, c: 0 }, e: { r, c: 11 } });
  r++;

  data.push([
    'Source (Type)', 'Region',
    'Total Installed\nCapacity (MW)',
    'Total Capacity (MW)\n(For which CONTD4 issued)',
    'Capacity applied\nfor FTC',
    'FTC Approved',
    'FTC Pending',
    'TOC Issued',
    'TOC Pending',
    'COD Completed',
    'COD Pending',
    'Expected Capacity\n(MW) to be commissioned',
  ]);
  r++;

  for (const row of table5Rows) {
    const primary   = row.source;
    const secondary = row.region;
    const label1 = row.isTotal ? 'All India' : row.isSubtotal ? `${primary} Total` : primary;
    const label2 = row.isTotal || row.isSubtotal ? '' : secondary;
    data.push([
      label1, label2,
      fmtNum(row.totalCapacityMw), fmtNum(row.contd4CapacityMw),
      fmtNum(row.appliedMw), fmtNum(row.ftcApprovedMw), fmtNum(row.ftcPendingMw),
      fmtNum(row.tocIssuedMw), fmtNum(row.tocPendingMw),
      fmtNum(row.codCompletedMw), fmtNum(row.codPendingMw), fmtNum(row.expectedMw),
    ]);
    r++;
  }

  data.push([]);
  r++;

  // ── Table 1: CONTD-4 Study ────────────────────────────────────────────────
  const { rows: c4Rows, allMonths } = contd4Study;
  data.push(['Total Capacity Under CONTD-4 Study (MW)']);
  merges.push({ s: { r, c: 0 }, e: { r, c: 2 + allMonths.length } });
  r++;

  data.push(['Region', 'Source (Type)', 'Total Capacity (MW)', ...allMonths.map(fmtMonth)]);
  r++;

  for (const row of c4Rows) {
    const label1 = row.isTotal ? 'All India' : row.isSubtotal ? `${row.region} Total` : row.region;
    const label2 = row.isTotal || row.isSubtotal ? '' : row.source;
    data.push([label1, label2, fmtNum(row.totalMw), ...allMonths.map(m => fmtNum(row.months?.[m] ?? 0))]);
    r++;
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!merges'] = merges;
  setCols(ws, [18, 14, 18, 26, 20, 13, 13, 13, 13, 14, 13, 28]);
  return ws;
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
  const pipelineMatrix   = computePipelineMatrix(projects, asOf);
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
      p.contd4?.status === 'CLEARED' && getProjectSource(p) === source
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
