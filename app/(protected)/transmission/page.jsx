import { prisma } from '@/lib/prisma';
import { requireServerUser, buildRegionScope, getUserRegion, activePeriodFilter } from '@/lib/server-auth';
import { redirect } from 'next/navigation';
import { serialize } from '@/lib/serialize';
import { TransmissionPageClient } from '@/components/grid/TransmissionPageClient';

export const metadata = { title: 'Transmission Elements — FTC Portal' };

export default async function TransmissionPage() {
  let user;
  try {
    user = await requireServerUser();
  } catch {
    redirect('/login');
  }

  const scope = await buildRegionScope(user.role);
  const userRegion = await getUserRegion(user.role);

  const [elements, regions] = await Promise.all([
    prisma.transmissionElement.findMany({
      where: { ...scope, ...activePeriodFilter() },
      include: {
        region: true,
        auditLogs: {
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.gridRegion.findMany({ orderBy: { code: 'asc' } }),
  ]);

  return (
    <TransmissionPageClient
      elements={serialize(elements)}
      regions={serialize(regions)}
      lockedRegionId={userRegion?.id ?? null}
      userRole={user.role}
    />
  );
}
