import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/refresh', '/api/auth/logout'];
const ACCESS_SECRET = new TextEncoder().encode(
  process.env.JWT_ACCESS_SECRET || 'ftc-access-secret-key-minimum-32-characters-long',
);

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Allow public paths and Next.js internals
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  const accessToken = request.cookies.get('access_token')?.value;
  const refreshToken = request.cookies.get('refresh_token')?.value;

  // No tokens at all → redirect to login
  if (!accessToken && !refreshToken) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Try to verify access token
  if (accessToken) {
    try {
      await jwtVerify(accessToken, ACCESS_SECRET);
      return NextResponse.next();
    } catch {
      // Access token expired — if refresh token exists, let the request through.
      // The client-side AuthProvider will call /api/auth/refresh automatically.
      if (refreshToken) {
        return NextResponse.next();
      }
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  // Only refresh token present — let through, client will refresh
  if (refreshToken) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo-full.png|logo-icon.png).*)'],
};
