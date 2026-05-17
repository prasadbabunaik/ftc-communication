# Data Model

The schema lives in [prisma/schema.prisma](../prisma/schema.prisma). All names below match the Prisma model names; database tables use the `@@map` snake_case form.

## Entity-Relationship Overview

```
            ┌────────────┐         ┌──────────────────┐
            │ GridRegion │◄────┐   │   PlantType      │
            │ (NR/WR/SR/ │     │   │  (Wind / Solar / │
            │  ER/NER)   │     │   │  Hybrid_WS …)    │
            └────────────┘     │   └─────────┬────────┘
                  ▲            │             │
                  │            │             │
            ┌─────┴──────┐     │     ┌───────▼───────────────┐
            │ Pooling-   │     └─────┤  GenerationProject    │
            │ Station    │◄──────────┤  (one per generator)  │
            └────────────┘    1:N    │                       │
                                     └──┬───────┬────────┬───┘
                                        │       │        │
                          1:1           │       │1:N     │1:N
                                        ▼       ▼        ▼
                            ┌───────────────┐ ┌────────────────┐
                            │ Contd4-       │ │ Commissioning- │
                            │ Application   │ │ Phase          │
                            └───────────────┘ └────────────────┘
                                        │
                                        │ N:1
                                        ▼
                                ┌───────────────┐
                                │ ProjectNote   │  (audit + manual notes)
                                └───────────────┘

            ┌────────────────────────┐
            │ TransmissionElement    │   N:1 ── GridRegion
            └──────┬─────────────────┘
                   │ 1:N
                   ▼
            ┌──────────────────────────┐
            │ TransmissionAuditLog     │
            └──────────────────────────┘

            ┌──────────────────┐                ┌─────────────────┐
            │ User             │ 1:N ───►       │ RefreshToken    │
            │ (with UserRole)  │                │ (auth)          │
            └──────────────────┘                └─────────────────┘

            ┌──────────────────┐
            │ GridSnapshot     │   one row per snapshotDate; carries
            │                  │   t1Json / t2Json / t3Json blobs
            └──────────────────┘
```

## Tables

### User
| Field       | Type        | Notes                                              |
|-------------|-------------|----------------------------------------------------|
| id          | cuid        | PK                                                 |
| name        | String      |                                                    |
| email       | String unique |                                                  |
| password    | String      | bcrypt hash                                        |
| role        | UserRole    | `ADMIN`, `NLDC`, `NRLDC`, `WRLDC`, `SRLDC`, `ERLDC`, `NERLDC` |
| isActive    | Boolean     | Soft disable                                       |
| createdAt   | DateTime    | `@default(now())`                                  |
| updatedAt   | DateTime    | `@updatedAt`                                       |

### RefreshToken
Stores the rotating refresh JWT. Cascade-deletes when user is removed.

### GridRegion
| Field | Type           | Notes |
|-------|----------------|-------|
| id    | cuid           | PK    |
| code  | String unique  | `NR`, `WR`, `SR`, `ER`, `NER` |
| name  | String         | Human-readable name |

### PlantType
| Field    | Type                | Notes                                       |
|----------|---------------------|---------------------------------------------|
| id       | cuid                | PK                                          |
| code     | String unique       | `SOLAR`, `WIND`, `HYBRID_WS`, `HYBRID_WSB`, `HYBRID_SP`, `COAL`, `HYDRO`, `PSP`, `BESS` … |
| label    | String              | "Hybrid (Wind+Solar)" etc.                  |
| category | GenerationCategory  | `RENEWABLE` / `CONVENTIONAL` / `STORAGE`    |
| isHybrid | Boolean             | True for HYBRID_* codes                     |

### PoolingStation
Unique by (`name`, `regionId`).

### GenerationProject
The core entity. One row per generator/plant.

| Field             | Type      | Notes                                                                 |
|-------------------|-----------|-----------------------------------------------------------------------|
| id                | cuid      | PK                                                                    |
| name              | String    | Plant / station name                                                  |
| developerName     | String?   | Owner / IPP                                                           |
| regionId          | FK        | → GridRegion                                                          |
| plantTypeId       | FK        | → PlantType                                                           |
| poolingStationId  | FK?       | → PoolingStation (nullable)                                           |
| totalCapacityMw   | Decimal(10,2) | Full plant nameplate capacity                                    |
| windCapacityMw    | Decimal(10,2)? | Hybrid: Wind component                                          |
| solarCapacityMw   | Decimal(10,2)? | Hybrid: Solar component                                         |
| bessCapacityMw    | Decimal(10,2)? | Hybrid: BESS component                                          |
| createdById       | FK        | → User                                                                |
| timestamps        |           | `createdAt`, `updatedAt`                                              |

