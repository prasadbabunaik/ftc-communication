import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireServerUser, getUserRegion } from '@/lib/server-auth';

// ── GET /api/grid/audit?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=N
//
// Entry-time audit trail: every recorded change to a project/phase/event
// (ProjectNote) or a transmission element (TransmissionAuditLog), positioned
// by its ENTRY date — `effectiveDate` when the change was back-dated by
// ADMIN/NLDC, otherwise `createdAt`. This answers "which change was made at
// what time", as opposed to the snapshot-diff which answers "how much
// FTC/TOC/COD moved by milestone date between two dates".
//
// Region scoping mirrors the compare route: ADMIN/NLDC see everything; the 5
// RLDC roles see only changes to entities in their own region.
export async function GET(request) {
  try {
    const user = await requireServerUser(request);
    const userRegion = await getUserRegion(user.role);   // null for ADMIN/NLDC
    const regionCode = userRegion?.code ?? null;

    const { searchParams } = new URL(request.url);
    const fromStr = searchParams.get('from');
    const toStr   = searchParams.get('to');
    const limit   = Math.min(parseInt(searchParams.get('limit') ?? '200', 10) || 200, 1000);

    // Entry window — inclusive of both ends (whole days, UTC).
    const fromTs = fromStr ? new Date(fromStr + 'T00:00:00.000Z') : null;
    const toTs   = toStr   ? new Date(toStr   + 'T23:59:59.999Z') : null;

    // We filter on COALESCE(effectiveDate, createdAt) in JS rather than SQL so
    // the back-dating fallback is consistent with how the rest of the app
    // resolves the "entry" timestamp. Pull a bounded superset, then filter.
    const [notes, txLogs] = await Promise.all([
      prisma.projectNote.findMany({
        where: regionCode ? { project: { region: { code: regionCode } } } : undefined,
        select: {
          id: true, field: true, oldValue: true, newValue: true, text: true,
          createdAt: true, effectiveDate: true, source: true,
          project: { select: { name: true, region: { select: { code: true } } } },
          user:    { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit * 2,
      }),
      prisma.transmissionAuditLog.findMany({
        where: regionCode ? { element: { region: { code: regionCode } } } : undefined,
        select: {
          id: true, action: true, field: true, oldValue: true, newValue: true,
          elementName: true, createdAt: true, effectiveDate: true,
          element: { select: { region: { select: { code: true } } } },
          user:    { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit * 2,
      }),
    ]);

    const entryTs = (e) => e.effectiveDate ?? e.createdAt;
    const inWindow = (e) => {
      const t = entryTs(e).getTime();
      if (fromTs && t < fromTs.getTime()) return false;
      if (toTs   && t > toTs.getTime())   return false;
      return true;
    };

    const rows = [
      ...notes.filter(inWindow).map((n) => ({
        id:           'n' + n.id,
        kind:         'PROJECT',
        entityName:   n.project?.name ?? '—',
        region:       n.project?.region?.code ?? null,
        field:        n.field,
        oldValue:     n.oldValue,
        newValue:     n.newValue,
        text:         n.text,
        userName:     n.user?.name ?? 'System',
        createdAt:    n.createdAt,
        effectiveDate: n.effectiveDate,
        backDated:    !!n.effectiveDate && n.effectiveDate.getTime() < n.createdAt.getTime(),
      })),
      ...txLogs.filter(inWindow).map((t) => ({
        id:           't' + t.id,
        kind:         'TRANSMISSION',
        entityName:   t.elementName ?? '—',
        region:       t.element?.region?.code ?? null,
        field:        t.field,
        oldValue:     t.oldValue,
        newValue:     t.newValue,
        text:         t.action,
        userName:     t.user?.name ?? 'System',
        createdAt:    t.createdAt,
        effectiveDate: t.effectiveDate,
        backDated:    !!t.effectiveDate && t.effectiveDate.getTime() < t.createdAt.getTime(),
      })),
    ]
      .sort((a, b) => entryTs(b).getTime() - entryTs(a).getTime())
      .slice(0, limit);

    return NextResponse.json({ data: rows, count: rows.length });
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[audit] error:', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
