# E2E Tests

Playwright-driven end-to-end tests for the FTC Communication Portal. Tests run
against a live `next dev` server and the dev Postgres DB seeded with the users
in [prisma/seed.js](../prisma/seed.js).

## One-time setup

```bash
npm install                       # installs @playwright/test (already in devDeps)
npx playwright install chromium   # downloads the headless Chromium binary
npm run db:migrate                # ensures schema is up to date
npm run db:seed                   # seeds the 7 role users + regions + plant types
```

> The tests assume the seed credentials in [helpers/users.js](helpers/users.js)
> exist in the DB. If you change `prisma/seed.js`, update that file to match.

## Run

```bash
npm run test:e2e          # headless, all specs
npm run test:e2e:headed   # see the browser
npm run test:e2e:ui       # Playwright's interactive UI mode
npm run test:e2e:report   # open the last HTML report

# Single file / single test:
npx playwright test tests/auth.spec.js
npx playwright test -g "logout clears cookies"
```

`playwright.config.js` auto-starts `next dev` on port 3000 and reuses an
existing dev server if one is already running (useful while iterating).

## Spec map

| Spec | Coverage |
|---|---|
| `auth.spec.js` | Login form validation, success/failure, logout, route protection, HttpOnly cookies, API login for all 7 roles. |
| `rbac.spec.js` | "All India view" for ADMIN/NLDC, "Showing your region" for 5 RLDCs. `/dashboard/users` admin-only. |
| `dashboard.spec.js` | All 8 dashboard tabs render and switch, 6 stat cards present, AsOfDatePicker calendar opens, LastChangesCard mounts. |
| `pages.spec.js` | Smoke for `/ftc`, `/hybrid-ftc`, `/contd4`, `/transmission`, `/generation`, `/import`, `/dashboard/print`. |
| `snapshots.spec.js` | `/api/grid/snapshots` GET + `?changesOnly=1` dedupe, `/snapshots/compare`, "Compare two same dates" UX error, RLDC cannot POST snapshots. |
| `api-security.spec.js` | 401 on every protected route without auth, injection-payload fuzz on date params, RLDC vs NLDC region scoping, Set-Cookie HttpOnly, no secret leakage in `/api/auth/me`. |

## Conventions

- One spec file per surface area (auth, rbac, dashboard, etc.).
- Tests are run **serially** (`fullyParallel: false`, `workers: 1`) because they
  share the dev DB. If you set up a per-worker test DB, flip this in
  `playwright.config.js`.
- Auth is done via the JSON API (`loginAs(page, 'ADMIN')`) to avoid racing the
  login UI in every test. `loginViaForm()` is reserved for the auth spec.
- Tests **do not mutate** non-trivially. CRUD coverage (create/edit/delete a
  project, run a real Excel import) is intentionally out of scope here; layer
  it on top with a transactional fixture or dedicated test DB.

## Skipped scenarios — what's not covered

- **Excel import end-to-end** — needs a sample `.xlsx` and validated post-import
  DB state; smoke test only.
- **CRUD writes** — would dirty the dev DB; out of scope for this layer.
- **DAST scanning** (OWASP ZAP, Burp, sqlmap) — these are dynamic scanners that
  need a long-running target. Use `api-security.spec.js` as a static probe;
  run a real DAST tool against a staging URL when you need depth.
- **Network/infra** — TLS config, CSP, HSTS, deployment hardening — those
  belong to a deployment-time test against the prod URL.
- **Visual regression** — not configured. Add `expect(page).toHaveScreenshot()`
  to specific tests if you want pixel-locked UI checks.

## CI

The config emits an HTML report under `playwright-report/` and traces +
screenshots + videos for failed tests under `test-results/`. Both are
git-ignored. To wire into CI, run:

```bash
CI=1 npm run test:e2e
```

`CI=1` flips on a fresh `next dev` (no `reuseExistingServer`) and enables one
retry per failing test.
