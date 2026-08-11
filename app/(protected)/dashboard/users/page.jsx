import { redirect } from 'next/navigation';
import { getServerUser } from '@/lib/server-auth';
import { prisma } from '@/lib/prisma';
import { listUsers } from '@/app/actions/users';
import { UsersPageClient } from './UsersPageClient';

export default async function UsersPage() {
  const user = await getServerUser();
  if (!user || (user.role !== 'ADMIN' && user.role !== 'NLDC')) redirect('/dashboard');

  const { users, error } = await listUsers();
  if (error) redirect('/dashboard');

  // Regions power the VIEWER-account region selector (all regions vs. one).
  const regions = await prisma.gridRegion.findMany({
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });

  return <UsersPageClient users={users} regions={regions} currentUserId={user.id} currentUserRole={user.role} />;
}
