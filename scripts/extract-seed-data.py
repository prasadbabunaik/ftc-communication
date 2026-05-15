#!/usr/bin/env python3
"""
Extract FTC Communication data directly from April 30 Excel file.
Reads Section 2 (FTC projects), Section 1 (CONTD-4), Section 3 (Transmission).
Does NOT use ftc_data_dicts.py — reads raw sheets directly.
"""

import sys, json, re, argparse, openpyxl
from datetime import datetime
from pathlib import Path

# Defaults; can be overridden with --file / --out
EXCEL_FILE = Path('public/data/excel/CONTD and FTC details 30.04.xlsx')
OUT_FILE   = Path('scripts/seed-data.json')

# ── helpers ───────────────────────────────────────────────────────────────────

def parse_date(v):
    """Return first ISO date string YYYY-MM-DD found in v, or None."""
    if v is None: return None
    if isinstance(v, datetime): return v.strftime('%Y-%m-%d')
    s = str(v).strip()
    if not s or s in ('-', '0', 'None', '0.0', 'NA', 'N/A', '--'): return None
    # ISO datetime
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})T', s)
    if m: return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    # YYYY-MM-DD
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})', s)
    if m: return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    # DD-MM-YYYY or DD.MM.YYYY
    m = re.match(r'(\d{1,2})[-./](\d{1,2})[-./](\d{4})', s)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            datetime(y, mo, d)
            return f"{y}-{mo:02d}-{d:02d}"
        except ValueError:
            return None
    # Try first occurrence in arbitrary text
    m = re.search(r'(\d{1,2})[./](\d{1,2})[./](\d{4})', s)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            datetime(y, mo, d)
            return f"{y}-{mo:02d}-{d:02d}"
        except ValueError:
            return None
    return None

def safe_dec(v):
    """Return float or None. Skip Excel error strings."""
    if v is None: return None
    s = str(v).strip()
    if s in ('#VALUE!', '#N/A', '#NAME?', '#REF!', '#DIV/0!', '', '-', 'NA'): return None
    try:
        n = float(s)
        return n
    except (ValueError, TypeError):
        return None

def safe_str(v):
    if v is None: return None
    s = str(v).strip()
    return s or None

def plant_type_code(label):
    """Map plant type label → PlantType code."""
    if not label: return 'SOLAR'
    l = str(label).upper()
    if 'WIND' in l and 'SOLAR' in l and 'BESS' in l: return 'HYBRID_WSB'
    if 'WIND' in l and 'SOLAR' in l and 'PSP'  in l: return 'HYBRID_WP'
    if 'SOLAR' in l and 'PSP'  in l:                  return 'HYBRID_SP'
    if 'SOLAR' in l and 'BESS' in l:                  return 'HYBRID_SB'
    if 'WIND'  in l and 'SOLAR' in l:                 return 'HYBRID_WS'
    if 'HYDRO' in l and 'PSP'  in l:                  return 'HYBRID_HP'
    if 'WIND'  in l and 'PSP'  in l:                  return 'HYBRID_WP'
    if 'SOLAR'  in l:                                  return 'SOLAR'
    if 'WIND'   in l:                                  return 'WIND'
    if 'BESS'   in l or 'BATTERY' in l:               return 'BESS'
    if 'PSP'    in l or 'PUMPED'  in l or ('PUMP' in l and 'STORAGE' in l): return 'PSP'
    if 'HYDRO'  in l:                                  return 'HYDRO'
    if 'COAL'   in l or 'THERMAL' in l:               return 'COAL'
    if 'GAS'    in l:                                  return 'COAL'
    return 'SOLAR'

def source_type_primary(s):
    """Return primary SourceType enum value (SOLAR/WIND/BESS/COAL/HYDRO/PSP)."""
    if not s: return 'SOLAR'
    u = str(s).upper().strip()
    if 'PSP'    in u or 'PUMP' in u:                   return 'PSP'
    if 'HYDRO'  in u:                                   return 'HYDRO'
    if 'COAL'   in u or 'THERMAL' in u:                return 'COAL'
    if 'BESS'   in u or 'BATTERY' in u:               return 'BESS'
    if 'SOLAR'  in u:                                   return 'SOLAR'
    if 'WIND'   in u:                                   return 'WIND'
    if 'HYBRID' in u:                                   return 'SOLAR'
    return 'SOLAR'

def tx_type(t):
    if not t: return 'LINE'
    u = str(t).upper().strip()
    if u in ('LINE', 'SR', 'LINES'): return 'LINE'
    if u in ('ICT', 'PT'):           return 'ICT'
    if u in ('GT', 'BR', 'BAYS', 'REACTORS'): return 'GT'
    if u == 'ST':                    return 'ST'
    return 'LINE'

