# Architecture

## System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Browser (Client)                            │
│   React 19 components · Tailwind · Radix UI · React Hook Form        │
└────────────────────────┬─────────────────────────────────────────────┘
                         │ HTTPS  (cookies: access_token, refresh_token)
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Next.js 15 (App Router)                           │
│  ┌────────────────┐  ┌──────────────────┐  ┌──────────────────────┐  │
│  │ Server         │  │ Server Actions   │  │ Route Handlers       │  │
│  │ Components     │  │ /app/actions/*   │  │ /app/api/**          │  │
│  │ (SSR/RSC)      │  │ — mutate state   │  │ — JSON / xlsx export │  │
│  └────────┬───────┘  └────────┬─────────┘  └──────────┬───────────┘  │
│           │                   │                       │              │
│           └─────────────┬─────┴───────────────────────┘              │
│                         ▼                                            │
│                ┌─────────────────────┐                               │
│                │   lib/grid-         │   pure computations           │
│                │   computations.js   │   (no DB / no I/O)            │
│                └─────────────────────┘                               │
│                         ▲                                            │
│         ┌───────────────┴────────────────┐                           │
│         │ lib/server-auth.js             │  requireServerUser,       │
│         │ lib/validations/grid.js (Zod)  │  buildRegionScope         │
│         │ lib/prisma.js                  │                           │
│         └───────────────┬────────────────┘                           │
└─────────────────────────┼────────────────────────────────────────────┘
                          ▼
                ┌─────────────────────┐
                │   PostgreSQL 14+    │
                │   (via Prisma 6)    │
                └─────────────────────┘
```

## Request Lifecycle

### Page load (dashboard, ftc, etc.)

1. Browser GETs `/dashboard` with `access_token` cookie.
2. `middleware.js` verifies JWT signature; refreshes if expired using `refresh_token`.
3. The page (`app/(protected)/dashboard/page.jsx`) runs server-side:
   - Calls `requireServerUser()` and `buildRegionScope(role)`.
   - Fetches projects + transmission rows via Prisma, scoped to the region.
   - Calls pure `compute*` functions in [lib/grid-computations.js](../lib/grid-computations.js).
   - Serialises results and renders a client component (`SummaryPageClient`).
4. The HTML streams to the browser; React hydrates only the interactive parts (filters, tabs, modals).

### Mutation (form submit)

1. Client submits a form; React Hook Form runs Zod validation locally.
2. The form calls a Server Action in `app/actions/grid.js`.
3. The action:
   - Re-validates the payload with the same Zod schema (defence in depth).
   - Checks region scope (RLDC users may only modify their own region).
   - Updates the DB inside a transaction where multiple records change.
   - Writes a `ProjectNote` (or `TransmissionAuditLog`) entry per changed field.
   - Calls `revalidateGridPages(projectId)` / `revalidateTransmissionPages()` to invalidate cached pages.
4. The mutated entity is re-fetched on the next request; dashboard, FTC tracker, and detail page all reflect the change.

## Layered Code Organisation

| Layer | Path | Purpose |
|---|---|---|
| Pages | `app/**/page.jsx` | Server components — fetch data + render |
| Server Actions | `app/actions/grid.js` | All mutations (CRUD on projects, phases, transmissions, notes) |
| API routes | `app/api/**/route.js` | JSON / Excel export endpoints |
| Client components | `components/grid/*.jsx` | Tables, forms, modals; mark with `'use client'` |
| Pure functions | `lib/grid-computations.js` | Region/source matrices, hybrid breakdown, monthly COD |
| Validation | `lib/validations/grid.js` | Zod schemas — single source of truth for input shape & rules |
| Auth | `lib/server-auth.js`, `middleware.js` | JWT, scope helpers |
| DB | `lib/prisma.js` | Prisma client singleton |

**Rules of thumb:**
- Server Components fetch and serialise; never put `'use client'` on a page.
- Client Components receive serialised JSON props (no Decimal / Date instances).
- `compute*` functions never touch the DB — they accept arrays and return plain objects.
- Mutations always call a Server Action; never call Prisma from a client component.

## The Computation Pipeline

All dashboard tables are derived from the same source data through pure functions in [lib/grid-computations.js](../lib/grid-computations.js):

```
projects + txElements
        │
        ├── computeContd4Study(projects)        → Table 1
        │
        ├── computePipelineMatrix(projects, asOf)
        │   ├── buildPipelineRows(matrix, 'region', 'source')  → Table 2
        │   └── buildPipelineRows(matrix, 'source', 'region')  → Table 5
        │
        ├── computeTransmission(txElements)     → Table 3
        ├── computeHybridBreakdown(projects)    → Table 4
        └── computeMonthlyCod(projects, from, to)→ Table 6
```

The seven tables match the Excel `Summary` sheet 1:1.

### Pipeline columns

For each (region, source) cell, the pipeline matrix tracks:

| Field | Source | Formula |
|---|---|---|
| `totalCapacityMw` | `project.totalCapacityMw` | sum across cleared projects |
| `contd4CapacityMw` | `contd4.capacityApr26Mw` | sum |
| `appliedMw` | `phase.capacityAppliedMw` | sum |
| `ftcApprovedMw` | `phase.ftcCompletedMw` | sum (date-gated by `asOf`) |
| `ftcPendingMw` | `phase.capacityUnderFtcMw` | sum |
| `tocIssuedMw` | `phase.tocIssuedMw` | sum (date-gated) |
| `tocPendingMw` | `phase.capacityUnderTocMw` | sum |
| `codCompletedMw` | `phase.codDeclaredMw` | sum (date-gated) |
| `codPendingMw` | computed | `max(0, toc − cod − underToc)` per phase |
| `expectedMw` | `phase.expectedApr26Mw` | sum |

### As-of filtering

Passing an `asOf` Date to `computePipelineMatrix` causes FTC / TOC / COD values to be counted only if the relevant *date* field is on or before `asOf`. This drives the snapshot-comparison feature on the dashboard.

## Hybrid Source Categorisation

A hybrid project (`plantType.isHybrid === true`) can appear under different source buckets in the pipeline summary depending on how the FTC was applied. The rules in `getProjectSource()`:

1. **PSP-based hybrids** (`HYBRID_SP`, `HYBRID_WP`, `HYBRID_HP`): PSP is storage, so the pipeline category is the *generation* component (`phase[0].sourceType`).
2. **Single-WIND-phase hybrids** (e.g. SR Serentica, Zenataris applied only for the Wind component): return `'WIND'`.
3. **All other hybrids**: return `'HYBRID'`.

This mirrors the Excel "Sources Type Applied for FTC" column. The categorisation does NOT change the project's plantType or whether it appears in the **Hybrid Breakdown** table — that still uses `plantType.isHybrid`.

## Region Scoping

The function `buildRegionScope(role)` in [lib/server-auth.js](../lib/server-auth.js) returns a Prisma `where` fragment:

```js
// SRLDC user
{ regionId: '<id-of-SR>' }

// NLDC or ADMIN
{ /* empty — no filter */ }
```

It is applied to every project / transmission fetch. Mutations additionally verify scope before writing:

```js
if (scope.regionId && scope.regionId !== record.regionId) {
  return { error: 'Access denied.' };
}
```

## Caching & Revalidation

Next.js caches RSC output per route. Mutations must explicitly invalidate the relevant routes via `revalidatePath()`. Two helpers in [app/actions/grid.js](../app/actions/grid.js) centralise this:

```js
revalidateGridPages(projectId)       // dashboard, ftc, hybrid-ftc, contd4,
                                     // generation, generation/[id]

