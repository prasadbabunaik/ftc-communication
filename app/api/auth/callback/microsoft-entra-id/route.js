import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { signAccessToken, signRefreshToken, setAuthCookies } from '@/lib/auth';
import {
  getEntraConfig,
  exchangeCodeForTokens,
  validateIdToken,
  emailFromClaims,
  fetchGraphProfile,
  appOrigin,
} from '@/lib/entra';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function clearTransientCookies(res) {
  for (const name of ['sso_state', 'sso_nonce', 'sso_verifier']) {
    res.cookies.set(name, '', { path: '/', maxAge: 0 });
  }
}

function fail(req, reason) {
  console.warn(`[SSO_CALLBACK] fail reason=${reason}`);
  const res = NextResponse.redirect(new URL(`/login?sso_error=${reason}`, appOrigin(req)));
  clearTransientCookies(res);
  return res;
}

// GET /api/auth/callback/microsoft-entra-id — Entra redirects here with ?code & ?state.
// Validates the round-trip, exchanges the code, maps the Entra identity to a
// portal User (by email), and issues the SAME JWT session the password login
// uses. Roles come from the User table — Entra only proves identity.
export async function GET(req) {
  const c = getEntraConfig();
  if (!c) return fail(req, 'disabled');

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  const cookieHeader = req.headers.get('cookie') || '';
  const jar = Object.fromEntries(
    cookieHeader.split(';').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), decodeURIComponent(p.slice(i + 1).trim())];
    }),
  );

  if (oauthError) return fail(req, 'denied');
  if (!code || !state) return fail(req, 'invalid');

  // 1. CSRF: the state echoed back must match the one we set before redirecting.
  const expectedState = jar['sso_state'];
  const nonce = jar['sso_nonce'];
  const verifier = jar['sso_verifier'];
  if (!expectedState || !nonce || !verifier || state !== expectedState) {
    return fail(req, 'state');
  }

  // 2. Exchange the auth code (PKCE verifier + client secret) for tokens.
  let claims;
  let graph = null;
  try {
    const tokens = await exchangeCodeForTokens(c, code, verifier);
    claims = validateIdToken(tokens.id_token, c, nonce);
    // Pull the signed-in user's Graph profile (name + jobTitle) to sync from Entra.
    graph = await fetchGraphProfile(tokens.access_token);
  } catch (e) {
    console.error('[SSO_CALLBACK] token/validation error:', e?.message || e);
    return fail(req, 'token');
  }

  // 3. Map the Entra identity to a portal user (by email). No auto-provisioning:
  //    only pre-registered users can sign in, with their assigned role.
  const email = emailFromClaims(claims);
  if (!email) return fail(req, 'noemail');

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  });
  if (!user) {
    console.warn(`[SSO_CALLBACK] no portal account for ${email}`);
    return fail(req, 'notfound');
  }
  if (!user.isActive) return fail(req, 'disabled_account');

  // 3b. Sync display name + designation from Entra (Graph profile, else id_token
  //     name). Role is NEVER taken from Entra — it stays whatever the portal set.
  const entraName = (graph?.displayName || claims.name || '').trim();
  const entraDesignation = (graph?.jobTitle || '').trim();
  const update = {};
  if (entraName && entraName !== user.name) update.name = entraName;
  if (entraDesignation && entraDesignation !== user.designation) update.designation = entraDesignation;
  if (Object.keys(update).length) {
    try { await prisma.user.update({ where: { id: user.id }, data: update }); Object.assign(user, update); }
    catch (e) { console.warn('[SSO_CALLBACK] profile sync skipped:', e?.message || e); }
  }

  // 4. Issue the same JWT session the password login creates.
  const payload = { sub: user.id, email: user.email, role: user.role, name: user.name };
  const accessToken = await signAccessToken(payload);
  const refreshToken = await signRefreshToken(payload);
  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  // The client AuthProvider hydrates from /api/auth/me on load, so a plain
  // redirect with the auth cookies set logs the user straight in.
  const res = NextResponse.redirect(new URL('/dashboard', appOrigin(req)));
  setAuthCookies(res, accessToken, refreshToken);
  clearTransientCookies(res);
  console.log(`[SSO_CALLBACK] success: ${user.email} (${user.role})`);
  return res;
}