def clean_voltage(v):
    if v is None: return None
    m = re.search(r'(\d+)', str(v))
    return int(m.group(1)) if m else None

def clean_length(v):
    if v is None: return None
    m = re.search(r'(\d+(?:\.\d+)?)', str(v))
    return float(m.group(1)) if m else None

def is_sr_num(v):
    """Return True if v looks like a positive serial number."""
    if v is None: return False
    try:
        n = int(float(str(v)))
        return n > 0
    except (ValueError, TypeError):
        return False

def sheet_rows(ws, min_row, max_row):
    """Return list of (row_index, row_tuple) for rows with any non-None value."""
    results = []
    for i, row in enumerate(ws.iter_rows(min_row=min_row, max_row=max_row, values_only=True), min_row):
        if any(v is not None for v in row):
            results.append((i, row))
    return results

def find_section_header(ws, keywords, exclude=None, start_row=1, max_row=300):
    """Return the first row whose cells contain ALL keywords (and none of the exclude keywords)."""
    if isinstance(keywords, str):
        keywords = [keywords]
    for i, row in enumerate(ws.iter_rows(min_row=start_row, max_row=max_row, values_only=True), start_row):
        text = ' '.join(str(v or '') for v in row).lower()
        if all(k.lower() in text for k in keywords):
            if exclude and any(e.lower() in text for e in exclude):
                continue
            return i
    return None

def find_all_section_headers(ws, keywords, exclude=None, start_row=1, max_row=300):
    """Return all row numbers whose cells contain ALL keywords."""
    if isinstance(keywords, str):
        keywords = [keywords]
    hits = []
    for i, row in enumerate(ws.iter_rows(min_row=start_row, max_row=max_row, values_only=True), start_row):
        text = ' '.join(str(v or '') for v in row).lower()
        if all(k.lower() in text for k in keywords):
            if exclude and any(e.lower() in text for e in exclude):
                continue
            hits.append(i)
    return hits

# ── CONTD-4 extraction ────────────────────────────────────────────────────────

def extract_contd4(ws, region_code, title_row, end_row, col_offset=0):
    """
    Extract CONTD-4 data rows from title_row+1 to end_row.
    col_offset=1 for WR (has extra Developer column before Station name).
    Columns (1-based, without offset):
      2=Station, 3=PS, 4=Region, 5=GenType, 6=Cap, 7=AppDate, 8=ProposedFTC,
      9=CapApr26, 10=Issues
    """
    data_start = None
    for i in range(title_row + 1, min(title_row + 5, end_row)):
        row = list(ws.iter_rows(min_row=i, max_row=i, values_only=True))[0]
        if is_sr_num(row[0]):
            data_start = i
            break
    if data_start is None:
        return []

    records = []
    for i in range(data_start, end_row):
        row = list(ws.iter_rows(min_row=i, max_row=i, values_only=True))[0]
        if not is_sr_num(row[0]):
            continue

        o = col_offset
        name     = safe_str(row[1 + o])
        ps       = safe_str(row[2 + o])
        gen_type = safe_str(row[4 + o])
        cap      = safe_dec(row[5 + o])
        app_date = parse_date(row[6 + o])
        prop_ftc = parse_date(row[7 + o])
        cap_apr  = safe_dec(row[8 + o])
        issues   = safe_str(row[9 + o])

        if name and cap is not None:
            records.append({
                'name':           name,
                'region':         region_code,
                'plantTypeCode':  plant_type_code(gen_type),
                'poolingStation': ps,
                'totalCapacityMw': cap,
                'applicationDate': app_date,
                'proposedFtcDate': prop_ftc,
                'capacityApr26Mw': cap_apr,
                'capacityMonth':   '2026-04',
                'remarks':         issues,
                'status':          'PENDING',
            })

    return records

# ── FTC extraction ────────────────────────────────────────────────────────────

