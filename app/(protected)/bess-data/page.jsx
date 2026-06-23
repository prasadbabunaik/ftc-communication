import { prisma } from '@/lib/prisma';
import { requireServerUser, buildRegionScope, activePeriodFilter, canEditGridData, getUserRegion } from '@/lib/server-auth';
import { redirect } from 'next/navigation';
import { BessDataPageClient } from '@/components/grid/BessDataPageClient';

export const metadata = { title: 'BESS Data — FTC Portal' };

// Dedicated BESS Data page — the same table the dashboard surfaces in a tab,
// here as a full sidebar page with Excel + PDF downloads. Scope: plain BESS
// plants, hybrids carrying a BESS component, and intra-state storage. Region
// scope follows the viewer's role.
export default async function BessDataPage() {
  let user;
  try { user = await requireServerUser(); }
  catch { redirect('/login'); }

  const scope = await buildRegionScope(user.role);
  const userRegion = await getUserRegion(user.role); // null for NLDC/ADMIN
  const activeFilter = activePeriodFilter(null);

  const allProjects = await prisma.generationProject.findMany({
    where: { ...scope, ...activeFilter },
    include: {
      region: true, plantType: true, poolingStation: true,
      phases: { include: { codEvents: true } },
    },
  });

  // BESS membership: plain BESS plants, intra-state storage, and hybrids that
  // carry a BESS component — detected via the segregation JSON (seeded data) OR
  // a BESS phase (hybrids added through the UI, which have no segregation JSON).
  const bessProjects = allProjects.filter((p) =>
    p.isIntrastate ||
    p.plantType?.code === 'BESS' ||
    (p.plantType?.isHybrid && (
      (p.hybridComponentsJson?.components ?? []).some((c) => c.sourceType === 'BESS') ||
      (p.phases ?? []).some((ph) => ph.sourceType === 'BESS')
    ))
  );

  const regionLabel = scope.regionId ? 'Showing your region' : 'All India';

  return (
    <BessDataPageClient
      bessProjects={JSON.parse(JSON.stringify(bessProjects))}
      regionLabel={regionLabel}
      scopeRegionCode={userRegion?.code ?? null}
      scopeRegionName={userRegion?.name ?? null}
      canEdit={canEditGridData(user.role)}
    />
  );
}
