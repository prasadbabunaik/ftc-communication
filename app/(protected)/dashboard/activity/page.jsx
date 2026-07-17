import { redirect } from 'next/navigation';
import { getServerUser } from '@/lib/server-auth';
import { prisma } from '@/lib/prisma';
import { LoginActivityClient } from './LoginActivityClient';

export const metadata = { title: 'Login Activity — FTC Portal' };

// Admin-only audit view of every user's login / logout events. Dynamic (reads
// cookies via getServerUser) and queried fresh on each load — no caching.
export default async function LoginActivityPage() {
  const user = await getServerUser();
  if (!user || user.role !== 'ADMIN') redirect('/dashboard');

  // Most-recent 1000 events, newest first, with the user's identity attached.
  const events = await prisma.authActivity.findMany({
    orderBy: { createdAt: 'desc' },
    take: 1000,
    include: { user: { select: { name: true, email: true, role: true } } },
  });

  const rows = events.map((e) => ({
    id:        e.id,
    action:    e.action,
    method:    e.method,
    ipAddress: e.ipAddress,
    userAgent: e.userAgent,
    createdAt: e.createdAt.toISOString(),
    userName:  e.user?.name  ?? 'Deleted user',
    userEmail: e.user?.email ?? '—',
    userRole:  e.user?.role  ?? '—',
  }));

  return <LoginActivityClient rows={rows} />;
}
