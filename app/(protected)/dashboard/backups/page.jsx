import { redirect } from 'next/navigation';
import { getServerUser } from '@/lib/server-auth';
import { BackupsPageClient } from './BackupsPageClient';

export const metadata = { title: 'Database Backups — FTC Portal' };

// Admin-only. No other role may view or trigger backups.
export default async function BackupsPage() {
  const user = await getServerUser();
  if (!user || user.role !== 'ADMIN') redirect('/dashboard');
  return <BackupsPageClient />;
}
