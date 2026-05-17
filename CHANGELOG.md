# Changelog

This file tracks notable changes to the FTC Communication Portal.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Dates use the IST calendar.

## [Unreleased] — 2026-05-17

### Added
- **Notifications system** — new `Notification` model (`prisma/migrations/20260517143825_add_notifications`) with `type`, `severity`, `title`, `body`, `link`, `metadata`, `isRead` fields. `lib/notifications.js` exposes `notifyRegion()` / `notifyAll()` / `notifyUser()` plus typed builders (`notifyProjectCreated`, `notifyContd4StatusChanged`, `notifyMilestoneEvent`, `notifyTransmissionUpdated`). Wired into the major server actions (project create, CONTD-4 clearance, FTC/TOC/COD events, transmission create). Recipient rules: ADMIN + NLDC always notified, RLDCs only for their own region, actor excluded from their own action. API routes: `GET /api/notifications`, `PATCH /api/notifications/[id]`, `DELETE /api/notifications/[id]`, `POST /api/notifications/read-all`.
- **Header notification bell** — replaces the static "3" badge. Polls `/api/notifications` every 30 s (paused on hidden tabs), surfaces an unread badge, popover dropdown with mark-read / delete / open-link, mark-all-read button. See [components/common/NotificationBell.jsx](components/common/NotificationBell.jsx).
- **Google reCAPTCHA v2** on the login form — `lib/recaptcha.js` for server-side `siteverify`, env vars `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` (public) + `RECAPTCHA_SECRET_KEY` (server). Verification skipped when either env var is unset, so dev environments without keys keep working.
- **Rate limiting** — `lib/rate-limit.js` in-memory sliding-window limiter. Login endpoint: per-IP (20/10 min) + per-email (10/10 min) + account lockout (5 wrong passwords → 15 min lock). Refresh endpoint: 60/min per-IP. 429 responses include `Retry-After`. See module header for the path to swap to Upstash Redis for multi-instance deployments.
- **Security response headers** — `lib/security-headers.js` applied by `middleware.js`: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (14 APIs disabled), `X-DNS-Prefetch-Control`, plus `Strict-Transport-Security` in production HTTPS only.
- **Playwright E2E test suite** — 74 tests across 6 specs in `tests/`: auth flow, RBAC, dashboard tabs, page smoke, snapshot compare, API security (401 on unauth, injection-payload fuzz, cross-region IDOR probe, HttpOnly Set-Cookie). `npm run test:e2e` auto-starts `next dev`.
- **Per-page export controls** — Excel + Print/PDF icons on `/ftc` and `/contd4` via new shared [components/grid/ExportButtons.jsx](components/grid/ExportButtons.jsx).
- **Sidebar default** — collapsed (hoverable) icon-rail by default. Existing user preferences in `localStorage` are honored.