`@@index([regionId])` for region-scoped queries.

### Contd4Application
1:1 with `GenerationProject` (`projectId` unique). Cascade delete.

| Field             | Type      | Notes                                                       |
|-------------------|-----------|-------------------------------------------------------------|
| applicationDate   | DateTime  | When CONTD-4 was filed                                      |
| proposedFtcDate   | DateTime? | Target FTC date                                             |
| capacityApr26Mw   | Decimal?  | Capacity expected to be CONTD-4-cleared in reference month  |
| capacityMonth     | String?   | `YYYY-MM` — bucket month for the above                      |
| status            | Contd4Status | `PENDING`, `RECEIVED`, `CLEARED`, `REJECTED`             |
| remarks           | String?   |                                                             |

### CommissioningPhase
Many phases per project (e.g. a hybrid may have one phase per applied source type). Cascade delete with project.

| Field              | Type      | Notes                                              |
|--------------------|-----------|----------------------------------------------------|
| projectId          | FK        | → GenerationProject                                |
| sourceType         | SourceType | `WIND`, `SOLAR`, `BESS`, `COAL`, `HYDRO`, `PSP`   |
| capacityAppliedMw  | Decimal   | MW applied for FTC                                 |
| ftcCompletedMw     | Decimal?  | MW where FTC done                                  |
| ftcCompletedDate   | DateTime? |                                                    |
| proposedFtcDate    | DateTime? |                                                    |
| capacityUnderFtcMw | Decimal?  | MW still in FTC pipeline                           |
| tocIssuedMw        | Decimal?  | MW where TOC issued                                |
| tocIssuedDate      | DateTime? |                                                    |
| capacityUnderTocMw | Decimal?  | MW still in TOC process                            |
| codDeclaredMw      | Decimal?  | MW where COD declared                              |
| codDeclaredDate    | DateTime? |                                                    |
| expectedApr26Mw    | Decimal?  | MW expected by reference month                     |
| delayCategory      | String?   |                                                    |
| delayRemarks       | String?   |                                                    |
| otherRemarks       | String?   |                                                    |

Pipeline invariants enforced by Zod (and re-asserted server-side):

- `ftcCompletedMw ≤ capacityAppliedMw`
- `tocIssuedMw ≤ ftcCompletedMw`
- `codDeclaredMw ≤ tocIssuedMw`
- `ftcCompletedDate ≤ tocIssuedDate ≤ codDeclaredDate`

### TransmissionElement

| Field             | Type            | Notes                                                |
|-------------------|-----------------|------------------------------------------------------|
| regionId          | FK              | → GridRegion                                         |
| agencyOwner       | String          | e.g. PGCIL, GETCO                                    |
| elementName       | String          | "400kV Bikaner-Sikar D/C"                            |
| elementType       | TransmissionType| `LINE`, `ICT`, `GT`, `ST`                            |
| isRe              | Boolean         | RE pocket (renewable) vs Non-RE                      |
| voltageRatingKv   | Int?            |                                                      |
| capacityMva       | Decimal?        | MVA (for ICT / transformers)                         |
| lineLengthKm      | Decimal?        | km (for lines)                                       |
| firstEnergyDate   | DateTime?       | First-time energization & integration approval       |
| pendingFtc        | Boolean         | Marks elements awaiting FTC                          |
| proposedFtcDate   | DateTime?       |                                                      |
| capacityApr26Mva  | Decimal?        | MVA commissioning expected in reference month        |
| lineLengthApr26Km | Decimal?        | km commissioning expected in reference month         |
| remarks           | String?         |                                                      |

### ProjectNote (audit + manual notes)

| Field      | Type     | Notes                                              |
|------------|----------|----------------------------------------------------|
| projectId  | FK       | → GenerationProject (cascade)                      |
| phaseId    | FK?      | → CommissioningPhase (set null on delete)          |
| userId     | FK       | → User                                             |
| text       | String   | Either manual text or system-formatted description |
| source     | NoteSource | `MANUAL`, `SYSTEM`                               |
| field      | String?  | Field name (SYSTEM rows only)                      |
| oldValue   | String?  | Previous value                                     |
| newValue   | String?  | New value                                          |
| createdAt  | DateTime |                                                    |

When the server action diffs a record against form input, it creates one `ProjectNote` per changed field — surfaced as the project's audit timeline.

### TransmissionAuditLog
Same shape as ProjectNote but for transmission elements; tracks `action` (`CREATE` / `UPDATE` / `DELETE`).

