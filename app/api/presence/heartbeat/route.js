import { NextResponse } from 'next/server';
import { getServerUser } from '@/lib/server-auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/presence/heartbeat — the signed-in user's tab pings this every ~30s
// while it is in the foreground. It stamps lastSeenAt = now so the admin-only
// "Viewing now" indicator can list who is currently viewing. Every logged-in
// user sends heartbeats (so admins can see them); only admins can READ the list.
export async function POST() {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // user.id is always the REAL signed-in user (the "view as" overlay only
  // changes `role`, never the identity), so presence is attributed correctly.
  await prisma.user.update({
    where: { id: user.id },
    data: { lastSeenAt: new Date() },
  });

  return new NextResponse(null, { status: 204 });
}
