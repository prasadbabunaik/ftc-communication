import { redirect } from 'next/navigation';
import { getServerUser } from '@/lib/server-auth';
import { listUsers } from '@/app/actions/users';
import { UsersPageClient } from './UsersPageClient';

export default async function UsersPage() {
  const user = await getServerUser();
  if (!user || (user.role !== 'ADMIN' && user.role !== 'NLDC')) redirect('/dashboard');

  const { users, error } = await listUsers();
  if (error) redirect('/dashboard');

  return <UsersPageClient users={users} currentUserId={user.id} currentUserRole={user.role} />;
}
