"""Round-2 fixes — issues found after round-1 sync."""

import sys
from datetime import datetime
import psycopg2, psycopg2.extras

DB_URL = "postgresql://postgres:S0perg%4026@10.5.133.55:5432/ftc_communication"
DRY_RUN = "--dry-run" in sys.argv

# 1) Fix APSEZ Khavda PSS4 — should be Hybrid (Wind+Solar), not Wind.
#    Easiest path: delete the wrongly-created Wind project, then re-insert as Hybrid.
#
# 2) Fix IB VOGT SOLAR SEVEN — missed in round-1.
#
# 3) Restore capacityUnderTocMw values that were wrongly zeroed (these are
#    manually-entered values that indicate MW still in TOC process, not
#    derivable from FTC−TOC).

PHASE_UPDATES = [
    # IB VOGT SOLAR SEVEN (NR Solar)
    {"name": "IB VOGT SOLAR SEVEN",        "region": "NR",
     "updates": {"tocIssuedMw": 200.00, "codDeclaredMw": 200.00, "expectedApr26Mw": 100.00}},

    # AGE25CL Khavda PSS8 — restore capacityUnderTocMw (was 125 originally, I zeroed)
    {"name": "AGE25CL Khavda PSS8",        "region": "WR",
     "updates": {"capacityUnderTocMw": 125.00}},

    # ARE37L BESS — restore capacityUnderTocMw (was 95, I zeroed). Excel WR BESS
    # TOC Pending = 90, ARE37L specifically has FTC 480 / TOC 460 ⇒ Under TOC 90.
    {"name": "ARE37L BESS",                "region": "WR",
     "updates": {"capacityUnderTocMw": 90.00}},

    # NTPC Ramagundam — set capacityUnderTocMw=154.80 (whole project is "Under TOC")
    {"name": "NTPC Ramagundam",            "region": "SR",
     "updates": {"capacityUnderTocMw": 154.80}},

    # SAEL Solar MHP2 — Excel WR Wind C9 TOC Pending 56.10 includes 39.90 from
    # Sembcorp + others. Sembcorp already has utoc=39.90 in DB so OK.
    # No update needed here.
]

PROJECTS_TO_DELETE = [
    {"name": "APSEZ Khavda PSS4", "region": "WR",
     "reason": "Wrongly inserted as Wind in round-1; re-inserting as Hybrid"},
]

NEW_PROJECTS = [
    {
        "name":            "APSEZ Khavda PSS4",
        "region":          "WR",
        "plant_type":      "Hybrid (Wind+Solar)",
        "pooling_station": "Khavda-2 PS",
        "total_cap":       77.00,
        "contd4_cap":      77.00,
        "contd4_status":   "CLEARED",
        "phase_source":    "SOLAR",   # primary phase source
        "applied":         77.00,
        "ftc_completed":   52.00,
        "under_ftc":       25.00,
        "toc_issued":      52.00,
        "cod_declared":    52.00,
        "expected":        0.00,
    },
]


def cuid_like():
    import time, random, string
    chars = string.ascii_lowercase + string.digits
    ts = format(int(time.time() * 1000), 'x')
    rand = ''.join(random.choices(chars, k=16))
    return f"cmp{ts}{rand}"[:25]


