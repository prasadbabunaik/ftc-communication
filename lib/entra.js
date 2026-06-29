// ── Microsoft Entra ID (Azure AD) SSO — OIDC authorization-code flow ────────
// Single-tenant SSO for grid-india.in. Entra handles AUTHENTICATION only; the
// app's own User table remains the source of ROLE (ADMIN/NLDC/<RLDC>). A
// signed-in Entra user is matched to a User row by email — only pre-provisioned
// users can sign in, and they get exactly the role the portal assigned them.
//
// Confidential web-app flow with PKCE (S256), state and nonce:
//   1. /api/auth/sso/login                       → redirect to Entra authorize
//   2. Entra → /api/auth/callback/microsoft-entra-id?code&state
//   3. exchange code (+ client secret + PKCE verifier) for tokens
//   4. validate the id_token claims, read the email, map to a User, issue session
//
// Config (never hardcode secrets) — all from env:
//   ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, ENTRA_REDIRECT_URI
import crypto from 'crypto';

export function getEntraConfig() {
  const tenantId = (process.env.ENTRA_TENANT_ID || '').trim();
  const clientId = (process.env.ENTRA_CLIENT_ID || '').trim();
  const clientSecret = process.env.ENTRA_CLIENT_SECRET || '';
  const redirectUri = (process.env.ENTRA_REDIRECT_URI || '').trim();
  if (!tenantId || !clientId || !clientSecret || !redirectUri) return null;
  return {
    tenantId,
    clientId,
    clientSecret,
    redirectUri,
    authority: `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}`,
  };
}

export function isSsoConfigured() {
  return getEntraConfig() !== null;
}

// Public origin for building browser-facing redirect URLs. Behind a reverse
// proxy, req.url is the INTERNAL address, so prefer the configured public origin
// (the origin of ENTRA_REDIRECT_URI), then proxy headers, then req.url.
export function appOrigin(req) {
  const c = getEntraConfig();
  if (c?.redirectUri) {
    try { return new URL(c.redirectUri).origin; } catch { /* fall through */ }
  }
  const proto = req.headers.get('x-forwarded-proto');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  if (host) return `${proto || 'https'}://${host}`;
  try { return new URL(req.url).origin; } catch { return ''; }
}

// ── PKCE + random helpers ────────────────────────────────────────────────────
const b64url = (buf) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function randomToken(bytes = 32) {
  return b64url(crypto.randomBytes(bytes));
}

export function makePkce() {
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// Scopes: OIDC (openid/profile/email) for the id_token + User.Read so the
// returned access_token can read the signed-in user's Graph profile (name,
// jobTitle, department) at login. User.Read is delegated + already consented.
export const ENTRA_SCOPE = 'openid profile email User.Read';

// ── Authorize URL ────────────────────────────────────────────────────────────
export function buildAuthorizeUrl(c, opts) {
  const params = new URLSearchParams({
    client_id: c.clientId,
    response_type: 'code',
    redirect_uri: c.redirectUri,
    response_mode: 'query',
    scope: ENTRA_SCOPE,
    state: opts.state,
    nonce: opts.nonce,
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
  });
  if (opts.loginHint) params.set('login_hint', opts.loginHint);
  if (opts.prompt) params.set('prompt', opts.prompt);
  return `${c.authority}/oauth2/v2.0/authorize?${params.toString()}`;
}

// ── Code → token exchange ────────────────────────────────────────────────────
export async function exchangeCodeForTokens(c, code, codeVerifier) {
  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: c.redirectUri,
    code_verifier: codeVerifier,
    scope: ENTRA_SCOPE,
  });
  const res = await fetch(`${c.authority}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.id_token) {
    const detail = json?.error_description || json?.error || `HTTP ${res.status}`;
    throw new Error(`Entra token exchange failed: ${detail}`);
  }
  return json;
}

// ── id_token decode + claim validation ───────────────────────────────────────
// The id_token comes directly from Microsoft over a server-to-server HTTPS
// exchange (confidential client), so the transport authenticates the issuer; we
// still validate the security-relevant claims.
export function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed id_token');
  const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateIdToken(idToken, c, expectedNonce) {
  const claims = decodeJwtPayload(idToken);
  if (claims.aud !== c.clientId) throw new Error('id_token audience mismatch');
  if (!claims.iss || !claims.iss.startsWith('https://login.microsoftonline.com/')) {
    throw new Error('id_token issuer not trusted');
  }
  if (GUID_RE.test(c.tenantId) && claims.tid && claims.tid !== c.tenantId) {
    throw new Error('id_token tenant mismatch');
  }
  if (expectedNonce !== undefined && (!claims.nonce || claims.nonce !== expectedNonce)) {
    throw new Error('id_token nonce mismatch');
  }
  if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) {
    throw new Error('id_token expired');
  }
  return claims;
}

// The grid-india UPN is the user's email; fall back across the usual claims.
export function emailFromClaims(claims) {
  return (claims.preferred_username || claims.email || claims.upn || '').trim().toLowerCase();
}

// ── ROPC (Resource Owner Password Credentials) ───────────────────────────────
// Validates a typed email + password directly against Entra AD (grant_type=
// password) instead of a local bcrypt hash. Returns the id_token claims on
// success. NOTE: Entra blocks this grant for accounts with MFA / Conditional
// Access that requires interaction — those users must use the interactive
// "Sign in with Microsoft" button instead. Distinct error codes let the login
// route guide the user.
export class EntraAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // 'INVALID' | 'MFA_REQUIRED' | 'NOT_FOUND' | 'DISABLED' | 'ERROR'
  }
}

export async function entraPasswordLogin(c, email, password) {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: c.clientId,
    client_secret: c.clientSecret,
    scope: 'openid profile email',
    username: email,
    password,
  });

  let json = {};
  try {
    const res = await fetch(`${c.authority}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    json = await res.json().catch(() => ({}));
    if (res.ok && json?.id_token) {
      return validateIdToken(json.id_token, c); // no nonce in ROPC
    }
  } catch {
    throw new EntraAuthError('ERROR', 'Could not reach Microsoft Entra to verify credentials.');
  }

  const desc = json?.error_description || json?.error || '';
  if (/AADSTS50076|AADSTS50079|AADSTS50158|interaction_required/i.test(desc)) {
    throw new EntraAuthError('MFA_REQUIRED',
      'This account requires multi-factor sign-in. Please use the “Sign in with Microsoft” button.');
  }
  if (/AADSTS50034|AADSTS50059/i.test(desc)) {
    throw new EntraAuthError('NOT_FOUND', 'No such Microsoft account in this organization.');
  }
  if (/AADSTS50057|AADSTS50055|AADSTS50053/i.test(desc)) {
    throw new EntraAuthError('DISABLED', 'This account is disabled, locked, or its password has expired.');
  }
  // AADSTS50126 (bad password) and anything else → generic invalid credentials.
  throw new EntraAuthError('INVALID', 'Invalid email or password.');
}

// Fetch the signed-in user's Microsoft Graph profile (delegated User.Read) so we
// can sync their display name + designation (jobTitle) from Entra at login.
// Returns null on any failure — callers fall back to the stored values.
export async function fetchGraphProfile(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch(
      'https://graph.microsoft.com/v1.0/me?$select=displayName,jobTitle,department,givenName,surname,mail,userPrincipalName',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
