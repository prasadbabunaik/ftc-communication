import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireServerUser } from '@/lib/server-auth';

// POST /api/notifications/read-all  → mark every unread notification as read
export async function POST(request) {
  let user;
  try { user = await requireServerUser(request); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  const result = await prisma.notification.updateMany({
    where: { userId: user.id, isRead: false },
    data:  { isRead: true, readAt: new Date() },
  });
  return NextResponse.json({ success: true, marked: result.count });
}
