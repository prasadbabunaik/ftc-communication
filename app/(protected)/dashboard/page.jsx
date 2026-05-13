import { prisma } from '@/lib/prisma';
import { requireServerUser, buildRegionScope } from '@/lib/server-auth';
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

  const [projects, txElements] = await Promise.all([
    prisma.generationProject.findMany({
      where: scope,
      include: { region: true, plantType: true, contd4: true, phases: true, poolingStation: true },
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
  const monthlyCod       = computeMonthlyCod(projects, fromMonth, toMonth);

  const cleared      = projects.filter(p => p.contd4?.status === 'CLEARED');
  const allPhases    = cleared.flatMap(p => p.phases);
  const totalApplied = allPhases.reduce((s, ph) => s + n(ph.capacityAppliedMw), 0);
  const totalFtc     = allPhases.reduce((s, ph) => {
    const done = !asOf || (ph.ftcCompletedDate && new Date(ph.ftcCompletedDate) <= asOf);
    return s + (done ? n(ph.ftcCompletedMw) : 0);
  }, 0);
  const totalToc = allPhases.reduce((s, ph) => {
    const done = !asOf || (ph.tocIssuedDate && new Date(ph.tocIssuedDate) <= asOf);
    return s + (done ? n(ph.tocIssuedMw) : 0);
  }, 0);
  const totalCod = allPhases.reduce((s, ph) => {
    const done = !asOf || (ph.codDeclaredDate && new Date(ph.codDeclaredDate) <= asOf);
    return s + (done ? n(ph.codDeclaredMw) : 0);
  }, 0);
  const contd4Active = projects.filter(p =>
    p.contd4 && !['CLEARED', 'REJECTED'].includes(p.contd4.status)
  ).length;
  const txPending = txElements.filter(e => e.pendingFtc).length;

  const regionLabel = scope.regionId ? 'Showing your region' : 'All India view';

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
    />
  );
}
