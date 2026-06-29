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

  const authorizeUrl = buildAuthorizeUrl(c, { state, nonce, codeChallenge: challenge });
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

  return res;
}
