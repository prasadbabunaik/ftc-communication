import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const plantTypes = await prisma.plantType.findMany({ orderBy: { label: 'asc' } });
  return NextResponse.json({ data: plantTypes });
}
