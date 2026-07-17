import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { clearAuthCookies } from '@/lib/auth';
import { recordAuthActivity } from '@/lib/auth-activity';

export async function POST(request) {
  try {
    const refreshToken = request.cookies.get('refresh_token')?.value;

    if (refreshToken) {
      // Resolve the owning user BEFORE the token is deleted so we can attribute
      // the logout in the audit trail (best-effort; never blocks the flow).
      const stored = await prisma.refreshToken.findFirst({
        where: { token: refreshToken }, select: { userId: true },
      });
      if (stored?.userId) {
        await recordAuthActivity({ userId: stored.userId, action: 'LOGOUT', request });
      }
      await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    }

    const response = NextResponse.json({ message: 'Logged out successfully' });
    clearAuthCookies(response);

    return response;
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
