import { NextResponse } from 'next/server';
import { getServerUser } from '@/lib/server-auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// A viewer is "viewing now" if they sent a heartbeat within this window. The
// client beats every ~30s, so 70s comfortably covers one missed beat.
const WINDOW_MS = 70_000;

// GET /api/presence — ADMIN-only. Lists the users currently viewing the portal
// (heartbeat within WINDOW_MS), most-recent first.
export async function GET() {
  const user = await getServerUser();
  // Real admins only — visible even while "viewing as" another role.
  if (!user || (user.realRole ?? user.role) !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const since = new Date(Date.now() - WINDOW_MS);
  const viewers = await prisma.user.findMany({
    where: { isActive: true, lastSeenAt: { gte: since } },
    select: { id: true, name: true, role: true, designation: true, lastSeenAt: true },
    orderBy: { lastSeenAt: 'desc' },
  });

  return NextResponse.json({ count: viewers.length, viewers, self: user.id });
}
