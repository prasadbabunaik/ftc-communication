import { prisma } from '@/lib/prisma';
import { requireServerUser, buildRegionScope, getUserRegion, activePeriodFilter } from '@/lib/server-auth';
import { redirect } from 'next/navigation';
import { serialize } from '@/lib/serialize';
import { TransmissionPageClient } from '@/components/grid/TransmissionPageClient';

export const metadata = { title: 'Transmission Elements — FTC Portal' };

export default async function TransmissionPage({ searchParams }) {
  let user;
  try {
    user = await requireServerUser();
  } catch {
    redirect('/login');
  }

  // ?asOf=YYYY-MM-DD restricts to elements active on that date and replays
  // each element's audit log to the historical field values.
  const params  = await searchParams;
  const asOfStr = params?.asOf ?? null;
  const asOf    = asOfStr ? new Date(asOfStr + 'T23:59:59.999Z') : null;

  const scope = await buildRegionScope(user.role);
  const userRegion = await getUserRegion(user.role);

  const [elementsRaw, regions] = await Promise.all([
    prisma.transmissionElement.findMany({
      where: { ...scope, ...activePeriodFilter(asOf) },
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

  // Historical state replay: for each element pick the latest audit log
  // whose effective date ≤ asOf and apply its stateJson. Mirrors the same
  // logic used by lib/snapshot-rebuild#txStateMapAsOf so dashboard +
  // snapshots stay in sync.
  const elements = asOf
    ? elementsRaw.map((e) => {
        const eff = (l) => new Date(l.effectiveDate ?? l.createdAt).getTime();
        const cutoff = asOf.getTime();
        const latest = (e.auditLogs ?? [])
          .filter((l) => l.stateJson && eff(l) <= cutoff)
          .sort((a, b) => eff(b) - eff(a))[0];
        if (!latest) return e;
        return { ...e, ...latest.stateJson, region: e.region };
      })
    : elementsRaw;

  return (
    <TransmissionPageClient
      elements={serialize(elements)}
      regions={serialize(regions)}
      lockedRegionId={userRegion?.id ?? null}
      userRole={user.role}
      asOf={asOfStr}
    />
  );
}
