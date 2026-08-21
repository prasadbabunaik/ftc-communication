import { NextResponse } from 'next/server';
import { requireServerUser, isAdmin } from '@/lib/server-auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const FORMATS = new Set(['XLSX', 'PDF', 'PRINT']);

// Record one download / print. Any signed-in user (their downloads are what we
// audit); best-effort, never blocks the actual download client-side.
export async function POST(request) {
  let user;
  try { user = await requireServerUser(); }
  catch { return NextResponse.json({ error: 'Session expired.' }, { status: 401 }); }

  let body = {};
  try { body = await request.json(); } catch {}
  const label  = String(body.label ?? '').trim().slice(0, 200);
  const format = String(body.format ?? '').trim().toUpperCase();
  const meta   = body.meta != null ? String(body.meta).trim().slice(0, 500) : null;
  if (!label || !FORMATS.has(format)) {
    return NextResponse.json({ error: 'Invalid download log.' }, { status: 400 });
  }

  try {
    await prisma.downloadLog.create({
      // user.id / realRole reflect the true account even when an ADMIN is
      // "viewing as" another role, so the audit records who actually downloaded.
      data: { userId: user.id, label, format, meta: meta || null, roleAtTime: user.realRole ?? user.role },
    });
  } catch { /* logging must never break a download */ }

  return NextResponse.json({ ok: true });
}

// The download log — ADMIN ONLY. NLDC / RLDC (and an ADMIN "viewing as" another
// role) cannot see it.
export async function GET() {
  let user;
  try { user = await requireServerUser(); }
  catch { return NextResponse.json({ error: 'Session expired.' }, { status: 401 }); }
  if (!isAdmin(user.role)) {
    return NextResponse.json({ error: 'Administrator access required.' }, { status: 403 });
  }

  const logs = await prisma.downloadLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 300,
    include: { user: { select: { name: true, email: true, role: true } } },
  });

  return NextResponse.json({
    logs: logs.map((l) => ({
      id: l.id,
      label: l.label,
      format: l.format,
      meta: l.meta,
      roleAtTime: l.roleAtTime,
      createdAt: l.createdAt,
      user: l.user ? { name: l.user.name, email: l.user.email, role: l.user.role } : null,
    })),
  });
}
