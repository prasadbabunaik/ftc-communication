import { prisma } from '@/lib/prisma';
import { requireServerUser, buildRegionScope, activePeriodFilter } from '@/lib/server-auth';
import { redirect } from 'next/navigation';
import { SummaryPageClient } from '@/components/grid/SummaryPageClient';
import {
  n,
  computePipelineMatrix, buildPipelineRows,
  computeContd4Study, computeTransmission,
  computeHybridBreakdown, computeMonthlyCod,
} from '@/lib/grid-computations';

export const metadata = { title: 'Dashboard — FTC Portal' };

export default async function DashboardPage({ searchParams }) {
  let user;
  try { user = await requireServerUser(); }
  catch { redirect('/login'); }

  const params    = await searchParams;
  const asOfStr   = params.asOf   ?? null;
  const fromMonth = params.from   ?? null;
  const toMonth   = params.to     ?? null;
  const asOf      = asOfStr ? new Date(asOfStr) : null;

  const scope = await buildRegionScope(user.role);
  // Restrict to projects/elements that were "live" on the requested date.
  // With no asOf, this becomes `activeUntil IS NULL` — i.e. currently-active.
  const activeFilter = activePeriodFilter(asOf);

  const [projects, txElements, snapshots] = await Promise.all([
    prisma.generationProject.findMany({
      where: { ...scope, ...activeFilter },
      include: {
        region: true,
        plantType: true,
        contd4: { include: { phases: { orderBy: { declaredDate: 'asc' } } } },
        // Include per-date events so the pipeline compute can give accurate
        // point-in-time totals when an `asOf` is selected.
        phases: { include: { ftcEvents: true, tocEvents: true, codEvents: true } },
        poolingStation: true,
      },
    }),
    prisma.transmissionElement.findMany({
      where: { ...scope, ...activeFilter },
      include: { region: true },
    }),
    // Snapshots drive the "As on date" picker and the last-changes summary.
    prisma.gridSnapshot.findMany({
      select: { id: true, snapshotDate: true, label: true },
      orderBy: { snapshotDate: 'asc' },
    }),
  ]);

  const pipelineMatrix   = computePipelineMatrix(projects, asOf);
  const table2Rows       = buildPipelineRows(pipelineMatrix, 'region', 'source');
  const table5Rows       = buildPipelineRows(pipelineMatrix, 'source', 'region');
  const contd4Study      = computeContd4Study(projects);
  const transmissionRows = computeTransmission(txElements);
  const hybridRows       = computeHybridBreakdown(projects, asOf);
  const monthlyCod       = computeMonthlyCod(projects, fromMonth, toMonth);

  // Stat-card totals reuse the same milestone aggregation as the pipeline
  // matrix — sum across cells so values are consistent with the tables below.
  const totalApplied  = Object.values(pipelineMatrix).reduce((s, r) => s + n(r.appliedMw),     0);
  const totalFtc      = Object.values(pipelineMatrix).reduce((s, r) => s + n(r.ftcApprovedMw),  0);
  const totalToc      = Object.values(pipelineMatrix).reduce((s, r) => s + n(r.tocIssuedMw),    0);
  const totalCod      = Object.values(pipelineMatrix).reduce((s, r) => s + n(r.codCompletedMw), 0);
  const contd4Active  = projects.filter(p => p.contd4 && !['CLEARED', 'REJECTED'].includes(p.contd4.status)).length;
  const txPending     = txElements.filter(e => e.pendingFtc).length;

  const regionLabel = scope.regionId ? 'Showing your region' : 'All India view';

  // Serialise available snapshot dates for the "As on" picker + Last-changes card.
  const availableSnapshots = snapshots.map(s => ({
    date:  s.snapshotDate.toISOString().slice(0, 10),
    label: s.label,
  }));

  return (
    <SummaryPageClient
      regionLabel={regionLabel}
      asOf={asOfStr}
      fromMonth={fromMonth}
      toMonth={toMonth}
      stats={{ totalApplied, totalFtc, totalToc, totalCod, contd4Active, txPending }}
      table2Rows={JSON.parse(JSON.stringify(table2Rows))}
      table5Rows={JSON.parse(JSON.stringify(table5Rows))}
      contd4Study={JSON.parse(JSON.stringify(contd4Study))}
      transmissionRows={JSON.parse(JSON.stringify(transmissionRows))}
      hybridRows={JSON.parse(JSON.stringify(hybridRows))}
      monthlyCod={JSON.parse(JSON.stringify(monthlyCod))}
      projects={JSON.parse(JSON.stringify(projects))}
      txElements={JSON.parse(JSON.stringify(txElements))}
      availableSnapshots={availableSnapshots}
    />
  );
}
