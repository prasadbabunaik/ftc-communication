# FTC Communication Portal

A web platform for the National Load Despatch Centre (NLDC) and Regional Load Despatch Centres (NRLDC / WRLDC / SRLDC / ERLDC / NERLDC) to track First Time Charging (FTC), Transfer of Charge (TOC), and Commercial Operation Date (COD) of generation projects and transmission elements across the Indian grid.

The portal replaces a manually-maintained Excel workbook (`CONTD and FTC details.xlsx`) with an authoritative, audited, role-scoped database and dashboard.

---

## Table of Contents

- [Highlights](#highlights)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Key Concepts](#key-concepts)
- [User Roles & Access](#user-roles--access)
- [Documentation Index](#documentation-index)

---

## Highlights

- **Replaces an Excel workbook** with seven data tables that previously lived in `Summary` sheet (CONTD-4 study, FTC pipeline region-wise & source-wise, Hybrid breakdown by component, Transmission elements, Monthly COD)
- **Role-scoped data access** — each RLDC sees only its own region; NLDC and admins see All India
- **Daily snapshots & day-wise diff view** — capture state each day and inspect changes between any two dates
- **Audit history per project** — every field change (manual or imported) lands in the project's audit feed
- **Server-side validation everywhere** — Zod schemas enforce pipeline rules (FTC ≤ Applied, TOC ≤ FTC, COD ≤ TOC, dates monotonically increasing)
- **Built-in Excel import wizard** plus standalone backfill / diff / snapshot scripts under `scripts/`
- **Pixel-correct printable summary** for sharing with stakeholders

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router, React Server Components) |
| UI | React 19, Tailwind CSS 4, Radix UI primitives, lucide-react icons |
| Forms & validation | React Hook Form 7 + Zod 3 |
| Database | PostgreSQL via Prisma 6 |
| Authentication | JWT (jose) + bcryptjs, HttpOnly cookies, refresh-token rotation |
| Excel I/O | `xlsx` (SheetJS) |
| Charts / tables | Custom Tailwind components |

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/prasadbabunaik/ftc-communication.git
cd ftc-communication
npm install

# 2. Configure environment
cp .env.example .env
# Fill in DATABASE_URL and two JWT secrets (32+ chars each)

# 3. Migrate and seed the database
npm run db:migrate         # runs Prisma migrations
npm run db:seed            # seeds users, regions, plant types, sample projects

# 4. (Optional) Backfill hybrid component capacities from Excel snapshots
node scripts/backfill-hybrid-components.js

# 5. Run dev server
npm run dev                # http://localhost:3000
```

Default seed accounts (passwords in `prisma/seed.js`):

| Role  | Email                  |
|-------|------------------------|
| ADMIN | admin@ftc.gov.in       |
| NLDC  | nldc@ftc.gov.in        |
| SRLDC | srldc@ftc.gov.in       |
| NRLDC | nrldc@ftc.gov.in       |
| WRLDC | wrldc@ftc.gov.in       |
| ERLDC | erldc@ftc.gov.in       |
| NERLDC| nerldc@ftc.gov.in      |

## Project Structure

```
ftc-communication/
├── app/                          # Next.js App Router
│   ├── (auth)/                   #   - Login / refresh (public)
│   ├── (protected)/              #   - Authenticated app routes
│   │   ├── dashboard/            #     Summary dashboard with 8 tabs
│   │   ├── ftc/                  #     FTC tracker (cleared projects)
│   │   ├── hybrid-ftc/           #     Hybrid project subview
│   │   ├── contd4/               #     CONTD-4 applications list
│   │   ├── transmission/         #     Transmission elements
│   │   ├── generation/           #     Project list + detail/edit
│   │   └── import/               #     Bulk Excel import wizard
│   ├── (print)/                  #   - Printable summary view
│   ├── api/                      #   - JSON / export endpoints
│   └── actions/grid.js           #   - Server Actions (CRUD + audit)
├── components/
│   ├── grid/                     # Domain components (tables, forms, modals)
│   └── ui/                       # Generic primitives (buttons, inputs)
├── lib/
│   ├── grid-computations.js      # Pure functions: compute*, build* tables
│   ├── validations/grid.js       # Zod schemas (project, phase, transmission)
│   ├── server-auth.js            # requireServerUser, buildRegionScope
│   └── prisma.js                 # Prisma singleton
├── prisma/
│   ├── schema.prisma             # Data model (8 tables)
│   ├── migrations/               # Migration history
│   └── seed.js                   # Initial data
├── scripts/                      # One-off scripts (backfill, diff, snapshots)
│   ├── backfill-hybrid-components.js
│   ├── diff-excel-snapshots.js
│   ├── log-snapshot-changes.js
│   └── seed-snapshots-db.js
├── public/data/excel/            # Reference Excel workbooks (snapshots)
└── docs/                         # Detailed documentation (see below)
```

## Key Concepts

The pipeline a generation project moves through:

```
                     ┌──────────────┐
   1. Project filed  │   CONTD-4    │  (Connection To Distribute)
                     │  application │
                     └──────┬───────┘
                            │ status: PENDING → RECEIVED → CLEARED
                            ▼
                  ┌──────────────────────┐
                  │  Commissioning Phase │  (one or many; per source-type)
                  │  ─ Applied for FTC   │
                  │  ─ FTC Completed     │  First-time charging done
                  │  ─ TOC Issued        │  Transfer of charge
                  │  ─ COD Declared      │  Commercial operation
                  └──────────────────────┘
                            │
                            ▼
                  Project appears in FTC Pipeline,
                  Hybrid Breakdown, Monthly COD reports.
```

**Hybrid projects** are tracked at the component level (Wind / Solar / BESS / PSP) using `windCapacityMw`, `solarCapacityMw`, `bessCapacityMw` on the project plus per-phase `sourceType`.

**Pipeline categorisation logic** (in [lib/grid-computations.js](lib/grid-computations.js)) decides whether a hybrid project is bucketed as `HYBRID` or as one of its components in the summary — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#hybrid-source-categorisation).

## User Roles & Access

| Role   | Sees           | Can edit                                        |
|--------|----------------|-------------------------------------------------|
| ADMIN  | All India      | Everything; manage users                        |
| NLDC   | All India      | Read-only on most pages                         |
| RLDC*  | Own region only| Projects, phases, CONTD-4, transmissions for region |

Region scoping is enforced server-side via [`buildRegionScope(role)`](lib/server-auth.js) which is applied to every Prisma query that returns project or transmission data.

## Documentation Index

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, request lifecycle, computation pipeline, hybrid categorisation rules |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Database schema, relationships, enums, audit model |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Environment variables, migrations, build, hosting notes |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Scripts catalog, snapshot management, backfill procedures, troubleshooting |
| [CHANGELOG.md](CHANGELOG.md) | Versioned change history |

## License

Internal — not for redistribution.
