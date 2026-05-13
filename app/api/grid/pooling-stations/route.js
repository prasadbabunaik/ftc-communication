import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const regionId = searchParams.get('regionId');

  const poolingStations = await prisma.poolingStation.findMany({
    where: regionId ? { regionId } : undefined,
    include: { region: { select: { code: true, name: true } } },
    orderBy: { name: 'asc' },
  });

  return NextResponse.json({ data: poolingStations });
}
