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

// Roles an ADMIN may temporarily "view as" to check the portal from another
// role's perspective. ADMIN itself is excluded (it's the real identity).
export const VIEW_AS_ROLES = ['NLDC', 'SRLDC', 'NRLDC', 'ERLDC', 'WRLDC', 'NERLDC'];

// The signed-in account, ignoring any "view as" overlay. Use for authorising the
// impersonation switch itself (so an admin viewing as an RLDC can still switch
// back / change the view).
export async function getRealServerUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get('access_token')?.value;
  if (!token) return null;
  try {
    const payload = await verifyAccessToken(token);
    return prisma.user.findUnique({ where: { id: String(payload.sub), isActive: true } });
  } catch {
    return null;
  }
}

export async function getServerUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get('access_token')?.value;
  if (!token) return null;
  let payload;
  try { payload = await verifyAccessToken(token); }
  catch { return null; }
  const user = await prisma.user.findUnique({ where: { id: String(payload.sub), isActive: true } });
  if (!user) return null;
  // "View as role" overlay — only a real ADMIN can impersonate, and only a
  // lower/other role (never elevates). Everything downstream reads `role`, so
  // region scope + edit permissions + menus all follow the impersonated role.
  if (user.role === 'ADMIN') {
    const viewAs = cookieStore.get('view_as_role')?.value;
    if (viewAs && VIEW_AS_ROLES.includes(viewAs)) {
      return { ...user, role: viewAs, realRole: 'ADMIN', impersonating: true };
    }
  }
  return { ...user, realRole: user.role, impersonating: false };
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
// NLDC has national edit access (all regions — its region scope is {} so the
// per-region guard in the actions never blocks it); each RLDC edits only its
// own region; ADMIN edits everything.
const EDIT_ROLES   = new Set(['ADMIN', 'NLDC', 'SRLDC', 'NRLDC', 'ERLDC', 'WRLDC', 'NERLDC']);
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
