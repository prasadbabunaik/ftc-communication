import { cookies } from 'next/headers';
import { verifyAccessToken } from './auth';
import { prisma } from './prisma';

// Maps granular RLDC role enum to GridRegion code.
// Returns null for NLDC/ADMIN — they query all regions.
const ROLE_TO_REGION = {
  SRLDC: 'SR',
  NRLDC: 'NR',
  ERLDC: 'ER',
  WRLDC: 'WR',
  NERLDC: 'NER',
};

export async function getServerUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get('access_token')?.value;
  if (!token) return null;
  try {
    const payload = await verifyAccessToken(token);
    return prisma.user.findUnique({
      where: { id: String(payload.sub), isActive: true },
    });
  } catch {
    return null;
  }
}

export async function requireServerUser() {
  const user = await getServerUser();
  if (!user) throw new Error('UNAUTHORIZED');
  return user;
}

// Returns a Prisma where-clause fragment for scoping queries to the user's region.
// NLDC/ADMIN get {} (no filter = all regions).
export async function buildRegionScope(userRole) {
  const code = ROLE_TO_REGION[userRole];
  if (!code) return {};
  const region = await prisma.gridRegion.findUnique({ where: { code } });
  // If somehow the region isn't in DB, return an impossible condition instead of leaking all data
  return region ? { regionId: region.id } : { regionId: '__none__' };
}

// Returns the GridRegion record for the current user, or null for NLDC/ADMIN
export async function getUserRegion(userRole) {
  const code = ROLE_TO_REGION[userRole];
  if (!code) return null;
  return prisma.gridRegion.findUnique({ where: { code } });
}

// Prisma WHERE fragment that filters records to those "active on date D".
//   asOf=null  → only currently-live rows (activeUntil IS NULL)
//   asOf=Date  → snapshot view: activeFrom <= D AND (activeUntil IS NULL OR activeUntil > D)
// Use on GenerationProject and TransmissionElement queries.
export function activePeriodFilter(asOf = null) {
  if (!asOf) return { activeUntil: null };
  return {
    activeFrom:  { lte: asOf },
    OR: [
      { activeUntil: null },
      { activeUntil: { gt: asOf } },
    ],
  };
}
