import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireServerUser, getUserRegion } from '@/lib/server-auth';

// ── GET /api/grid/snapshots/compare?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Region scoping: snapshots are stored globally (one row covers every region)
// so the diff has to be filtered server-side to the caller's region. ADMIN /
// NLDC see everything; the 5 RLDC roles see only their own region's rows.
// This mirrors buildRegionScope() applied to the live-data queries elsewhere.
export async function GET(request) {
  try {
    const user = await requireServerUser(request);
    const userRegion = await getUserRegion(user.role);  // null for ADMIN/NLDC
    const regionCode = userRegion?.code ?? null;

    const { searchParams } = new URL(request.url);
    const fromDate = searchParams.get('from');
    const toDate   = searchParams.get('to');

    if (!fromDate || !toDate) {
      return NextResponse.json({ error: 'from and to query params required' }, { status: 400 });
    }

    // Snapshots are written only on change-points, so a picked date with no
    // snapshot row is semantically equivalent to the most recent snapshot on
    // or before it. Resolve each side to its effective snapshot.
    const [fromSnap, toSnap] = await Promise.all([
      prisma.gridSnapshot.findFirst({
        where: { snapshotDate: { lte: new Date(fromDate + 'T23:59:59.999Z') } },
        orderBy: { snapshotDate: 'desc' },
      }),
      prisma.gridSnapshot.findFirst({
        where: { snapshotDate: { lte: new Date(toDate + 'T23:59:59.999Z') } },
        orderBy: { snapshotDate: 'desc' },
      }),
    ]);

    // "No snapshot for the requested date" is a valid steady-state outcome
    // (e.g. the system has only ever recorded today's baseline). We respond
    // 200 with data:null + a `missing` marker so callers can render an
    // empty-state banner without the browser logging a red 404 in DevTools.
    if (!fromSnap) {
      return NextResponse.json({
        data: null,
        missing: 'from',
        error: `No snapshot on or before ${fromDate}`,
      });
    }
    if (!toSnap) {
      return NextResponse.json({
        data: null,
        missing: 'to',
        error: `No snapshot on or before ${toDate}`,
      });
    }

    const effectiveFrom = fromSnap.snapshotDate.toISOString().slice(0, 10);
    const effectiveTo   = toSnap.snapshotDate.toISOString().slice(0, 10);
    const sameSnapshot  = fromSnap.id === toSnap.id;

    const diff = {
      from: { date: fromDate, effectiveDate: effectiveFrom, label: fromSnap.label },
      to:   { date: toDate,   effectiveDate: effectiveTo,   label: toSnap.label   },
      // When both sides resolve to the same snapshot, no data changed between
      // the picked dates — short-circuit to empty diffs without running the
      // (unnecessary) field-by-field comparison.
      t2: sameSnapshot ? [] : filterByRegion(diffT2(fromSnap.t2Json, toSnap.t2Json), regionCode),
      t1: sameSnapshot ? [] : filterByRegion(diffT1(fromSnap.t1Json, toSnap.t1Json), regionCode),
      t3: sameSnapshot ? [] : filterByRegion(diffT3(fromSnap.t3Json, toSnap.t3Json), regionCode),
    };

    return NextResponse.json({ data: diff });
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error(e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// Drop rows that don't belong to `regionCode`. Null regionCode means "no scope"
// (ADMIN / NLDC) and returns the array unchanged. Every diff row produced by
// diffT1 / diffT2 / diffT3 carries a `region` field — that's what we match on.
function filterByRegion(rows, regionCode) {
  if (!regionCode) return rows;
  return rows.filter(r => r.region === regionCode);
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
