import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireServerUser, getUserRegion } from '@/lib/server-auth';

// Region list for dropdowns/filters. Region-scoped: an RLDC only ever gets its
// OWN region (so it can't see or select other regions anywhere this feeds);
// ADMIN/NLDC get all regions.
export async function GET(request) {
  let user;
  try {
    user = await requireServerUser(request);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userRegion = await getUserRegion(user.role); // null for ADMIN/NLDC
  const regions = await prisma.gridRegion.findMany({
    where: userRegion ? { id: userRegion.id } : undefined,
    orderBy: { code: 'asc' },
  });
  return NextResponse.json({ data: regions });
}
