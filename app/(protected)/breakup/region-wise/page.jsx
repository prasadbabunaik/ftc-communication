import { prisma } from '@/lib/prisma';
import { requireServerUser, buildRegionScope, activePeriodFilter } from '@/lib/server-auth';
import { redirect } from 'next/navigation';
import { BreakupPageClient } from '@/components/grid/BreakupPageClient';

export const metadata = { title: 'Region-wise Breakup — FTC Portal' };

// Dedicated Region-wise breakup page — defaults to the region-wise layout
// (mirrors the NR / WR / SR / ER / NER sheets). The in-view toggle still
// allows Source-wise / Region × Source.
export default async function RegionWiseBreakupPage() {
  let user;
  try { user = await requireServerUser(); }
  catch { redirect('/login'); }

  const scope = await buildRegionScope(user.role);
  const activeFilter = activePeriodFilter(null);

  const [projects, txElements] = await Promise.all([
    prisma.generationProject.findMany({
      where: { ...scope, ...activeFilter },
      include: {
        region: true, plantType: true, poolingStation: true,
        contd4: { include: { phases: { orderBy: { declaredDate: 'asc' } } } },
        phases: { include: { ftcEvents: true, tocEvents: true, codEvents: true } },
      },
    }),
    prisma.transmissionElement.findMany({
      where: { ...scope, ...activeFilter },
      include: { region: true },
    }),
  ]);

  return (
    <BreakupPageClient
      activeTab="pipeline"
      projects={JSON.parse(JSON.stringify(projects))}
      txElements={JSON.parse(JSON.stringify(txElements))}
    />
  );
}
