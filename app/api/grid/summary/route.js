import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireServerUser, buildRegionScope } from '@/lib/server-auth';

export async function GET(request) {
  try {
    const user = await requireServerUser(request);
    const regionScope = await buildRegionScope(user.role);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Find project IDs in scope for commissioning phase queries
    const projectsInScope = await prisma.generationProject.findMany({
      where: regionScope,
      select: { id: true, totalCapacityMw: true, phases: { select: { codDeclaredMw: true } } },
    });
    const projectIds = projectsInScope.map((p) => p.id);

    const [
      contd4PendingCount,
      contd4TotalCount,
      ftcPendingAgg,
      codThisMonthAgg,
      txPendingCount,
      txTotalCount,
    ] = await Promise.all([
      prisma.contd4Application.count({
        where: { status: 'UNDER_PROCESS', project: regionScope },
      }),
      prisma.contd4Application.count({
        where: { project: regionScope },
      }),
      prisma.commissioningPhase.aggregate({
        where: { projectId: { in: projectIds } },
        _sum: { capacityUnderFtcMw: true },
      }),
      prisma.commissioningPhase.aggregate({
        where: {
          projectId: { in: projectIds },
          codDeclaredDate: { gte: startOfMonth },
        },
        _sum: { codDeclaredMw: true },
      }),
      prisma.transmissionElement.count({
        where: { pendingFtc: true, ...regionScope },
      }),
      prisma.transmissionElement.count({
        where: regionScope,
      }),
    ]);

    // Total commissioned capacity (COD) across all projects in scope
    const totalCodMw = projectsInScope.reduce((sum, p) => {
      return sum + p.phases.reduce((s, ph) => s + Number(ph.codDeclaredMw ?? 0), 0);
    }, 0);

    const totalCapacityMw = projectsInScope.reduce(
      (sum, p) => sum + Number(p.totalCapacityMw),
      0
    );

    return NextResponse.json({
      data: {
        contd4: { pending: contd4PendingCount, total: contd4TotalCount },
        generation: {
          totalProjectsMw: totalCapacityMw,
          commissionedMw: totalCodMw,
          pendingFtcMw: Number(ftcPendingAgg._sum.capacityUnderFtcMw ?? 0),
          codThisMonthMw: Number(codThisMonthAgg._sum.codDeclaredMw ?? 0),
        },
        transmission: { pending: txPendingCount, total: txTotalCount },
      },
    });
  } catch (e) {
    if (e.message === 'UNAUTHORIZED')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error(e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
