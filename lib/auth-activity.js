import { prisma } from '@/lib/prisma';

// Best-effort recorder for the login/logout audit trail. Recording must NEVER
// block or fail the auth flow, so every write is wrapped and errors are only
// logged. `request` (a NextRequest) is optional — when passed we derive the
// client IP + user agent from it.
export async function recordAuthActivity({ userId, action, method = null, request = null }) {
  if (!userId || !action) return;
  let ipAddress = null;
  let userAgent = null;
  try {
    if (request) {
      const h = request.headers;
      ipAddress =
        (h.get('x-forwarded-for') || '').split(',')[0].trim() ||
        h.get('x-real-ip') ||
        null;
      userAgent = (h.get('user-agent') || '').slice(0, 400) || null;
    }
    await prisma.authActivity.create({
      data: { userId, action, method, ipAddress, userAgent },
    });
  } catch (e) {
    console.error('[auth-activity] record failed:', e?.message);
  }
}