def main():
    print(f"\n{'='*70}\n  Round-2 sync fixes {'(DRY RUN)' if DRY_RUN else ''}\n{'='*70}\n")
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False
    cur  = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    # Get any user id for createdById
    cur.execute("SELECT id FROM users LIMIT 1")
    admin_id = cur.fetchone()["id"]

    # 1) DELETE
    for p in PROJECTS_TO_DELETE:
        cur.execute("""
            SELECT gp.id, gp.name FROM generation_projects gp
            JOIN grid_regions gr ON gp."regionId" = gr.id
            WHERE gp.name ILIKE %s AND gr.code = %s
        """, (p["name"], p["region"]))
        row = cur.fetchone()
        if row:
            print(f"  - DELETE [{p['region']}] {row['name']}  ({p['reason']})")
            if not DRY_RUN:
                cur.execute('DELETE FROM generation_projects WHERE id = %s', (row['id'],))

    # 2) UPDATE phases
    for u in PHASE_UPDATES:
        cur.execute("""
            SELECT cp.id, gp.name, gr.code
            FROM commissioning_phases cp
            JOIN generation_projects gp ON cp."projectId" = gp.id
            JOIN grid_regions gr ON gp."regionId" = gr.id
            WHERE gp.name ILIKE %s AND gr.code = %s
        """, (f"%{u['name']}%", u["region"]))
        rows = cur.fetchall()
        if not rows:
            print(f"  ⚠️  not found: {u['name']} ({u['region']})")
            continue
        phase_id = rows[0]["id"]
        sets, params = [], []
        for col, val in u["updates"].items():
            sets.append(f'"{col}" = %s')
            params.append(val)
        sets.append('"updatedAt" = %s')
        params.append(datetime.utcnow())
        params.append(phase_id)
        sql = f'UPDATE commissioning_phases SET {", ".join(sets)} WHERE id = %s'
        if DRY_RUN:
            print(f"  ✓ {rows[0]['code']} {rows[0]['name'][:45]:45}: {list(u['updates'].keys())}")
        else:
            cur.execute(sql, params)
            print(f"  ✓ {rows[0]['code']} {rows[0]['name'][:45]:45}: updated {list(u['updates'].keys())}")

    # 3) INSERT new projects (APSEZ as Hybrid)
    for n in NEW_PROJECTS:
        cur.execute('SELECT id FROM grid_regions WHERE code = %s', (n["region"],))
        rg = cur.fetchone()
        cur.execute('SELECT id FROM plant_types WHERE label = %s', (n["plant_type"],))
        pt = cur.fetchone()
        if not rg or not pt:
            print(f"  ⚠️  missing region/plant_type for {n['name']}")
            continue
        cur.execute('SELECT id FROM pooling_stations WHERE name = %s', (n["pooling_station"],))
        ps = cur.fetchone()
        ps_id = ps["id"] if ps else None

        proj_id   = cuid_like()
        phase_id  = cuid_like()
        contd4_id = cuid_like()
        now = datetime.utcnow()

        if DRY_RUN:
            print(f"  ✓ INSERT [{n['region']}] {n['name']} ({n['plant_type']})")
        else:
            cur.execute("""
                INSERT INTO generation_projects (id, name, "regionId", "plantTypeId",
                    "poolingStationId", "totalCapacityMw", "createdById",
                    "createdAt", "updatedAt")
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (proj_id, n["name"], rg["id"], pt["id"], ps_id,
                  n["total_cap"], admin_id, now, now))
            cur.execute("""
                INSERT INTO contd4_applications (id, "projectId", "applicationDate",
                    "capacityApr26Mw", status, "createdAt", "updatedAt")
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (contd4_id, proj_id, now, n["contd4_cap"], n["contd4_status"], now, now))
            cur.execute("""
                INSERT INTO commissioning_phases (id, "projectId", "sourceType",
                    "capacityAppliedMw", "ftcCompletedMw", "capacityUnderFtcMw",
                    "tocIssuedMw", "codDeclaredMw", "expectedApr26Mw",
                    "createdAt", "updatedAt")
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (phase_id, proj_id, n["phase_source"], n["applied"],
                  n["ftc_completed"], n.get("under_ftc", 0), n["toc_issued"],
                  n["cod_declared"], n["expected"], now, now))
            print(f"  ✓ INSERT [{n['region']}] {n['name']} ({n['plant_type']})")

    if DRY_RUN:
        conn.rollback()
        print("\n  [DRY RUN] no changes committed")
    else:
        conn.commit()
        print("\n  ✅ All round-2 changes committed.")
    conn.close()


if __name__ == "__main__":
    main()
