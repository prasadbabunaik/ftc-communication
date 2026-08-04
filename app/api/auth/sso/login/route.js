import { NextResponse } from 'next/server';
import { getEntraConfig, buildAuthorizeUrl, makePkce, randomToken, appOrigin } from '@/lib/entra';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/auth/sso/login — start the Entra ID OIDC login.
// Generates state + nonce + PKCE, stashes them in short-lived HttpOnly cookies,
// and 302-redirects the browser to the Microsoft authorize endpoint.
export async function GET(req) {
  const c = getEntraConfig();
  if (!c) {
    return NextResponse.redirect(new URL('/login?sso_error=disabled', appOrigin(req)));
  }

  const state = randomToken();
  const nonce = randomToken();
  const { verifier, challenge } = makePkce();

  // ?silent=1 → attempt a no-UI sign-in (prompt=none). If the browser has an
  // active Microsoft session (the user is signed into Office 365 / on an
  // Entra-joined PC), Entra returns a code and the user is logged in with zero
  // interaction. Otherwise it returns an error and the callback quietly falls
  // back to the login form (see the sso_silent cookie below).
  const silent = new URL(req.url).searchParams.get('silent') === '1';

  const authorizeUrl = buildAuthorizeUrl(c, {
    state,
    nonce,
    codeChallenge: challenge,
    ...(silent ? { prompt: 'none' } : {}),
  });
  const res = NextResponse.redirect(authorizeUrl);

  const isProd = process.env.NODE_ENV === 'production';
  const cookieOpts = {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax', // must survive the top-level GET redirect back from Microsoft
    path: '/',
    maxAge: 600, // 10 minutes to complete the round-trip
  };
  res.cookies.set('sso_state', state, cookieOpts);
  res.cookies.set('sso_nonce', nonce, cookieOpts);
  res.cookies.set('sso_verifier', verifier, cookieOpts);
  // Lets the callback distinguish a silent attempt (fall back quietly) from an
  // interactive one (show a real error).
  if (silent) res.cookies.set('sso_silent', '1', cookieOpts);

  return res;
}
