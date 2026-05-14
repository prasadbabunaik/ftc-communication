# Changelog

This file tracks notable changes to the FTC Communication Portal.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Dates use the IST calendar.

## [Unreleased] — 2026-05-14

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
