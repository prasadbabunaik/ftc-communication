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

    // Entry window in SQL (entry ts = effectiveDate when set, else createdAt).
    const dwin = {};
    if (fromTs) dwin.gte = fromTs;
    if (toTs)   dwin.lte = toTs;
    const windowFilter = (fromTs || toTs)
      ? { OR: [{ effectiveDate: dwin }, { effectiveDate: null, createdAt: dwin }] }
      : {};

    // Pull all windowed audit rows (this app's audit volume is small). They get
    // grouped into change EVENTS below; FETCH_CAP guards a pathological window.
    const FETCH_CAP = 5000;
    const [notes, txLogs] = await Promise.all([
      prisma.projectNote.findMany({
        where: { ...(regionCode ? { project: { region: { code: regionCode } } } : {}), ...windowFilter },
        select: {
          id: true, field: true, text: true, createdAt: true, effectiveDate: true,
          projectName: true,
          project: { select: { name: true, region: { select: { code: true } } } },
          user:    { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: FETCH_CAP,
      }),
      prisma.transmissionAuditLog.findMany({
        where: { ...(regionCode ? { element: { region: { code: regionCode } } } : {}), ...windowFilter },
        select: {
          id: true, action: true, field: true, elementName: true,
          createdAt: true, effectiveDate: true,
          element: { select: { region: { select: { code: true } } } },
          user:    { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: FETCH_CAP,
      }),
    ]);

    const entryTs = (e) => e.effectiveDate ?? e.createdAt;
    const flat = [
      ...notes.map((n) => ({
        kind: 'PROJECT', entityName: n.project?.name ?? n.projectName ?? '—',
        region: n.project?.region?.code ?? null, field: n.field,
        userName: n.user?.name ?? 'System', createdAt: n.createdAt, effectiveDate: n.effectiveDate,
      })),
      ...txLogs.map((t) => ({
        kind: 'TRANSMISSION', entityName: t.elementName ?? '—',
        region: t.element?.region?.code ?? null, field: t.field,
        userName: t.user?.name ?? 'System', createdAt: t.createdAt, effectiveDate: t.effectiveDate,
      })),
    ];

    // Group field-level rows into change EVENTS. A single save writes a summary
    // note PLUS one row per changed field, all sharing the same entity +
    // timestamp — so "number of changes" = distinct (entity, second), not the
    // raw row count (which made one edit look like many).
    const events = new Map();
    for (const e of flat) {
      const ts  = entryTs(e);
      const key = `${e.kind}|${e.entityName}|${ts.toISOString().slice(0, 19)}`;
      let g = events.get(key);
      if (!g) {
        g = {
          id: key, kind: e.kind, entityName: e.entityName, region: e.region,
          userName: e.userName, createdAt: e.createdAt, effectiveDate: e.effectiveDate,
          backDated: !!e.effectiveDate && e.effectiveDate.getTime() < e.createdAt.getTime(),
          changeCount: 0, fields: [],
        };
        events.set(key, g);
      }
      g.changeCount += 1;
      if (e.field && !g.fields.includes(e.field)) g.fields.push(e.field);
    }
    const eventList = [...events.values()].sort((a, b) => entryTs(b).getTime() - entryTs(a).getTime());

    // `total` = distinct change events in the window (the headline); `data` is
    // the preview list (capped); `count` = rows returned.
    const data = eventList.slice(0, limit);
    return NextResponse.json({ data, total: eventList.length, count: data.length });
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[audit] error:', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
