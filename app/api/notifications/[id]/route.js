import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireServerUser } from '@/lib/server-auth';

// PATCH /api/notifications/:id  → mark a single notification as read
// Body: { isRead?: boolean } (defaults true)
export async function PATCH(request, { params }) {
  let user;
  try { user = await requireServerUser(request); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const isRead = body.isRead !== false;

  // Owner-only — Prisma's updateMany with the userId filter prevents an IDOR.
  const result = await prisma.notification.updateMany({
    where: { id, userId: user.id },
    data:  { isRead, readAt: isRead ? new Date() : null },
  });
  if (result.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}

// DELETE /api/notifications/:id  → remove from the user's feed
export async function DELETE(request, { params }) {
  let user;
  try { user = await requireServerUser(request); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  const { id } = await params;
  const result = await prisma.notification.deleteMany({
    where: { id, userId: user.id },
  });
  if (result.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
