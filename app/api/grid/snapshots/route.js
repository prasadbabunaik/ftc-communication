import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireServerUser } from '@/lib/server-auth';
import {
  computePipelineMatrix,
  computeContd4Study,
  computeTransmission,
} from '@/lib/grid-computations';

// ── GET /api/grid/snapshots ── list all snapshots (id, date, label)
export async function GET(request) {
  try {
    await requireServerUser(request);
    const snapshots = await prisma.gridSnapshot.findMany({
      select: { id: true, snapshotDate: true, label: true, createdAt: true },
      orderBy: { snapshotDate: 'asc' },
    });
    return NextResponse.json({ data: snapshots });
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
