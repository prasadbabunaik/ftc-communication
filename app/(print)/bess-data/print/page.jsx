import { prisma } from '@/lib/prisma';
import { requireServerUser, buildRegionScope, activePeriodFilter, getUserRegion } from '@/lib/server-auth';
import { redirect } from 'next/navigation';
import { BessPrintClient } from '@/components/grid/BessPrintClient';

export const metadata = { title: 'BESS Data — Print — FTC Portal' };

// Dedicated browser-printable BESS Data view (HTML → Print / Save as PDF),
// branded like the dashboard print view. Same data scope as /bess-data; the
// reference month for the "COD Declared in <month>" column is passed via ?ref
// (the BESS page reads it from client settings the print page can't see).
export default async function BessPrintPage({ searchParams }) {
  let user;
  try { user = await requireServerUser(); }
  catch { redirect('/login'); }

  const params = await searchParams;
  const referenceMonth = params?.ref || null;

  const scope = await buildRegionScope(user.role);
  const userRegion = await getUserRegion(user.role); // null for NLDC/ADMIN

  const allProjects = await prisma.generationProject.findMany({
    where: { ...scope, ...activePeriodFilter(null) },
    include: {
      region: true, plantType: true, poolingStation: true,
      phases: { include: { codEvents: true } },
    },
  });

  // Same membership test as the BESS page / dashboard BESS tab.
  const bessProjects = allProjects.filter((p) =>
    p.isIntrastate ||
    p.plantType?.code === 'BESS' ||
    (p.plantType?.isHybrid &&
      (p.hybridComponentsJson?.components ?? []).some((c) => c.sourceType === 'BESS'))
  );

  const dateLabel = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <BessPrintClient
      bessProjects={JSON.parse(JSON.stringify(bessProjects))}
      referenceMonth={referenceMonth}
      scopeRegionCode={userRegion?.code ?? null}
      scopeRegionName={userRegion?.name ?? null}
      dateLabel={dateLabel}
    />
  );
}
