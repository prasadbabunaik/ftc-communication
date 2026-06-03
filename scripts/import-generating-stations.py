#!/usr/bin/env python3
"""Extract the master generating-station list from the Station list workbook
into scripts/generating-stations.json for the DB loader.

Usage:  python3 scripts/import-generating-stations.py
Then:   node scripts/import-generating-stations-db.js
"""
import json, openpyxl
from pathlib import Path

SRC = Path('public/data/excel/Staion list.xlsx')
OUT = Path('scripts/generating-stations.json')
VALID_REGIONS = {'NR', 'WR', 'SR', 'ER', 'NER'}

def clean(v):
    if v is None:
        return None
    s = str(v).replace('\n', ' ').strip()
    return s or None

def main():
    wb = openpyxl.load_workbook(str(SRC), data_only=True)
    ws = wb['List']
    rows, seen = [], set()
    dups = 0
    for r in ws.iter_rows(min_row=2, values_only=True):
        name = clean(r[1])
        if not name:
            continue
        key = name.upper()
        if key in seen:
            dups += 1
            continue
        seen.add(key)
        region = clean(r[3])
        if region and region.upper() not in VALID_REGIONS:
            region = None
        rows.append({
            'name': name,
            'poolingStationName': clean(r[2]),
            'regionCode': region.upper() if region else None,
        })
    OUT.write_text(json.dumps(rows))
    print(f'Wrote {len(rows)} stations to {OUT} (skipped {dups} duplicates)')

if __name__ == '__main__':
    main()
