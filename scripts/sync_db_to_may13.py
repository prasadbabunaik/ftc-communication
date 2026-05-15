"""
Sync DB to match May 13 Excel snapshot.

This script:
 1. DELETEs projects that have been removed from Excel (Buxar Unit-2)
 2. UPDATEs commissioning phase values for projects whose data differs
 3. INSERTs new projects that appear in Excel but not in DB

Run: python3 scripts/sync_db_to_may13.py [--dry-run]
"""

import sys, json
from pathlib import Path
import psycopg2
import psycopg2.extras
from decimal import Decimal
from datetime import datetime

DB_URL = "postgresql://postgres:S0perg%4026@10.5.133.55:5432/ftc_communication"
DRY_RUN = "--dry-run" in sys.argv

# ── Per-phase fixes ───────────────────────────────────────────────────────────
# Each entry: (project_name_match, region, updates_dict)
# updates_dict keys: appliedMw, ftcCompletedMw, capacityUnderFtcMw, tocIssuedMw,
#                     capacityUnderTocMw, codDeclaredMw, expectedApr26Mw
# None = set to NULL; missing key = no change

PHASE_UPDATES = [
    # ───── NR ─────
    {"name": "ACME SUN POWER PRIVATE LIMITED",      "region": "NR",
     "updates": {"tocIssuedMw": 233.33, "codDeclaredMw": 233.33, "expectedApr26Mw": 66.66}},
    {"name": "ACME Surya POWER Private Limited",    "region": "NR",
     "updates": {"capacityAppliedMw": 250.00, "ftcCompletedMw": 250.00,
                 "tocIssuedMw": 210.94, "codDeclaredMw": 210.94, "expectedApr26Mw": 39.06}},
    {"name": "Clean Max Celestial",                 "region": "NR",
     "updates": {"expectedApr26Mw": 0.00}},
    {"name": "Clean Max Enviro Energy",             "region": "NR",
     "updates": {"ftcCompletedMw": 93.75, "capacityUnderFtcMw": 0.00,
                 "expectedApr26Mw": 0.00}},
    {"name": "Energizent POWER",                    "region": "NR",
     "updates": {"tocIssuedMw": 129.00, "codDeclaredMw": 129.00}},
    {"name": "Ghatampur TPS",                       "region": "NR",
     "updates": {"capacityUnderFtcMw": 0.00, "tocIssuedMw": 0.00, "codDeclaredMw": 0.00}},
    {"name": "HRP Green POWER",                     "region": "NR",
     "updates": {"capacityAppliedMw": 0.00, "ftcCompletedMw": 296.00,
                 "tocIssuedMw": 0.00, "codDeclaredMw": 296.00, "expectedApr26Mw": 0.00}},
    {"name": "Juniper Green Stellar",               "region": "NR",
     "updates": {"ftcCompletedMw": 365.00}},   # was overstated at 465
    {"name": "Renew Solar Shakti Five",             "region": "NR",
     "updates": {"tocIssuedMw": 211.00, "codDeclaredMw": 211.00, "expectedApr26Mw": 0.00}},

    # ───── WR ─────
    {"name": "AGE25CL Khavda PSS8",                 "region": "WR",
     "updates": {"tocIssuedMw": 500.00, "capacityUnderTocMw": 0.00}},
    {"name": "AGE26AL Khavda PSS14",                "region": "WR",
     "updates": {"capacityAppliedMw": 208.00, "ftcCompletedMw": 208.00,
                 "tocIssuedMw": 98.80, "codDeclaredMw": 98.80}},
    {"name": "ARE36L BESS",                         "region": "WR",
     "updates": {"tocIssuedMw": 240.00, "codDeclaredMw": 240.00, "expectedApr26Mw": 44.00}},
    {"name": "ARE37L BESS",                         "region": "WR",
     "updates": {"tocIssuedMw": 460.00, "capacityUnderTocMw": 0.00,
                 "codDeclaredMw": 460.00, "expectedApr26Mw": 15.00}},
    {"name": "ARE43L BESS",                         "region": "WR",
     "updates": {"capacityUnderTocMw": 0.00, "expectedApr26Mw": 75.00}},
    {"name": "NTPC REL Vanki",                      "region": "WR",
     "updates": {"capacityAppliedMw": 132.30, "tocIssuedMw": 0.00,
                 "codDeclaredMw": 0.00, "expectedApr26Mw": 50.40}},
    {"name": "Serentica Renewables India4",         "region": "WR",
     "updates": {"capacityAppliedMw": 95.70, "ftcCompletedMw": 95.70,
                 "tocIssuedMw": 59.40, "capacityUnderTocMw": 0.00,
                 "codDeclaredMw": 59.40, "expectedApr26Mw": 36.30}},
    {"name": "TEQ Green Power XI",                  "region": "WR",
     "updates": {"capacityAppliedMw": 203.70, "tocIssuedMw": 160.22,
                 "codDeclaredMw": 160.22, "expectedApr26Mw": 40.77}},

    # ───── SR ─────
    {"name": "NTPC Ramagundam",                     "region": "SR",
     "updates": {"tocIssuedMw": 0.00, "capacityUnderTocMw": 0.00,
                 "codDeclaredMw": 0.00, "expectedApr26Mw": 154.80}},
    {"name": "TP Saurya Limited",                   "region": "SR",
     "updates": {"codDeclaredMw": 0.00, "expectedApr26Mw": 52.80}},

    # ───── NER ─────
    {"name": "Subansiri Lower HEP",                 "region": "NER",
     "updates": {"ftcCompletedMw": 1000.00, "capacityUnderFtcMw": 0.00,
                 "tocIssuedMw": 1000.00, "codDeclaredMw": 1000.00,
                 "expectedApr26Mw": 0.00}},
]