### GridSnapshot

Materialised dashboard state per day. The three `Json` columns store pre-computed table payloads so the day-wise compare view is fast even for large snapshots.

| Field        | Type       |
|--------------|------------|
| snapshotDate | Date unique|
| label        | String?    |
| t1Json       | Json       | CONTD-4 study rows           |
| t2Json       | Json       | FTC pipeline rows            |
| t3Json       | Json       | Transmission rows            |
| createdAt    | DateTime   |                              |

### Notification

Per-user transient feed surfaced in the header bell. Distinct from `ProjectNote`/`TransmissionAuditLog` which are durable audit records — notifications can be marked read or deleted by the user.

| Field     | Type                 | Notes                                              |
|-----------|----------------------|----------------------------------------------------|
| id        | cuid                 | PK                                                 |
| userId    | FK → User            | recipient; cascades on user delete                 |
| type      | NotificationType     | enum (see below)                                   |
| severity  | NotificationSeverity | `INFO` / `SUCCESS` / `WARNING` / `CRITICAL`        |
| title     | String               | headline                                           |
| body      | String?              | optional sub-text                                  |
| link      | String?              | in-app deep link                                   |
| metadata  | Json?                | free-form context for the UI (`projectId`, etc.)   |
| isRead    | Boolean              | default `false`                                    |
| readAt    | DateTime?            | set when marked read                               |
| createdAt | DateTime             |                                                    |

Emission is fan-out: a single logical event (e.g. project created in SR) becomes one Notification row per recipient user. Recipient resolution lives in [`lib/notifications.js`](../lib/notifications.js): ADMIN + NLDC always receive; the region's RLDC also receives when the event has a `regionCode`; the actor who triggered the event is excluded.

Indexed on `(userId, isRead, createdAt)` for the bell's unread-first listing.

## Enums

```prisma
enum UserRole              { ADMIN  NLDC  NRLDC  WRLDC  SRLDC  ERLDC  NERLDC }
enum GenerationCategory    { RENEWABLE  CONVENTIONAL  STORAGE }
enum SourceType            { WIND  SOLAR  COAL  HYDRO  PSP  BESS }
enum Contd4Status          { PENDING  RECEIVED  CLEARED  REJECTED }
enum NoteSource            { MANUAL  SYSTEM }
enum TransmissionType      { LINE  ICT  GT  ST }
enum NotificationType      { PROJECT_CREATED  PROJECT_UPDATED  CONTD4_STATUS_CHANGED
                             PHASE_ADDED  FTC_EVENT  TOC_EVENT  COD_EVENT
                             TRANSMISSION_UPDATED  SNAPSHOT_DIFF  SYSTEM }
enum NotificationSeverity  { INFO  SUCCESS  WARNING  CRITICAL }
```

## Notes on Decimal Precision

All monetary / capacity columns are `Decimal(10, 2)` or `Decimal(10, 3)` (line length). Always wrap in `Number()` before arithmetic:

```js
const ftc = Number(phase.ftcCompletedMw) || 0;
```

The validation layer accepts up to **3 decimal places** (Excel snapshots use values like `200.003`).

## Indexes

- `GenerationProject(regionId)` — region-scoped fetches
- `GenerationProject(activeFrom, activeUntil)` — point-in-time / soft-delete reads
- `CommissioningPhase(projectId)` — per-project phase loads
- `FtcEvent(phaseId, eventDate)`, `TocEvent(phaseId, eventDate)`, `CodEvent(phaseId, eventDate)` — point-in-time milestone sums
- `Contd4Phase(contd4Id)` — append-only declaration log per CONTD-4
- `ProjectNote(projectId)`, `ProjectNote(phaseId)` — audit-feed reads
- `TransmissionElement(regionId)`, `TransmissionElement(activeFrom, activeUntil)`, `TransmissionAuditLog(elementId)`
- `Notification(userId, isRead, createdAt)` — bell unread-first listing
- `GridSnapshot(snapshotDate)` unique

## Migrations

Located in `prisma/migrations/`:

1. `20260513142440_init` — initial schema
2. `20260513175411_add_grid_snapshot` — adds the `grid_snapshots` table
3. `20260516170053_add_events_and_soft_delete` — append-only `FtcEvent`/`TocEvent`/`CodEvent` tables, `Contd4Phase`, plus `activeFrom`/`activeUntil` columns on `GenerationProject`/`TransmissionElement`
4. `20260517143825_add_notifications` — adds the `notifications` table with `NotificationType` + `NotificationSeverity` enums

Run `npm run db:migrate` in dev or `npx prisma migrate deploy` in prod.