def extract_ftc(ws, region_code, title_row, end_row=None):
    """
    Extract FTC Section 2 data rows.
    Columns (1-based):
      2=Station, 3=PS, 4=PlantType, 5=Region, 6=TotalCap, 7=CONTD4Cap, 8=AppliedFTC,
      9=SourceType, 10=FTCCompleted, 11=FTCDate, 12=TOCIssued, 13=TOCDate,
      14=CODDeclared, 15=CODDate, 16=ProposedFTC, 17=UnderFTC, 18=UnderTOC,
      19=PendingCOD, 20=ExpApr26, 21=Issues, 22=OtherRemarks
    """
    data_start = None
    for i in range(title_row + 1, title_row + 5):
        row = list(ws.iter_rows(min_row=i, max_row=i, values_only=True))[0]
        if is_sr_num(row[0]):
            data_start = i
            break
    if data_start is None:
        return []

    limit = end_row if end_row else title_row + 150

    projects = []
    i = data_start
    while i < limit:
        row = list(ws.iter_rows(min_row=i, max_row=i, values_only=True))[0]
        if not is_sr_num(row[0]):
            i += 1
            continue

        name       = safe_str(row[1])
        ps         = safe_str(row[2])
        plant_type = safe_str(row[3])
        total_cap  = safe_dec(row[5])
        contd4_cap = safe_dec(row[6]) or None  # None when 0 (no CONTD-4 issued)
        applied_mw = safe_dec(row[7])
        src_type   = safe_str(row[8])
        ftc_done   = safe_dec(row[9])
        ftc_date   = parse_date(row[10])
        toc_issued = safe_dec(row[11])
        toc_date   = parse_date(row[12])
        cod_done   = safe_dec(row[13])
        cod_date   = parse_date(row[14])
        prop_ftc   = parse_date(row[15])
        under_ftc  = safe_dec(row[16])
        under_toc  = safe_dec(row[17])
        exp_apr    = safe_dec(row[19])
        issues     = safe_str(row[20])
        other_rem  = safe_str(row[21])

        if not name:
            i += 1
            continue

        pt_code  = plant_type_code(plant_type)
        src_enum = source_type_primary(src_type)

        projects.append({
            'name':           name,
            'region':         region_code,
            'plantTypeCode':  pt_code,
            'poolingStation': ps,
            'totalCapacityMw': total_cap or 0.0,
            'contd4CapacityMw': contd4_cap,
            'phases': [{
                'sourceType':         src_enum,
                'capacityAppliedMw':  applied_mw or 0.0,
                'ftcCompletedMw':     ftc_done,
                'ftcCompletedDate':   ftc_date,
                'proposedFtcDate':    prop_ftc,
                'capacityUnderFtcMw': under_ftc,
                'tocIssuedMw':        toc_issued,
                'tocIssuedDate':      toc_date,
                'capacityUnderTocMw': under_toc,
                'codDeclaredMw':      cod_done,
                'codDeclaredDate':    cod_date,
                'expectedApr26Mw':    exp_apr,
                'delayRemarks':       issues,
                'otherRemarks':       other_rem,
            }],
        })
        i += 1

    return projects

# ── Transmission extraction ───────────────────────────────────────────────────

def extract_tx(ws, region_code, title_row, end_row=None):
    """
    Extract Transmission Elements Section 3.
    Columns (1-based):
      2=Agency, 3=Name, 4=Type, 5=RE, 6=Voltage, 7=CapMVA, 8=LineKm,
      9=FirstEnergy, 10=PendingFTC, 11=ProposedFTC, 12=CapApr26MVA,
      13=LenApr26Km, 14=Remarks
    """
    data_start = None
    for i in range(title_row + 1, title_row + 5):
        row = list(ws.iter_rows(min_row=i, max_row=i, values_only=True))[0]
        if is_sr_num(row[0]):
            data_start = i
            break
    if data_start is None:
        return []

    limit = end_row if end_row else title_row + 100

    elements = []
    i = data_start
    while i < limit:
        row = list(ws.iter_rows(min_row=i, max_row=i, values_only=True))[0]
        if not is_sr_num(row[0]):
            i += 1
            continue

        agency    = safe_str(row[1])
        ename     = safe_str(row[2])
        etype     = safe_str(row[3])
        re_flag   = safe_str(row[4])
        voltage   = clean_voltage(row[5])
        cap_mva   = safe_dec(row[6])
        line_km   = clean_length(row[7])
        first_e   = parse_date(row[8])
        pending   = safe_str(row[9])
        prop_ftc  = parse_date(row[10])
        cap_apr   = safe_dec(row[11])
        len_apr   = clean_length(row[12])
        remarks   = safe_str(row[13])

        if not ename and not agency:
            i += 1
            continue

        pending_bool = str(pending or '').strip().upper() in ('YES', 'Y')

        elements.append({
            'region':            region_code,
            'agencyOwner':       agency or '',
            'elementName':       ename or '',
            'elementType':       tx_type(etype),
            'isRe':              str(re_flag or '').strip().upper() == 'RE',
            'voltageRatingKv':   voltage,
            'capacityMva':       cap_mva,
            'lineLengthKm':      line_km,
            'firstEnergyDate':   first_e,
            'pendingFtc':        pending_bool,
            'proposedFtcDate':   prop_ftc,
            'capacityApr26Mva':  cap_apr,
            'lineLengthApr26Km': len_apr,
            'remarks':           remarks,
        })
        i += 1

    return elements

# ── main ─────────────────────────────────────────────────────────────────────

