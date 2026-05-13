import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const regions = await prisma.gridRegion.findMany({ orderBy: { code: 'asc' } });
  return NextResponse.json({ data: regions });
}
