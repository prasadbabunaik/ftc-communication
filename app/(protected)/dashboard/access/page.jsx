import { redirect } from 'next/navigation';
import { getServerUser } from '@/lib/server-auth';
import { AccessControlClient } from './AccessControlClient';

export default async function AccessControlPage() {
  const user = await getServerUser();
  if (!user || (user.role !== 'ADMIN' && user.role !== 'NLDC')) redirect('/dashboard');

  return <AccessControlClient currentRole={user.role} />;
}
