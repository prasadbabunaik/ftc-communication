import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireServerUser } from '@/lib/server-auth';

// ── GET /api/grid/snapshots/compare?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(request) {
  try {
    await requireServerUser(request);

    const { searchParams } = new URL(request.url);
    const fromDate = searchParams.get('from');
    const toDate   = searchParams.get('to');

    if (!fromDate || !toDate) {
      return NextResponse.json({ error: 'from and to query params required' }, { status: 400 });
    }

    const [fromSnap, toSnap] = await Promise.all([
      prisma.gridSnapshot.findUnique({ where: { snapshotDate: new Date(fromDate + 'T00:00:00Z') } }),
      prisma.gridSnapshot.findUnique({ where: { snapshotDate: new Date(toDate   + 'T00:00:00Z') } }),
    ]);

    if (!fromSnap) return NextResponse.json({ error: `No snapshot for ${fromDate}` }, { status: 404 });
    if (!toSnap)   return NextResponse.json({ error: `No snapshot for ${toDate}`   }, { status: 404 });

    const diff = {
      from: { date: fromDate, label: fromSnap.label },
      to:   { date: toDate,   label: toSnap.label   },
      t2:   diffT2(fromSnap.t2Json, toSnap.t2Json),
      t1:   diffT1(fromSnap.t1Json, toSnap.t1Json),
      t3:   diffT3(fromSnap.t3Json, toSnap.t3Json),
    };

    return NextResponse.json({ data: diff });
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error(e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// ── diff helpers ──────────────────────────────────────────────────────────────

const T2_FIELDS = [
  'totalCapacityMw', 'contd4CapacityMw', 'appliedMw',
  'ftcApprovedMw', 'ftcPendingMw',
  'tocIssuedMw', 'tocPendingMw',
  'codCompletedMw', 'codPendingMw', 'expectedMw',
];

function diffT2(fromMatrix, toMatrix) {
  const keys = new Set([...Object.keys(fromMatrix), ...Object.keys(toMatrix)]);
  const changes = [];
  for (const key of [...keys].sort()) {
    const a = fromMatrix[key] ?? {};
    const b = toMatrix[key]   ?? {};
    const deltas = {};
    let hasChange = false;
    for (const f of T2_FIELDS) {
      const va = Number(a[f] ?? 0);
      const vb = Number(b[f] ?? 0);
      const delta = Math.round((vb - va) * 100) / 100;
      deltas[f] = { from: va, to: vb, delta };
      if (Math.abs(delta) >= 0.01) hasChange = true;
    }
    if (hasChange) {
      const [region, source] = key.split('|');
      changes.push({ key, region, source, ...deltas });
    }
  }
  return changes;
}

function diffT1(fromData, toData) {
  const fromRows = fromData?.rows ?? [];
  const toRows   = toData?.rows   ?? [];
  const toMap = {};
  for (const r of toRows) toMap[`${r.region}|${r.source}`] = r;

  const changes = [];
  for (const a of fromRows) {
    if (a.isSubtotal || a.isTotal) continue;
    const key = `${a.region}|${a.source}`;
    const b = toMap[key];
    if (!b) continue;
    const totalDelta = Number(b.totalMw ?? 0) - Number(a.totalMw ?? 0);
    const monthKeys = new Set([...Object.keys(a.months ?? {}), ...Object.keys(b?.months ?? {})]);
    const monthDeltas = {};
    let hasMonthChange = false;
    for (const m of monthKeys) {
      const va = Number(a.months?.[m] ?? 0);
      const vb = Number(b?.months?.[m] ?? 0);
      const d  = Math.round((vb - va) * 100) / 100;
      monthDeltas[m] = { from: va, to: vb, delta: d };
      if (Math.abs(d) >= 0.01) hasMonthChange = true;
    }
    if (Math.abs(totalDelta) >= 0.01 || hasMonthChange) {
      changes.push({
        key, region: a.region, source: a.source,
        totalMw: { from: Number(a.totalMw ?? 0), to: Number(b?.totalMw ?? 0), delta: Math.round(totalDelta * 100) / 100 },
        months: monthDeltas,
      });
    }
  }
  return changes;
}

const T3_FIELDS = ['completedNo', 'completedKm', 'completedMva', 'pendingNo', 'pendingKm', 'pendingMva'];

function diffT3(fromMatrix, toMatrix) {
  const keys = new Set([...Object.keys(fromMatrix), ...Object.keys(toMatrix)]);
  const changes = [];
  for (const key of [...keys].sort()) {
    const a = fromMatrix[key] ?? {};
    const b = toMatrix[key]   ?? {};
    const deltas = {};
    let hasChange = false;
    for (const f of T3_FIELDS) {
      const va = Number(a[f] ?? 0);
      const vb = Number(b[f] ?? 0);
      const delta = Math.round((vb - va) * 100) / 100;
      deltas[f] = { from: va, to: vb, delta };
      if (Math.abs(delta) >= 0.01) hasChange = true;
    }
    if (hasChange) {
      const [region, cat] = key.split('|');
      changes.push({ key, region, category: cat, ...deltas });
    }
  }
  return changes;
}
