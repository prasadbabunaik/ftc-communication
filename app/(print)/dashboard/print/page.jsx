import { prisma } from '@/lib/prisma';
import { requireServerUser, buildRegionScope, getUserRegion, activePeriodFilter } from '@/lib/server-auth';
import { redirect } from 'next/navigation';
import { PrintSummaryClient } from '@/components/grid/PrintSummaryClient';
import {
  computePipelineMatrix, buildPipelineRows,
  computeContd4Study, computeTransmission, computeHybridBreakdown,
  computeMilestoneActivity, isProjectCommissioned,
  computeHybridComponentBreakup, inclHybridSourceTotals, expandRegionRowsWithHybrid,
} from '@/lib/grid-computations';

export const metadata = { title: 'Print Summary — FTC Portal' };

export default async function PrintSummaryPage({ searchParams }) {
  let user;
  try { user = await requireServerUser(); }
  catch { redirect('/login'); }

  const params  = await searchParams;
  const asOfStr = params.asOf ?? null;
  const asOf    = asOfStr ? new Date(asOfStr) : null;
  // Point-in-time cutoff for milestone sums. End-of-day so an event dated on the
  // picked day counts — this MUST mirror the dashboard's `computeAsOf` exactly
  // (the dashboard passes today/asOf end-of-day to computePipelineMatrix, not
  // midnight), otherwise a same-day event would count on one view and not the
  // other.
  const computeAsOf = asOf
    ? new Date(asOfStr + 'T23:59:59.999Z')
    : (() => { const t = new Date(); t.setUTCHours(23, 59, 59, 999); return t; })();
  // Carried from the dashboard's "Exclude Commissioned" checkbox so the PDF
  // matches the on-screen pipeline (only still-under-process projects).
  const excludeCommissioned = params.excludeCommissioned === '1';

  const scope      = await buildRegionScope(user.role);
  const userRegion = await getUserRegion(user.role); // null for NLDC/ADMIN
  // Same active-period gate the dashboard applies. Superseded/versioned records
  // (activeUntil set) must be excluded, else the PDF double-counts projects that
  // were later replaced — the dashboard filters them via activePeriodFilter, so
  // the PDF has to as well or the two views disagree (e.g. WR Applied 12,625 in
  // the PDF vs 12,061 on screen). With no asOf this becomes `activeUntil IS NULL`.
  const activeFilter = activePeriodFilter(asOf);

  const [projects, txElements] = await Promise.all([
    prisma.generationProject.findMany({
      where: { ...scope, ...activeFilter },
      include: {
        region: true, plantType: true,
        contd4: { include: { phases: { orderBy: { declaredDate: 'asc' } } } },
        // Per-date events drive the FTC/TOC/COD Activity matrices.
        phases: { include: { ftcEvents: true, tocEvents: true, codEvents: true } },
        poolingStation: true,
      },
    }),
    prisma.transmissionElement.findMany({
      where: { ...scope, ...activeFilter },
      include: { region: true },
    }),
  ]);

  // "Exclude Commissioned" narrows only the FTC pipeline tables (matching the
  // dashboard's scoping); CONTD-4 / transmission / hybrid / activity stay full.
  const pipelineProjects = excludeCommissioned
    ? projects.filter((p) => !isProjectCommissioned(p))
    : projects;
  const pipelineMatrix   = computePipelineMatrix(pipelineProjects, computeAsOf);
  const table5Rows       = buildPipelineRows(pipelineMatrix, 'source', 'region');
  // Region-wise: subdivide HYBRID into its component sources and append the
  // "Total <Source> including Hybrid" rows before the grand total.
  const hybridBreakup    = computeHybridComponentBreakup(pipelineProjects, computeAsOf);
  const inclTotals       = inclHybridSourceTotals(pipelineProjects, computeAsOf);
  const table2Rows       = expandRegionRowsWithHybrid(
    buildPipelineRows(pipelineMatrix, 'region', 'source'), hybridBreakup, inclTotals);
  const contd4Study      = computeContd4Study(projects);
  const transmissionRows = computeTransmission(txElements);
  const hybridRows       = computeHybridBreakdown(projects, computeAsOf);

  // Inter-State COD Activity — one Source × Region matrix per month, for the
  // current month + the two prior (June → Apr, May, Jun), oldest first. Each
  // month is independently toggleable in the print Customize panel. Honours an
  // asOf cutoff (the current month is capped at asOf / today).
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const activityEnd = asOf
    ? new Date(asOfStr + 'T23:59:59.999Z')
    : (() => { const t = new Date(); t.setUTCHours(23, 59, 59, 999); return t; })();
  const activityMonths = [2, 1, 0].map((back) => {
    const y = activityEnd.getUTCFullYear();
    const m = activityEnd.getUTCMonth() - back;
    const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
    const endOfMonth = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
    const end = endOfMonth.getTime() < activityEnd.getTime() ? endOfMonth : activityEnd;
    return {
      key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
      label: `${MONTH_NAMES[start.getUTCMonth()]} ${start.getUTCFullYear()}`,
      activity: computeMilestoneActivity(projects, start, end, []),
    };
  });

  const dateLabel = asOfStr
    ? new Date(asOfStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <PrintSummaryClient
      dateLabel={dateLabel}
      excludeCommissioned={excludeCommissioned}
      scopeRegionCode={userRegion?.code ?? null}  // null → All India view (NLDC/ADMIN)
      scopeRegionName={userRegion?.name ?? null}
      table2Rows={JSON.parse(JSON.stringify(table2Rows))}
      table5Rows={JSON.parse(JSON.stringify(table5Rows))}
      contd4Study={JSON.parse(JSON.stringify(contd4Study))}
      transmissionRows={JSON.parse(JSON.stringify(transmissionRows))}
      hybridRows={JSON.parse(JSON.stringify(hybridRows))}
      projects={JSON.parse(JSON.stringify(projects))}
      activityMonths={JSON.parse(JSON.stringify(activityMonths))}
    />
  );
}
