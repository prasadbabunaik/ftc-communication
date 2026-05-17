import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireServerUser } from '@/lib/server-auth';

export async function GET(request) {
  try {
    await requireServerUser(request);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const regions = await prisma.gridRegion.findMany({ orderBy: { code: 'asc' } });
  return NextResponse.json({ data: regions });
}
