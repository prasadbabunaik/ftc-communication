import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { applySecurityHeaders } from './lib/security-headers';

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/refresh', '/api/auth/logout'];
const ACCESS_SECRET = new TextEncoder().encode(
  process.env.JWT_ACCESS_SECRET || 'ftc-access-secret-key-minimum-32-characters-long',
);

// Wrap a NextResponse-returning step so every response (continue / redirect)
// uniformly carries our security headers. Keeps the auth logic below readable.
function secureResponse(response, request) {
  return applySecurityHeaders(response, request);
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Allow public paths and Next.js internals
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

  // No tokens at all → redirect to login
  if (!accessToken && !refreshToken) {
    return secureResponse(NextResponse.redirect(new URL('/login', request.url)), request);
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
      return secureResponse(NextResponse.redirect(new URL('/login', request.url)), request);
    }
  }

  // Only refresh token present — let through, client will refresh
  if (refreshToken) {
    return secureResponse(NextResponse.next(), request);
  }

  return secureResponse(NextResponse.redirect(new URL('/login', request.url)), request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo-full.png|logo-icon.png).*)'],
};