def main():
    global EXCEL_FILE, OUT_FILE
    ap = argparse.ArgumentParser()
    ap.add_argument('--file', help='Path to Excel file (default: ' + str(EXCEL_FILE) + ')')
    ap.add_argument('--out',  help='Output JSON path (default: ' + str(OUT_FILE) + ')')
    args = ap.parse_args()
    if args.file: EXCEL_FILE = Path(args.file)
    if args.out:  OUT_FILE   = Path(args.out)

    wb = openpyxl.load_workbook(str(EXCEL_FILE), data_only=True)

    contd4_projects = []
    ftc_projects    = []
    trans_elements  = []

    regions = {
        'NR': ('NR', 0),   # col_offset=0 for CONTD-4
        'WR': ('WR', 1),   # col_offset=1 for WR (has Developer column)
        'ER': ('ER', 0),
        'NER': ('NER', 0),
        'SR': ('SR', 0),
    }

    for sheet_name, (region_code, c4_col_offset) in regions.items():
        ws = wb[sheet_name]
        print(f'\nProcessing {sheet_name}...')

        # ── Find section title rows ──────────────────────────────────────────
        contd4_title = find_section_header(ws, 'CONTD-4', start_row=1, max_row=10)
        # "Generation Capacity Under Process of FTC" — excludes Transmission rows
        ftc_titles = find_all_section_headers(
            ws, ['Generation Capacity', 'FTC'],
            exclude=['Transmission', 'Source wise'],
            start_row=1, max_row=200,
        )
        source_wise_title = find_section_header(ws, 'Source wise Segregation', start_row=1, max_row=300)
        tx_title = find_section_header(ws, ['Transmission Elements', 'FTC'], start_row=1, max_row=300)

        if not contd4_title:
            print(f'  WARNING: No CONTD-4 section found in {sheet_name}')
        if not ftc_titles:
            print(f'  WARNING: No FTC section found in {sheet_name}')

        # ── CONTD-4 ─────────────────────────────────────────────────────────
        if contd4_title:
            # End before FTC section (or TX section if no FTC)
            c4_end_candidates = [t for t in [ftc_titles[0] if ftc_titles else None, tx_title]
                                 if t and t > contd4_title]
            c4_end = min(c4_end_candidates) if c4_end_candidates else contd4_title + 100
            c4 = extract_contd4(ws, region_code, contd4_title, c4_end, col_offset=c4_col_offset)
            print(f'  CONTD-4: {len(c4)} projects (rows {contd4_title}-{c4_end})')
            contd4_projects.extend(c4)

        # ── FTC ─────────────────────────────────────────────────────────────
        # For SR: first FTC section is Section 2A (non-hybrid, counted in Summary)
        #         second FTC section is Section 2B (hybrid source-wise, excluded from Summary)
        # For others: first FTC section is the main Section 2
        # The source_wise_title marks the start of the "excluded" section for other regions
        if ftc_titles:
            # Use the FIRST FTC section (Section 2A for SR, Section 2 for others)
            main_ftc_title = ftc_titles[0]

            # Determine end row for FTC extraction (stop before TX section or FTC-2B)
            candidates = [t for t in [tx_title, source_wise_title] if t and t > main_ftc_title]
            # For SR: FTC-2B is a second 'Generation Capacity FTC' section — do NOT extract it
            if len(ftc_titles) >= 2:
                candidates.append(ftc_titles[1])
            ftc_end = min(candidates) if candidates else None

            ftc = extract_ftc(ws, region_code, main_ftc_title, end_row=ftc_end)
            print(f'  FTC:     {len(ftc)} projects (title row {main_ftc_title}, end {ftc_end})')
            ftc_projects.extend(ftc)

        # ── Transmission ────────────────────────────────────────────────────
        if tx_title:
            # End before next major section
            # For SR: end before Section 2B (second FTC section)
            tx_end = None
            if sheet_name == 'SR' and ftc_titles:
                for t in ftc_titles:
                    if t > tx_title + 5:
                        tx_end = t
                        break
            elif source_wise_title and source_wise_title > tx_title:
                tx_end = source_wise_title

            tx = extract_tx(ws, region_code, tx_title, end_row=tx_end)
            print(f'  TX:      {len(tx)} elements (title row {tx_title})')
            trans_elements.extend(tx)

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f'\n=== Extraction Summary ===')
    print(f'  CONTD-4 projects: {len(contd4_projects)}')
    print(f'  FTC projects:     {len(ftc_projects)}')
    print(f'  FTC total phases: {sum(len(p["phases"]) for p in ftc_projects)}')
    print(f'  Trans elements:   {len(trans_elements)}')

    out = {
        'contd4Projects': contd4_projects,
        'ftcProjects':    ftc_projects,
        'transElements':  trans_elements,
    }

    with open(str(OUT_FILE), 'w') as f:
        json.dump(out, f, indent=2, default=str)
    print(f'\nWritten: {OUT_FILE}')

if __name__ == '__main__':
    main()
