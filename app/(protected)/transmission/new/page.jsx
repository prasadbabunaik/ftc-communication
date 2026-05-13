import { requireServerUser, getUserRegion } from '@/lib/server-auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { AddTransmissionForm } from '@/components/grid/AddTransmissionForm';

export const metadata = { title: 'Add Transmission Element — FTC Portal' };

export default async function NewTransmissionPage() {
  let user;
  try {
    user = await requireServerUser();
  } catch {
    redirect('/login');
  }

  const canCreate = ['ADMIN', 'SRLDC', 'NRLDC', 'ERLDC', 'WRLDC', 'NERLDC'].includes(user.role);
  if (!canCreate) redirect('/transmission');

  const regions = await prisma.gridRegion.findMany({ orderBy: { code: 'asc' } });
  const userRegion = await getUserRegion(user.role);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">Add Transmission Element</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Add a transmission line, ICT, or transformer under the FTC process.
        </p>
      </div>

      <AddTransmissionForm
        regions={regions}
        lockedRegionId={userRegion?.id ?? null}
        userRole={user.role}
      />
    </div>
  );
}
