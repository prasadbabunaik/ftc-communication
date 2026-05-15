import { prisma } from '@/lib/prisma';
import { requireServerUser, buildRegionScope, activePeriodFilter } from '@/lib/server-auth';
import { redirect } from 'next/navigation';
import { serialize } from '@/lib/serialize';
import { FtcPageClient } from '@/components/grid/FtcPageClient';

export const metadata = { title: 'FTC Tracker — FTC Portal' };

export default async function FtcPage() {
  let user;
  try {
    user = await requireServerUser();
  } catch {
    redirect('/login');
  }

  const scope = await buildRegionScope(user.role);

  const projects = await prisma.generationProject.findMany({
    where: {
      ...scope,
      ...activePeriodFilter(),
      contd4: { status: 'CLEARED' },
    },
    include: {
      region:         true,
      plantType:      true,
      poolingStation: true,
      contd4:         { include: { phases: { orderBy: { declaredDate: 'asc' } } } },
      phases:         {
        orderBy: { createdAt: 'asc' },
        include: {
          ftcEvents: { orderBy: { eventDate: 'asc' } },
          tocEvents: { orderBy: { eventDate: 'asc' } },
          codEvents: { orderBy: { eventDate: 'asc' } },
        },
      },
      notes:          { include: { user: true }, orderBy: { createdAt: 'desc' } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const allCleared = serialize(
    projects.map((p) => ({
      id:              p.id,
      name:            p.name,
      totalCapacityMw: Number(p.totalCapacityMw),
      windCapacityMw:  p.windCapacityMw  != null ? Number(p.windCapacityMw)  : null,
      solarCapacityMw: p.solarCapacityMw != null ? Number(p.solarCapacityMw) : null,
      bessCapacityMw:  p.bessCapacityMw  != null ? Number(p.bessCapacityMw)  : null,
      region:          p.region,
      plantType:       p.plantType,
      phases: p.phases.map((ph) => ({
        sourceType:        ph.sourceType,
        capacityAppliedMw: ph.capacityAppliedMw != null ? Number(ph.capacityAppliedMw) : null,
        ftcCompletedMw:    ph.ftcCompletedMw    != null ? Number(ph.ftcCompletedMw)    : null,
        tocIssuedMw:       ph.tocIssuedMw       != null ? Number(ph.tocIssuedMw)       : null,
        codDeclaredMw:     ph.codDeclaredMw     != null ? Number(ph.codDeclaredMw)     : null,
      })),
    }))
  );

  const enriched = serialize(
    projects.map((p) => ({
      ...p,
      totalCapacityMw:   Number(p.totalCapacityMw),
      windCapacityMw:    p.windCapacityMw  != null ? Number(p.windCapacityMw)  : null,
      solarCapacityMw:   p.solarCapacityMw != null ? Number(p.solarCapacityMw) : null,
      bessCapacityMw:    p.bessCapacityMw  != null ? Number(p.bessCapacityMw)  : null,
      commissionedMw:    p.phases.reduce((s, ph) => s + Number(ph.codDeclaredMw ?? 0), 0),
      pendingCapacityMw: Number(p.totalCapacityMw) -
                         p.phases.reduce((s, ph) => s + Number(ph.codDeclaredMw ?? 0), 0),
      phases: p.phases.map((ph) => {
        const toc = ph.tocIssuedMw  != null ? Number(ph.tocIssuedMw)  : 0;
        const cod = ph.codDeclaredMw != null ? Number(ph.codDeclaredMw) : 0;
        return {
          ...ph,
          capacityAppliedMw:  ph.capacityAppliedMw  != null ? Number(ph.capacityAppliedMw)  : null,
          ftcCompletedMw:     ph.ftcCompletedMw      != null ? Number(ph.ftcCompletedMw)      : null,
          tocIssuedMw:        toc,
          codDeclaredMw:      cod,
          capacityUnderFtcMw: ph.capacityUnderFtcMw  != null ? Number(ph.capacityUnderFtcMw)  : null,
          capacityUnderTocMw: ph.capacityUnderTocMw  != null ? Number(ph.capacityUnderTocMw)  : null,
          codPendingMw:       Math.max(0, toc - cod),
          expectedApr26Mw:    ph.expectedApr26Mw     != null ? Number(ph.expectedApr26Mw)     : null,
        };
      }),
    }))
  );

  const regionLabel = scope.regionId
    ? 'Showing projects for your region'
    : 'Showing all regions (NLDC/Admin view)';

  return (
    <FtcPageClient
      projects={enriched}
      allClearedProjects={allCleared}
      userRole={user.role}
      regionLabel={regionLabel}
    />
  );
}
