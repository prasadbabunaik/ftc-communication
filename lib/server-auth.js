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

// Permission helpers (must match the matrix in AccessControlClient.jsx).
// NLDC is read-only across the portal except for "Mark as Cleared" and
// project notes; everyone else with a region scope can edit their own data.
const EDIT_ROLES   = new Set(['ADMIN', 'SRLDC', 'NRLDC', 'ERLDC', 'WRLDC', 'NERLDC']);
const ADMIN_ONLY   = new Set(['ADMIN']);

export function canEditGridData(role) { return EDIT_ROLES.has(role); }
export function isAdmin(role)         { return ADMIN_ONLY.has(role); }

// Prisma WHERE fragment that filters records to those "active on date D".
//   asOf=null  → only currently-live rows (activeUntil IS NULL)
//   asOf=Date  → include projects not yet deactivated by D. We deliberately
//     don't filter by `activeFrom <= D` because that field stores the
//     data-entry timestamp, not the project's real-world start date — many
//     projects were seeded after they actually went live in the grid, so
//     enforcing it would hide all of them from historical views.
// Use on GenerationProject and TransmissionElement queries.
export function activePeriodFilter(asOf = null) {
  if (!asOf) return { activeUntil: null };
  return {
    OR: [
      { activeUntil: null },
      { activeUntil: { gt: asOf } },
    ],
  };
}
