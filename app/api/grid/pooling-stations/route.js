import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireServerUser, buildRegionScope } from '@/lib/server-auth';

export async function GET(request) {
  let user;
  try {
    user = await requireServerUser(request);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const requestedRegionId = searchParams.get('regionId');

  // Enforce region scope: an xRLDC user may only list pooling stations
  // in their own region, regardless of what regionId they pass.
  const scope = await buildRegionScope(user.role);
  const effectiveRegionId = scope.regionId ?? requestedRegionId ?? undefined;

  if (scope.regionId && requestedRegionId && requestedRegionId !== scope.regionId) {
    return NextResponse.json({ error: 'Forbidden — cross-region access denied' }, { status: 403 });
  }

  const poolingStations = await prisma.poolingStation.findMany({
    where: effectiveRegionId ? { regionId: effectiveRegionId } : undefined,
    include: { region: { select: { code: true, name: true } } },
    orderBy: { name: 'asc' },
  });

  return NextResponse.json({ data: poolingStations });
}