revalidateTransmissionPages()        // dashboard, transmission
```

Every mutation action must call one of these so the dashboard reflects the change.

## Audit Trail

Two append-only tables capture every change:

- `ProjectNote` — per-project changes (name, plant type, phase fields, CONTD-4 status). Each row has either `text` (manual note) or `field` / `oldValue` / `newValue` (SYSTEM-generated).
- `TransmissionAuditLog` — per-transmission-element changes, with `action` (`CREATE` / `UPDATE` / `DELETE`).

Both are surfaced in the UI:

- Project detail page → "Audit" tab → renders via [components/grid/AuditFeed.jsx](../components/grid/AuditFeed.jsx).
- Transmission element modal → linked audit logs.

The `diffFields()` helper in `app/actions/grid.js` filters out fields that didn't change, so noise stays low.

## Snapshots

Dated snapshots of the three master tables (projects, phases, transmissions) are stored as JSON blobs in `GridSnapshot`:

```
snapshotDate (Date, unique)
t1Json    (Table 1 — CONTD-4 study)
t2Json    (Table 2 — FTC pipeline)
t3Json    (Table 3 — Transmission)
```

These power the "Day-wise Changes" tab on the dashboard, which loads two snapshots and visually diffs them. Snapshots are written by `scripts/seed-snapshots-db.js`.
