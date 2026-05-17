import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireServerUser } from '@/lib/server-auth';
import {
  computePipelineMatrix,
  computeContd4Study,
  computeTransmission,
} from '@/lib/grid-computations';

// ── GET /api/grid/snapshots ── list all snapshots (id, date, label).
// Pass ?changesOnly=1 to filter out dates whose pipeline / transmission /
// CONTD-4 content is identical to the previous date (i.e. "no real change").
export async function GET(request) {
  try {
    await requireServerUser(request);
    const url = new URL(request.url);
    const changesOnly = url.searchParams.get('changesOnly') === '1';

    if (!changesOnly) {
      const snapshots = await prisma.gridSnapshot.findMany({
        select: { id: true, snapshotDate: true, label: true, createdAt: true },
        orderBy: { snapshotDate: 'asc' },
      });
      return NextResponse.json({ data: snapshots });
    }

    // Pull full JSON to compare; serialise + hash each so we can detect dupes.
    const all = await prisma.gridSnapshot.findMany({
      select: { id: true, snapshotDate: true, label: true, createdAt: true, t1Json: true, t2Json: true, t3Json: true },
      orderBy: { snapshotDate: 'asc' },
    });
    const filtered = [];
    let prevHash = null;
    for (const s of all) {
      const h = JSON.stringify([s.t1Json, s.t2Json, s.t3Json]);
      if (h !== prevHash) {
        filtered.push({ id: s.id, snapshotDate: s.snapshotDate, label: s.label, createdAt: s.createdAt });
        prevHash = h;
      }
    }
    return NextResponse.json({ data: filtered });
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error(e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// ── POST /api/grid/snapshots ── create snapshot from current DB state
// Body: { snapshotDate: "YYYY-MM-DD", label?: "..." }
export async function POST(request) {
  try {
    const user = await requireServerUser(request);
    if (user.role !== 'ADMIN' && user.role !== 'NLDC') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const snapshotDate = body.snapshotDate
      ? new Date(body.snapshotDate + 'T00:00:00Z')
      : new Date();
    const label = body.label || null;

    // Load all projects + TX elements
    const [projects, txElements] = await Promise.all([
      prisma.generationProject.findMany({
        include: {
          region:         { select: { code: true } },
          plantType:      { select: { label: true, isHybrid: true } },
          poolingStation: { select: { name: true } },
          contd4:         true,
          phases:         true,
        },
      }),
      prisma.transmissionElement.findMany({
        include: { region: { select: { code: true } } },
      }),
    ]);

    const pipelineMatrix = computePipelineMatrix(projects);
    const { rows: contd4Rows, allMonths } = computeContd4Study(projects);
    const txMatrix = computeTransmission(txElements);

    const snapshot = await prisma.gridSnapshot.upsert({
      where:  { snapshotDate },
      create: { snapshotDate, label, t1Json: { rows: contd4Rows, allMonths }, t2Json: pipelineMatrix, t3Json: txMatrix },
      update: { label, t1Json: { rows: contd4Rows, allMonths }, t2Json: pipelineMatrix, t3Json: txMatrix },
    });

    return NextResponse.json({ data: snapshot }, { status: 201 });
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error(e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
