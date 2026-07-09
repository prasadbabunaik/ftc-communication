import { NextResponse } from 'next/server';
import { verifyAccessToken } from '@/lib/auth';

export async function GET(request) {
  try {
    const accessToken = request.cookies.get('access_token')?.value;

    if (!accessToken) {
      return NextResponse.json({ message: 'Not authenticated' }, { status: 401 });
    }

    const payload = await verifyAccessToken(accessToken);

    // "View as role" overlay — only a real ADMIN can impersonate another role.
    const VIEW_AS_ROLES = ['NLDC', 'SRLDC', 'NRLDC', 'ERLDC', 'WRLDC', 'NERLDC'];
    let role = payload.role;
    let impersonating = false;
    if (payload.role === 'ADMIN') {
      const viewAs = request.cookies.get('view_as_role')?.value;
      if (viewAs && VIEW_AS_ROLES.includes(viewAs)) { role = viewAs; impersonating = true; }
    }

    return NextResponse.json({
      user: {
        id: payload.sub,
        name: payload.name,
        email: payload.email,
        role,
        realRole: payload.role,
        impersonating,
      },
    });
  } catch {
    return NextResponse.json({ message: 'Invalid or expired token' }, { status: 401 });
  }
}
