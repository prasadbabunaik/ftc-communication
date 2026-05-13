# Operations

This guide covers the maintenance scripts in [`scripts/`](../scripts) and common procedures for keeping the portal in sync with the daily Excel workbooks.

## Scripts Catalog

| Script | Purpose | Idempotent? |
|---|---|---|
| `scripts/seed-snapshots-db.js` | Insert / refresh project + transmission rows from a JSON snapshot derived from an Excel workbook | yes (uses upsert) |
| `scripts/seed-snapshots.py` | (Legacy / reference) Python equivalent of the above | yes |
| `scripts/seed-apr30.js` | One-time seed bringing the DB up to the April 30 baseline | yes |
| `scripts/backfill-hybrid-components.js` | Backfills `windCapacityMw` / `solarCapacityMw` / `bessCapacityMw` for hybrid projects | yes (`--dry` flag) |
| `scripts/diff-excel-snapshots.js` | Diffs the 11/12/13 May Excel snapshots, prints all changes | read-only |
| `scripts/log-snapshot-changes.js` | Diffs snapshots and writes the material changes as `ProjectNote` SYSTEM entries | conditionally idempotent (`--dry` flag) |
| `scripts/validate-summary.js` | Compares portal-computed totals with the Excel `Summary` sheet | read-only |
| `scripts/validate-all-files.py` | (Python) Full validation across all snapshot files | read-only |

All Node scripts read `DATABASE_URL` from `.env.local` (fallback `.env`).

### Running

```bash
# Always run from the project root
cd /path/to/ftc-communication

# Dry-run first when supported
node scripts/backfill-hybrid-components.js --dry
node scripts/backfill-hybrid-components.js

node scripts/log-snapshot-changes.js --dry
node scripts/log-snapshot-changes.js
```

## Daily Snapshot Procedure

Each working day a new Excel workbook is produced (e.g. `CONTD and FTC details 130526.xlsx`). To bring the portal in sync:

1. **Drop the file** into `public/data/excel/`.
2. **Diff** to see what changed:
   ```bash
   node scripts/diff-excel-snapshots.js
   ```
3. **Bulk import** via the UI (`/import`) — preferred path; the wizard previews changes before applying.
4. **Or, for a clean reset** (rare):
   ```bash
   # Edit scripts/seed-snapshots-db.js to point at the new file
   node scripts/seed-snapshots-db.js
   ```
5. **Backfill hybrid components** if new hybrid projects were added:
   ```bash
   node scripts/backfill-hybrid-components.js
   ```
6. **Materialise a snapshot row** for the day-wise compare feature:
   - Currently the `GridSnapshot` table is populated manually via `scripts/seed-snapshots-db.js` (it writes the day's `t1Json` / `t2Json` / `t3Json`).
   - A scheduled job is the right long-term solution — see "Future automation" below.

## Importing via the UI

Navigate to `/import` (admin only). The wizard:

1. Accepts an `.xlsx` upload.
2. Detects sheet structure (NR/WR/SR/ER/NER and the bundled transmission table).
3. Previews additions / changes per region.
4. On confirm, calls `bulkImportRows(type, rows)` which performs `upsert` per record and writes audit rows for changed fields.

The wizard rejects rows that fail Zod validation and surfaces the errors row by row.

## Pipeline Source Categorisation Quick Reference

When triaging a "why does this project show under X source?" question:

1. Open the project page in `/generation/[id]`.
2. If `plantType.isHybrid === false`, the category equals `phase[0].sourceType` (or label keywords as a fallback).
3. If `plantType.isHybrid === true`:
   - PSP hybrid (`HYBRID_SP` / `WP` / `HP`) → uses the generation phase's source type (Solar for SP, Wind for WP, Hydro for HP).
   - All phases are `WIND` → categorised as `WIND` (mirror of Excel "Sources Type Applied for FTC" = Wind).
   - Otherwise → categorised as `HYBRID`.

See [docs/ARCHITECTURE.md](ARCHITECTURE.md#hybrid-source-categorisation).

## Troubleshooting

### Dashboard not refreshing after a save

The mutation needs to call one of the revalidation helpers in [app/actions/grid.js](../app/actions/grid.js):

```js
revalidateGridPages(projectId);       // any project-affecting mutation
revalidateTransmissionPages();        // any transmission-affecting mutation
```

If you add a new server action, follow the same pattern.

### COD Pending shows surprising values

Formula: `max(0, tocIssuedMw − codDeclaredMw − capacityUnderTocMw)`.

The `capacityUnderTocMw` term excludes capacity that is already explicitly tracked in the TOC-pending bucket. If the value is unexpectedly high, check whether `capacityUnderTocMw` is missing on the phase.

### Excel TOC values look astronomical (e.g. 94,000+)

This is an Excel formula bug in some snapshots where the `TOC issued (MW)` column contains a *date serial number* (e.g. `46139`) instead of a number. The portal computation ignores this — it sums the parsed `tocIssuedMw` field, which is loaded from the regional sheet not the Summary.

### A project doesn't appear in the FTC tracker

The FTC tracker shows only projects with `contd4.status = 'CLEARED'`. Check:
- The project has a `Contd4Application` row.
- Its `status` is exactly `CLEARED` (the dropdown only allows allowed values, but a stale import could have a different casing).
- The user's region matches the project's region (RLDC users see only their region).

### A region's data is missing

`buildRegionScope(role)` returns `{ regionId: <user.regionId> }` for RLDC roles. If the user's role is `NRLDC` but the projects belong to `WR`, they won't appear. Cross-region access requires `NLDC` or `ADMIN`.

## Audit Feed Maintenance

The `ProjectNote` and `TransmissionAuditLog` tables grow indefinitely. They are append-only by design. After ~12 months, consider:

- **Archive old rows** to a separate table or a flat file.
- **Add a retention policy** — keep last 90 days of SYSTEM entries, keep MANUAL notes forever.

No truncation script ships with the project; design it to match your retention requirements.

## Future Automation

Suggested cron jobs once a deployment exists:

```cron
# 02:00 daily — refresh a fresh snapshot from yesterday's workbook
0 2 * * *  cd /opt/ftc && node scripts/seed-snapshots-db.js >> /var/log/ftc/snapshot.log

# 02:30 daily — diff yesterday vs the day before, append audit entries
30 2 * * * cd /opt/ftc && node scripts/log-snapshot-changes.js >> /var/log/ftc/audit.log

# Sundays — pg_dump backup
0 3 * * 0  /opt/ftc/scripts/backup.sh
```

Adjust paths and PATH variables as needed.
