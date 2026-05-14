import { prisma } from '@/lib/prisma';
import { requireServerUser, buildRegionScope } from '@/lib/server-auth';
import { redirect } from 'next/navigation';
import { PrintSummaryClient } from '@/components/grid/PrintSummaryClient';
import {
  computePipelineMatrix, buildPipelineRows,
  computeContd4Study, computeTransmission,
} from '@/lib/grid-computations';

export const metadata = { title: 'Print Summary — FTC Portal' };

export default async function PrintSummaryPage({ searchParams }) {
  let user;
  try { user = await requireServerUser(); }
  catch { redirect('/login'); }

  const params  = await searchParams;
  const asOfStr = params.asOf ?? null;
  const asOf    = asOfStr ? new Date(asOfStr) : null;

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

  const dateLabel = asOfStr
    ? new Date(asOfStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <PrintSummaryClient
      dateLabel={dateLabel}
      table2Rows={JSON.parse(JSON.stringify(table2Rows))}
      table5Rows={JSON.parse(JSON.stringify(table5Rows))}
      contd4Study={JSON.parse(JSON.stringify(contd4Study))}
      transmissionRows={JSON.parse(JSON.stringify(transmissionRows))}
      projects={JSON.parse(JSON.stringify(projects))}
    />
  );
}
