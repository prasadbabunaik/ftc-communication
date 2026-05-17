import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireServerUser } from '@/lib/server-auth';

// GET /api/notifications  → list current user's notifications
// Query params:
//   ?limit=N          (default 30, max 100)
//   ?unreadOnly=1     return only unread
//   ?since=ISO        only items strictly newer than ISO timestamp
//
// Response shape: { data: [...], unreadCount: <number> }
export async function GET(request) {
  let user;
  try { user = await requireServerUser(request); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  const url = new URL(request.url);
  const limit      = Math.min(parseInt(url.searchParams.get('limit') ?? '30', 10) || 30, 100);
  const unreadOnly = url.searchParams.get('unreadOnly') === '1';
  const since      = url.searchParams.get('since');

  const where = { userId: user.id };
  if (unreadOnly) where.isRead = false;
  if (since) {
    const d = new Date(since);
    if (!isNaN(d.getTime())) where.createdAt = { gt: d };
  }

  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    prisma.notification.count({ where: { userId: user.id, isRead: false } }),
  ]);

  return NextResponse.json({ data: items, unreadCount });
}
