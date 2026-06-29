import { requireServerUser, getUserRegion } from '@/lib/server-auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { CreateProjectForm } from '@/components/grid/CreateProjectForm';

export const metadata = { title: 'Add Generation Project — FTC Portal' };

export default async function NewGenerationPage() {
  let user;
  try {
    user = await requireServerUser();
  } catch {
    redirect('/login');
  }

  const canCreate = ['ADMIN', 'NLDC', 'SRLDC', 'NRLDC', 'ERLDC', 'WRLDC', 'NERLDC'].includes(user.role);
  if (!canCreate) redirect('/generation');

  const [regions, plantTypes] = await Promise.all([
    prisma.gridRegion.findMany({ orderBy: { code: 'asc' } }),
    prisma.plantType.findMany({ orderBy: { label: 'asc' } }),
  ]);

  // Lock region for RLDC users
  const userRegion = await getUserRegion(user.role);

  // Preload pooling stations for the user's locked region (or all if ADMIN)
  const poolingStations = await prisma.poolingStation.findMany({
    where: userRegion ? { regionId: userRegion.id } : undefined,
    orderBy: { name: 'asc' },
  });

  // Master generating-station list for the searchable dropdown.
  const stations = await prisma.generatingStation.findMany({
    where: userRegion ? { regionCode: userRegion.code } : undefined,
    select: { name: true, poolingStationName: true, regionCode: true },
    orderBy: { name: 'asc' },
  });

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">Add Generation Project</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Create a new generation project and optionally attach its CONTD-4 application.
        </p>
      </div>

      <CreateProjectForm
        regions={regions}
        plantTypes={plantTypes}
        poolingStations={poolingStations}
        stations={stations}
        lockedRegionId={userRegion?.id ?? null}
        userRole={user.role}
      />
    </div>
  );
}