### Changed
- **Snapshot storage is now always global** — previously the dashboard's auto-upsert wrote today's snapshot using the *current viewer's region-scoped data*, so an RLDC visit corrupted the global time-series with single-region data and the next admin visit saw a phantom "everything disappeared" diff. The upsert now runs a separate unscoped query and writes all-India data regardless of viewer. See [app/(protected)/dashboard/page.jsx](app/(protected)/dashboard/page.jsx).
- **Snapshot compare API filters by region** — `/api/grid/snapshots/compare` now applies `getUserRegion(role)` to the response so RLDCs see only their own region's deltas. ADMIN / NLDC get the unfiltered diff.
- **`availableSnapshots` deduplication** — dashboard page now dedupes consecutive identical snapshots by content hash before passing them to the client. Today's snapshot is always preserved (even if identical to yesterday) so the LastChangesCard can always anchor "from → today".
- **LastChangesCard default** — `from` now defaults to literal yesterday (today − 1 day) instead of the last change-point. Picking a historical date in the AsOf picker overrides as before.
- **Sticky-vertical region cell** on Pipeline (region & source-wise) and Hybrid Breakdown tables — the merged region badge stays pinned under the sticky thead while scrolling through that region's source rows. Uses `position: sticky` directly on the rowSpan'd `<td>` with `align-top` so it doesn't conflict with sticky `<tfoot>` column-width measurement.
- **Pipeline rowSpan bug fix** — the All India breakdown rows and the grand Total row all carry `region='All India'`, so `groupSize` was over-counting and stealing the Total row's first column (visible as a phantom 13th column where `4,623.92` rendered far to the right of the Exp May'26 body values). `groupSize` now stops at `isTotal`. See [components/grid/SummaryPageClient.jsx:139-147](components/grid/SummaryPageClient.jsx#L139-L147).
- **Print page is region-scoped** — `/dashboard/print` now passes `scopeRegionCode` + `scopeRegionName` from `getUserRegion(user.role)` to `PrintSummaryClient`. Header subtitle, "Grand Total" label, and per-source "All India X Total" footer all reflect the user's region. Redundant All India breakdown rows are filtered out for RLDC users.

### Fixed
- LastChangesCard / SnapshotCompareTab no longer surface phantom inter-region deltas to RLDC users (combination of snapshot-storage and compare-API fixes above).
- "Cannot read properties of undefined (reading 'call')" webpack runtime error from stale `.next/` cache after schema changes — resolved by clearing the cache; documented in dev workflow that `next build` should not be run while `next dev` is alive.

## [0.4.0] — 2026-05-14

### Added
- **Dashboard tabs**: Source-wise FTC pipeline (Table 5), Hybrid Breakdown component-level view (Table 4), Project Details, Day-wise Changes, Monthly COD.
- **CONTD-4 study breakdown**: hybrid sub-types (`Hybrid(Wind+Solar)`, `Hybrid(Solar+BESS)`, `Hybrid(Wind+Solar+BESS)`, `Hybrid(Solar+PSP)` …) shown as separate rows, matching the Excel `Summary` sheet.
- **Transmission "Commissioning Expected" column**: third column-pair (count + ckt km/MVA) showing elements expected to be commissioned in the reference month.
- **Hybrid component capacities**: `windCapacityMw`, `solarCapacityMw`, `bessCapacityMw` populated for all 15 cleared hybrid projects and surfaced in the Hybrid Breakdown table.
- **Snapshot audit logging**: `scripts/log-snapshot-changes.js` diffs Excel snapshots and writes `ProjectNote` SYSTEM entries — every TOC / COD / under-FTC / capacity change between 11/12/13 May 2026 now appears in the project audit feed.
- **Documentation set**: `README.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/DEPLOYMENT.md`, `docs/OPERATIONS.md`, this `CHANGELOG.md`.

### Changed
- **Pipeline source categorisation** in `getProjectSource()`:
  - PSP hybrids (`HYBRID_SP/WP/HP`) → use generation phase source (matches Excel).
  - Hybrids with all phases = `WIND` → categorised as `WIND` (handles SR Serentica, Zenataris).
  - All other hybrids → `HYBRID` (unchanged).
  This fixes the SR Hybrid discrepancy (previously +2,139 MW vs Excel).
- **COD Pending formula**: now `max(0, toc − cod − underTocMw)` instead of `max(0, toc − cod)`. Eliminates double-counting of capacity already tracked in TOC-pending.
- **Cache revalidation** in server actions: every project / phase / CONTD-4 / transmission mutation now correctly invalidates `/dashboard`, `/ftc`, `/hybrid-ftc`, `/contd4`, `/generation` (and `/transmission` where applicable). Six previously bug-prone actions consolidated into two helpers: `revalidateGridPages()` and `revalidateTransmissionPages()`.
- **Reference month** is now dynamic (`currentYearMonth()`), with stale `localStorage` values automatically cleared in [providers/settings-provider.jsx](providers/settings-provider.jsx).
- **Decimal validation regex** widened from 2 to 3 decimal places to accept Excel values like `200.003`.
- **Hybrid Breakdown table** rewritten to always create a row per component (Wind / Solar / BESS) when the project has a non-zero component capacity, even if no phase exists for that source.

### Fixed
- **FtcTable COD Pending column** previously always rendered `0` because it referenced a non-existent `ph.codPendingMw` field. Replaced with a `codPendingFromPhase()` helper that uses the canonical formula.
- **`getProjectSource()` for hybrid projects** previously returned `HYBRID` for every hybrid regardless of how the FTC was applied. SR Serentica 1&3, Zenataris, and Greenko now appear under WIND / SOLAR as the Excel intends.
- **Dashboard didn't refresh** after most mutations (project creation, phase update, transmission edit) — now does, via the consolidated revalidation helpers.
- **SR Solar SAEL / TP Saurya** COD values were `null` because the seed couldn't parse text like `"300 (359.7)"`. Backfilled to 300 and 238.46 respectively.

### Removed
- Aditya Birla Renewables NR's component capacities — the project's total is `0` ("not applied" in Excel) and including hypothetical component MW skewed the Hybrid Breakdown.

## [0.3.0] — 2026-05-12

### Added
- Dynamic reference month based on system time.
- All-India per-source breakdown rows in pipeline tables.

### Changed
- FTC tracker, CONTD-4 table, Transmission table column counts reduced to fit on a single screen without horizontal scroll.
- Dashboard table headers softened from dark backgrounds to light, semantically-coloured headers.

### Removed
- Redundant "Add Project" button on the FTC tracker page (still available on the CONTD-4 page).

## [0.2.0] — 2026-04-30

### Added
- Initial CONTD-4, FTC tracker, and transmission pages.
- Audit feed (project notes) on the project detail page.
- Bulk Excel import wizard.
- Snapshot model (`GridSnapshot`) and day-wise compare view skeleton.

## [0.1.0] — 2026-04-23

Initial commit.

- Next.js 15 + Prisma 6 + PostgreSQL scaffold.
- Role-based auth (JWT, refresh-token rotation).
- Seven seeded users (admin + NLDC + 5× RLDC).
- Master tables: GridRegion, PlantType, PoolingStation.
- Domain tables: GenerationProject, Contd4Application, CommissioningPhase, ProjectNote, TransmissionElement, TransmissionAuditLog.
