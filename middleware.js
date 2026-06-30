import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { applySecurityHeaders } from './lib/security-headers';

const PUBLIC_PATHS = [
  '/login', '/api/auth/login', '/api/auth/refresh', '/api/auth/logout',
  // Microsoft Entra SSO round-trip — must be reachable before a session exists.
  '/api/auth/sso', '/api/auth/callback',
];
// No hardcoded fallback: the signing secret must come from the environment.
// If it is unset, verification below fails closed (requests redirect to login)
// rather than silently trusting a well-known default secret.
if (!process.env.JWT_ACCESS_SECRET) {
  console.error('[middleware] JWT_ACCESS_SECRET is not set — all sessions will be rejected.');
}
const ACCESS_SECRET = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET || '');

// Wrap a NextResponse-returning step so every response (continue / redirect)
// uniformly carries our security headers. Keeps the auth logic below readable.
function secureResponse(response, request) {
  return applySecurityHeaders(response, request);
}

// Unauthenticated handling: API routes get a JSON 401 (so programmatic clients
// and the security test-suite see a real auth failure, not an HTML login page),
// while page navigations are redirected to /login.
function rejectUnauth(request, pathname) {
  if (pathname.startsWith('/api/')) {
    return secureResponse(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      request,
    );
  }
  const redirect = NextResponse.redirect(new URL('/login', request.url));
  // Redirects have no body; set an explicit Content-Type so scanners don't flag
  // a missing one (paired with the X-Content-Type-Options: nosniff we add).
  redirect.headers.set('Content-Type', 'text/plain; charset=utf-8');
  return secureResponse(redirect, request);
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Allow public paths and Next.js internals. NOTE: the `.` check only skips
  // genuine static assets — every API route and page in this app is dot-free,
  // so this does not expose protected data (handlers also call
  // requireServerUser as defense-in-depth).
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return secureResponse(NextResponse.next(), request);
  }

  const accessToken = request.cookies.get('access_token')?.value;
  const refreshToken = request.cookies.get('refresh_token')?.value;

  // No tokens at all → reject (401 for API, redirect for pages)
  if (!accessToken && !refreshToken) {
    return rejectUnauth(request, pathname);
  }

  // Try to verify access token
  if (accessToken) {
    try {
      await jwtVerify(accessToken, ACCESS_SECRET);
      return secureResponse(NextResponse.next(), request);
    } catch {
      // Access token expired — if refresh token exists, let the request through.
      // The client-side AuthProvider will call /api/auth/refresh automatically.
      if (refreshToken) {
        return secureResponse(NextResponse.next(), request);
      }
      return rejectUnauth(request, pathname);
    }
  }

  // Only refresh token present — let through, client will refresh
  if (refreshToken) {
    return secureResponse(NextResponse.next(), request);
  }

  return rejectUnauth(request, pathname);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo-full.png|logo-icon.png).*)'],
};
