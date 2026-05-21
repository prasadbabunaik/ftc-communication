#!/usr/bin/env python3
"""
Extract CONTD-4, FTC, and Transmission rows from the May 21, 2026 Excel,
using the exact same logic as scripts/seed-snapshots.py.

Output: scripts/seed-may21.json with shape
    { "contd4": [...], "ftc": [...], "tx": [...] }

Usage:
    python3 scripts/extract-may21.py
"""

import json, sys
from pathlib import Path
from collections import Counter

import openpyxl

# Reuse the extractor from seed-snapshots.py without modifying it.
sys.path.insert(0, str(Path(__file__).parent))
from importlib import import_module
seed_snap = import_module('seed-snapshots')
extract_workbook = seed_snap.extract_workbook

EXCEL_PATH = Path('public/data/excel/CONTD_and_FTC_details_21.05.26.xlsx')
OUT_PATH = Path('scripts/seed-may21.json')


def main():
    if not EXCEL_PATH.exists():
        print(f"ERROR: Excel not found at {EXCEL_PATH}")
        sys.exit(1)

    wb = openpyxl.load_workbook(str(EXCEL_PATH), data_only=True)
    contd4, ftc, tx, hybrid_components = extract_workbook(wb)

    with open(OUT_PATH, 'w') as f:
        json.dump({
            'contd4': contd4, 'ftc': ftc, 'tx': tx,
            'hybridComponents': hybrid_components,
        }, f, indent=2, default=str)

    print(f"Wrote {OUT_PATH}")
    print(f"  Totals: contd4={len(contd4)}  ftc={len(ftc)}  tx={len(tx)}  hybridProjects={len(hybrid_components)}")

    # Per-region counts
    regions = ['NR', 'WR', 'SR', 'ER', 'NER']

    def by_region(items):
        c = Counter(i['region'] for i in items)
        return ' '.join(f"{r}={c.get(r, 0)}" for r in regions)

    print()
    print("Per-region counts:")
    print(f"  CONTD-4: {by_region(contd4)}")
    print(f"  FTC    : {by_region(ftc)}")
    print(f"  TX     : {by_region(tx)}")

    # Per-category counts (plantTypeCode for contd4/ftc; elementType for tx)
    print()
    print("Per-category counts:")
    pt_contd4 = Counter(p['plantTypeCode'] for p in contd4)
    pt_ftc = Counter(p['plantTypeCode'] for p in ftc)
    et_tx = Counter(e['elementType'] for e in tx)
    print(f"  CONTD-4 plantTypeCode: {dict(pt_contd4)}")
    print(f"  FTC plantTypeCode    : {dict(pt_ftc)}")
    print(f"  TX elementType       : {dict(et_tx)}")

    # Sanity: source types found in FTC phases
    ftc_src = Counter()
    for p in ftc:
        for ph in p.get('phases', []):
            ftc_src[ph.get('sourceType')] += 1
    print(f"  FTC phase sourceType : {dict(ftc_src)}")


if __name__ == '__main__':
    main()
