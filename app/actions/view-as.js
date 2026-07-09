'use server';

// Admin-only "view as role" — sets a cookie that overlays the effective role
// for the current admin so they can check the portal from another role's
// perspective. Cleared to return to ADMIN. The overlay only ever takes effect
// when the REAL account is ADMIN (enforced in getServerUser / /api/auth/me), so
// a stray cookie on a non-admin session does nothing.

import { cookies } from 'next/headers';
import { getRealServerUser, VIEW_AS_ROLES } from '@/lib/server-auth';

const COOKIE = 'view_as_role';

export async function setViewAsRole(role) {
  const real = await getRealServerUser();
  if (!real) return { error: 'Session expired. Please log in again.' };
  if (real.role !== 'ADMIN') return { error: 'Only an Administrator can switch roles.' };

  const c = await cookies();
  if (!role || role === 'ADMIN') {
    c.delete(COOKIE);
    return { success: true, role: 'ADMIN' };
  }
  if (!VIEW_AS_ROLES.includes(role)) return { error: 'Invalid role.' };
  c.set(COOKIE, role, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8, // auto-expires after 8h so it can't linger indefinitely
  });
  return { success: true, role };
}

export async function clearViewAsRole() {
  const c = await cookies();
  c.delete(COOKIE);
  return { success: true };
}
