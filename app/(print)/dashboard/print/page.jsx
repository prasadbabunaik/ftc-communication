import { prisma } from '@/lib/prisma';
import { requireServerUser, buildRegionScope, getUserRegion } from '@/lib/server-auth';
import { redirect } from 'next/navigation';
import { PrintSummaryClient } from '@/components/grid/PrintSummaryClient';
import {
  computePipelineMatrix, buildPipelineRows,
  computeContd4Study, computeTransmission, computeHybridBreakdown,
  computeMilestoneActivity,
} from '@/lib/grid-computations';

export const metadata = { title: 'Print Summary — FTC Portal' };

export default async function PrintSummaryPage({ searchParams }) {
  let user;
  try { user = await requireServerUser(); }
  catch { redirect('/login'); }

  const params  = await searchParams;
  const asOfStr = params.asOf ?? null;
  const asOf    = asOfStr ? new Date(asOfStr) : null;

  const scope      = await buildRegionScope(user.role);
  const userRegion = await getUserRegion(user.role); // null for NLDC/ADMIN

  const [projects, txElements] = await Promise.all([
    prisma.generationProject.findMany({
      where: scope,
      include: {
        region: true, plantType: true,
        contd4: { include: { phases: { orderBy: { declaredDate: 'asc' } } } },
        // Per-date events drive the FTC/TOC/COD Activity matrices.
        phases: { include: { ftcEvents: true, tocEvents: true, codEvents: true } },
        poolingStation: true,
      },
    }),
    prisma.transmissionElement.findMany({
      where: scope,
      include: { region: true },
    }),
  ]);

  const pipelineMatrix   = computePipelineMatrix(projects, asOf);
  const table2Rows       = buildPipelineRows(pipelineMatrix, 'region', 'source');
  const table5Rows       = buildPipelineRows(pipelineMatrix, 'source', 'region');
  const contd4Study      = computeContd4Study(projects);
  const transmissionRows = computeTransmission(txElements);
  const hybridRows       = computeHybridBreakdown(projects, asOf);

  // FTC/TOC/COD Activity — a rolling 3-month window (current month + the two
  // prior months), so June shows Apr + May + Jun. Honours an asOf cutoff.
  const activityEnd = asOf
    ? new Date(asOfStr + 'T23:59:59.999Z')
    : (() => { const t = new Date(); t.setUTCHours(23, 59, 59, 999); return t; })();
  const activityStart = new Date(Date.UTC(activityEnd.getUTCFullYear(), activityEnd.getUTCMonth() - 2, 1, 0, 0, 0, 0));
  const activity = computeMilestoneActivity(projects, activityStart, activityEnd, []);
  const fmtDay = (d) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const activityRange = `${fmtDay(activityStart)} → ${fmtDay(activityEnd)}`;

  const dateLabel = asOfStr
    ? new Date(asOfStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <PrintSummaryClient
      dateLabel={dateLabel}
      scopeRegionCode={userRegion?.code ?? null}  // null → All India view (NLDC/ADMIN)
      scopeRegionName={userRegion?.name ?? null}
      table2Rows={JSON.parse(JSON.stringify(table2Rows))}
      table5Rows={JSON.parse(JSON.stringify(table5Rows))}
      contd4Study={JSON.parse(JSON.stringify(contd4Study))}
      transmissionRows={JSON.parse(JSON.stringify(transmissionRows))}
      hybridRows={JSON.parse(JSON.stringify(hybridRows))}
      projects={JSON.parse(JSON.stringify(projects))}
      activity={JSON.parse(JSON.stringify(activity))}
      activityRange={activityRange}
    />
  );
}