PROJECTS_TO_DELETE = [
    {"name": "Buxar Unit-2", "region": "ER",
     "reason": "Removed from Excel snapshot on May 12"},
]

# New projects that need to be inserted
NEW_PROJECTS = [
    {
        "name":            "Serentica Renewables India 9 Private Limited (SRI9PL)",
        "region":          "NR",
        "plant_type":      "Solar",
        "pooling_station": "Fatehgarh-III",
        "total_cap":       600.00,
        "contd4_cap":      600.00,
        "contd4_status":   "CLEARED",
        "phase_source":    "SOLAR",
        "applied":         280.84,
        "ftc_completed":   280.84,
        "toc_issued":      0.00,
        "cod_declared":    0.00,
        "expected":        0.00,
    },
    {
        "name":            "APSEZ Khavda PSS4",
        "region":          "WR",
        "plant_type":      "Wind",
        "pooling_station": "Khavda-2 PS",
        "total_cap":       77.00,
        "contd4_cap":      77.00,
        "contd4_status":   "CLEARED",
        "phase_source":    "WIND",
        "applied":         77.00,
        "ftc_completed":   52.00,
        "under_ftc":       25.00,
        "toc_issued":      52.00,
        "cod_declared":    52.00,
        "expected":        0.00,
    },
]

# ── Helpers ──────────────────────────────────────────────────────────────────

def cuid_like():
    """Generate a CUID-like ID compatible with Prisma's @id @default(cuid())."""
    import time, random, string
    chars = string.ascii_lowercase + string.digits
    ts = format(int(time.time() * 1000), 'x')
    rand = ''.join(random.choices(chars, k=16))
    return f"cmp{ts}{rand}"[:25]

# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    print(f"\n{'='*80}")
    print(f"  Syncing DB to May 13 Excel snapshot {'(DRY RUN)' if DRY_RUN else ''}")
    print(f"{'='*80}\n")

    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False
    cur  = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    # ── 1. DELETIONS ──────────────────────────────────────────────────────────
    print("STEP 1 — DELETE removed projects")
    for proj in PROJECTS_TO_DELETE:
        cur.execute("""
            SELECT gp.id, gp.name, gr.code
            FROM generation_projects gp
            JOIN grid_regions gr ON gp."regionId" = gr.id
            WHERE gp.name ILIKE %s AND gr.code = %s
        """, (proj["name"], proj["region"]))
        row = cur.fetchone()
        if row:
            print(f"  - Deleting [{row['code']}] {row['name']}  ({proj['reason']})")
            if not DRY_RUN:
                cur.execute('DELETE FROM generation_projects WHERE id = %s', (row['id'],))
        else:
            print(f"  ⚠️  {proj['name']} ({proj['region']}) not found in DB")

    # ── 2. UPDATES ────────────────────────────────────────────────────────────
    print(f"\nSTEP 2 — UPDATE {len(PHASE_UPDATES)} commissioning phases")
    fixed = 0
    skipped = 0
    for u in PHASE_UPDATES:
        cur.execute("""
            SELECT cp.id AS phase_id, gp.name, gr.code
            FROM commissioning_phases cp
            JOIN generation_projects gp ON cp."projectId" = gp.id
            JOIN grid_regions gr ON gp."regionId" = gr.id
            WHERE gp.name ILIKE %s AND gr.code = %s
        """, (f"%{u['name']}%", u["region"]))
        rows = cur.fetchall()
        if not rows:
            print(f"  ⚠️  No phase found for {u['name']} ({u['region']})")
            skipped += 1
            continue
        if len(rows) > 1:
            print(f"  ⚠️  Multiple phases for {u['name']} ({u['region']}) — using first")
        phase_id = rows[0]["phase_id"]
        # Build SET clause
        sets = []
        params = []
        for col, val in u["updates"].items():
            sets.append(f'"{col}" = %s')
            params.append(val)
        sets.append('"updatedAt" = %s')
        params.append(datetime.utcnow())
        params.append(phase_id)
        sql = f'UPDATE commissioning_phases SET {", ".join(sets)} WHERE id = %s'
        if DRY_RUN:
            print(f"  ✓ {rows[0]['code']} {rows[0]['name'][:50]:50}: {list(u['updates'].keys())}")
        else:
            cur.execute(sql, params)
            print(f"  ✓ {rows[0]['code']} {rows[0]['name'][:50]:50}: updated {list(u['updates'].keys())}")
        fixed += 1

    print(f"\n  → {fixed} phases updated, {skipped} skipped")

    # ── 3. INSERTS ────────────────────────────────────────────────────────────
    print(f"\nSTEP 3 — INSERT {len(NEW_PROJECTS)} new projects")

    # Get an admin user id (createdById is required)
    cur.execute("SELECT id FROM users LIMIT 1")
    admin = cur.fetchone()
    admin_id = admin["id"] if admin else None
    if not admin_id:
        print("  ❌ No users in DB — cannot insert new projects")
        conn.rollback()
        return

    for new in NEW_PROJECTS:
        # Find region_id and plant_type_id
        cur.execute('SELECT id FROM grid_regions WHERE code = %s', (new["region"],))
        rg = cur.fetchone()
        cur.execute('SELECT id FROM plant_types WHERE label = %s', (new["plant_type"],))
        pt = cur.fetchone()
        if not rg or not pt:
            print(f"  ⚠️  Missing region/plant_type for {new['name']}: region={rg}, pt={pt}")
            continue

        # Check if it already exists
        cur.execute("""
            SELECT id FROM generation_projects
            WHERE name ILIKE %s AND "regionId" = %s
        """, (f"%{new['name'][:40]}%", rg["id"]))
        if cur.fetchone():
            print(f"  ⚠️  {new['name']} already exists — skipping insert")
            continue

        # Find pooling station id (optional)
        cur.execute('SELECT id FROM pooling_stations WHERE name = %s', (new["pooling_station"],))
        ps = cur.fetchone()
        ps_id = ps["id"] if ps else None

        proj_id  = cuid_like()
        phase_id = cuid_like()
        contd4_id = cuid_like()
        now = datetime.utcnow()

        if DRY_RUN:
            print(f"  ✓ {new['region']} {new['name']}  (would insert)")
        else:
            cur.execute("""
                INSERT INTO generation_projects
                    (id, name, "regionId", "plantTypeId", "poolingStationId",
                     "totalCapacityMw", "createdById", "createdAt", "updatedAt")
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (proj_id, new["name"], rg["id"], pt["id"], ps_id,
                  new["total_cap"], admin_id, now, now))

            cur.execute("""
                INSERT INTO contd4_applications
                    (id, "projectId", "applicationDate", "capacityApr26Mw", status,
                     "createdAt", "updatedAt")
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (contd4_id, proj_id, now, new["contd4_cap"], new["contd4_status"], now, now))

            cur.execute("""
                INSERT INTO commissioning_phases
                    (id, "projectId", "sourceType", "capacityAppliedMw",
                     "ftcCompletedMw", "capacityUnderFtcMw",
                     "tocIssuedMw", "codDeclaredMw", "expectedApr26Mw",
                     "createdAt", "updatedAt")
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (phase_id, proj_id, new["phase_source"],
                  new["applied"], new["ftc_completed"],
                  new.get("under_ftc", 0.00),
                  new["toc_issued"], new["cod_declared"],
                  new["expected"], now, now))
            print(f"  ✓ {new['region']} {new['name']}  (inserted with phase)")

    # ── 4. COMMIT or ROLLBACK ─────────────────────────────────────────────────
    if DRY_RUN:
        print(f"\n  [DRY RUN] No changes committed. Run without --dry-run to apply.")
        conn.rollback()
    else:
        conn.commit()
        print(f"\n  ✅ All changes committed.")

    conn.close()


if __name__ == "__main__":
    main()
