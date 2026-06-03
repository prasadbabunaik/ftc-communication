import { prisma } from '@/lib/prisma';
import { requireServerUser, buildRegionScope, activePeriodFilter } from '@/lib/server-auth';
import { redirect } from 'next/navigation';
import { BreakupPageClient } from '@/components/grid/BreakupPageClient';

export const metadata = { title: 'Source-wise Breakup — FTC Portal' };

// Dedicated Source-wise breakup page — the same per-contributor breakdown that
// the dashboard surfaces in a modal, here as a full page reachable from the
// sidebar. Defaults to the source-wise layout (mirrors the Excel "Source wise"
// sheet); the in-view toggle still allows Region-wise / Region × Source.
export default async function SourceWiseBreakupPage() {
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
      activeTab="sourcewise"
      projects={JSON.parse(JSON.stringify(projects))}
      txElements={JSON.parse(JSON.stringify(txElements))}
    />
  );
}
