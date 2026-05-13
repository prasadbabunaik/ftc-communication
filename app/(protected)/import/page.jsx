import { requireServerUser, getUserRegion } from '@/lib/server-auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { ImportWizard } from '@/components/grid/ImportWizard';
import { serialize } from '@/lib/serialize';

export const metadata = { title: 'Bulk Import — FTC Portal' };

export default async function ImportPage() {
  let user;
  try {
    user = await requireServerUser();
  } catch {
    redirect('/login');
  }

  const canImport = ['ADMIN', 'SRLDC', 'NRLDC', 'ERLDC', 'WRLDC', 'NERLDC'].includes(user.role);
  if (!canImport) redirect('/dashboard');

  const [regions, plantTypes, poolingStations] = await Promise.all([
    prisma.gridRegion.findMany({ orderBy: { code: 'asc' } }),
    prisma.plantType.findMany({ orderBy: { label: 'asc' } }),
    prisma.poolingStation.findMany({
      include: { region: { select: { code: true } } },
      orderBy: { name: 'asc' },
    }),
  ]);

  const userRegion = await getUserRegion(user.role);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">Bulk Import from Excel / CSV</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload an Excel file to import Generation Projects or Transmission Elements.
          Unmatched values will be highlighted for manual review before confirming.
        </p>
      </div>

      <ImportWizard
        regions={serialize(regions)}
        plantTypes={serialize(plantTypes)}
        poolingStations={serialize(poolingStations)}
        lockedRegionId={userRegion?.id ?? null}
        userRole={user.role}
      />
    </div>
  );
}
