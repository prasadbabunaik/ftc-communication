import { prisma } from '@/lib/prisma';
import { requireServerUser, buildRegionScope, getUserRegion } from '@/lib/server-auth';
import { redirect } from 'next/navigation';
import { serialize } from '@/lib/serialize';
import { Contd4PageClient } from '@/components/grid/Contd4PageClient';

export const metadata = { title: 'CONTD-4 Applications — FTC Portal' };

export default async function Contd4Page() {
  let user;
  try {
    user = await requireServerUser();
  } catch {
    redirect('/login');
  }

  const scope = await buildRegionScope(user.role);

  const [projects, regions, plantTypes, userRegion] = await Promise.all([
    prisma.generationProject.findMany({
      where: scope,
      include: {
        region:         true,
        plantType:      true,
        poolingStation: true,
        contd4:         true,
        phases:         { orderBy: { createdAt: 'asc' } },
        notes:          { include: { user: true }, orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.gridRegion.findMany({ orderBy: { code: 'asc' } }),
    prisma.plantType.findMany({ orderBy: { label: 'asc' } }),
    getUserRegion(user.role),
  ]);

  const poolingStations = await prisma.poolingStation.findMany({
    where: userRegion ? { regionId: userRegion.id } : undefined,
    orderBy: { name: 'asc' },
  });

  const enriched = serialize(
    projects.map((p) => ({
      ...p,
      totalCapacityMw:   Number(p.totalCapacityMw),
      commissionedMw:    p.phases.reduce((s, ph) => s + Number(ph.codDeclaredMw ?? 0), 0),
      pendingCapacityMw: Number(p.totalCapacityMw) -
                         p.phases.reduce((s, ph) => s + Number(ph.codDeclaredMw ?? 0), 0),
    }))
  );

  const regionLabel = scope.regionId
    ? 'Showing projects for your region'
    : 'Showing all regions (NLDC/Admin view)';

  return (
    <Contd4PageClient
      projects={enriched}
      regions={serialize(regions)}
      plantTypes={serialize(plantTypes)}
      poolingStations={serialize(poolingStations)}
      lockedRegionId={userRegion?.id ?? null}
      userRole={user.role}
      regionLabel={regionLabel}
    />
  );
}
