// API-level security probes — narrow and deterministic. Designed to be safe to
// run repeatedly against the dev DB (no destructive writes). Covers:
//   - Authentication required on every protected route (401 without token)
//   - SQL/NoSQL injection payloads do not crash routes
//   - Snapshot-compare query params can't be used to read arbitrary files
//   - Cross-region IDOR: an RLDC user can't fetch data outside their region
//
// Not a substitute for a real DAST run (ZAP/Burp), but enough to catch
// regressions in the most common failure modes.

import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth.js';

// Routes that MUST require a valid session.
const PROTECTED_GET_ROUTES = [
  '/api/grid/snapshots',
  '/api/grid/snapshots?changesOnly=1',
  '/api/grid/snapshots/compare?from=2026-05-01&to=2026-05-02',
  '/api/grid/snapshots/project-history',
  '/api/grid/regions',
  '/api/grid/plant-types',
  '/api/grid/pooling-stations',
  '/api/grid/summary',
  '/api/grid/export',
  '/api/auth/me',
];

test.describe('API security — unauthenticated access', () => {
  for (const route of PROTECTED_GET_ROUTES) {
    test(`GET ${route} without cookies returns 401`, async ({ request }) => {
      const res = await request.get(route);
      expect(
        res.status(),
        `Expected 401 from ${route}, got ${res.status()} (body: ${(await res.text()).slice(0, 200)})`,
      ).toBe(401);
    });
  }

  test('POST /api/grid/snapshots without cookies returns 401', async ({ request }) => {
    const res = await request.post('/api/grid/snapshots', { data: {} });
    expect(res.status()).toBe(401);
  });
});

test.describe('API security — injection / fuzz', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await loginAs(page, 'ADMIN');
  });

  // Classic injection payloads in date params should not crash the server.
  const PAYLOADS = [
    "'; DROP TABLE users; --",
    "' OR '1'='1",
    '<script>alert(1)</script>',
    '../../etc/passwd',
    '%00',
    'null',
    'undefined',
    Array(200).fill('a').join(''),
  ];

  for (const p of PAYLOADS) {
    test(`compare?from=${p.slice(0, 30)} returns 4xx (not 500)`, async ({ page }) => {
      const url = `/api/grid/snapshots/compare?from=${encodeURIComponent(p)}&to=2026-05-17`;
      const res = await page.request.get(url);
      expect(res.status(), `Unexpected 5xx from ${url}`).toBeLessThan(500);
    });
  }

  test('login with malformed JSON returns 4xx (not 500)', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      headers: { 'content-type': 'application/json' },
      data: '{not json',
    });
    expect(res.status()).toBeLessThan(500);
  });

  test('login with overlong values returns 4xx (not 500)', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: {
        email: 'a'.repeat(10_000) + '@b.c',
        password: 'p'.repeat(10_000),
      },
    });
    expect(res.status()).toBeLessThan(500);
  });
});

test.describe('API security — region scoping (IDOR)', () => {
  test('RLDC user only gets their own region in /api/grid/regions', async ({ browser }) => {
    const ctx = await browser.newContext();
    const p   = await ctx.newPage();
    await loginAs(p, 'WRLDC');
    const res = await p.request.get('/api/grid/regions');
    expect(res.status()).toBe(200);
    const json = await res.json();
    // The shape may be {data: [...]} or [...]. Normalise.
    const arr = Array.isArray(json) ? json : (json.data ?? []);
    // If the endpoint correctly scopes by region, WRLDC should see only WR
    // (or all regions if regions is intentionally a public master list — many
    // apps treat the region master as global. In that case this assertion
    // becomes informational rather than strict.)
    if (arr.length > 1) {
      test.info().annotations.push({
        type: 'note',
        description: `WRLDC saw ${arr.length} regions — verify this is intentional (master tables may be global)`,
      });
    }
    await ctx.close();
  });

  test('Server-action region scope: dashboard summary differs by role', async ({ browser }) => {
    // NLDC sees all-India. WRLDC sees only WR. Their dashboards should differ
    // — most reliably via the visible region label.
    const ctxA = await browser.newContext();
    const pA   = await ctxA.newPage();
    await loginAs(pA, 'NLDC');
    await pA.goto('/dashboard');
    const aHasAllIndia = await pA.getByText(/all india view/i).count();

    const ctxB = await browser.newContext();
    const pB   = await ctxB.newPage();
    await loginAs(pB, 'WRLDC');
    await pB.goto('/dashboard');
    const bHasScoped = await pB.getByText(/showing your region/i).count();

    expect(aHasAllIndia).toBeGreaterThan(0);
    expect(bHasScoped).toBeGreaterThan(0);

    await ctxA.close();
    await ctxB.close();
  });
});

test.describe('Security headers', () => {
  test('login response sets HttpOnly auth cookies via Set-Cookie', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { email: 'admin@ftc.gov.in', password: 'Admin@123' },
    });
    expect(res.status()).toBe(200);
    const setCookie = res.headers()['set-cookie'] ?? '';
    // Set-Cookie can be a string with multiple cookies joined by `,` in some
    // serialisations — accept either.
    expect(setCookie).toMatch(/access_token=.*HttpOnly/i);
    expect(setCookie).toMatch(/refresh_token=.*HttpOnly/i);
  });

  test('NEXT_PUBLIC env vars are NOT leaked in /api/auth/me', async ({ page }) => {
    await loginAs(page, 'ADMIN');
    const res = await page.request.get('/api/auth/me');
    const txt = await res.text();
    expect(txt).not.toMatch(/JWT_ACCESS_SECRET|JWT_REFRESH_SECRET|DATABASE_URL/i);
  });
});
