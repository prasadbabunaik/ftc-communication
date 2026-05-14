#!/usr/bin/env python3
"""
Comprehensive validation: for each of the 13 Excel files, extracts data from
regional sheets, computes summary tables (same logic as app), then compares
with the file's own Summary sheet. Reports all discrepancies.
"""

import sys, re, openpyxl
from datetime import datetime
from pathlib import Path

EXCEL_DIR = Path('public/data/excel')
TOL = 0.02  # floating-point tolerance for MW comparisons

FILES = [
    ('2026-04-23', 'CONTD and FTC details 23.04.26.xlsx'),
    ('2026-04-24', 'CONTD and FTC details 24.04.26.xlsx'),
    ('2026-04-27', 'CONTD and FTC details 27.04.2026.xlsx'),
    ('2026-04-28', 'CONTD and FTC details 280426.xlsx'),
    ('2026-04-29', 'CONTD and FTC details 290426.xlsx'),
    ('2026-04-30', 'CONTD and FTC details 30.04.xlsx'),
    ('2026-05-02', 'CONTD and FTC details 02.05.26.xlsx'),
    ('2026-05-04', 'CONTD and FTC details 04.05.26.xlsx'),
    ('2026-05-06', 'CONTD and FTC details 06052026.xlsx'),
    ('2026-05-07', 'CONTD and FTC details 07.05.26.xlsx'),
    ('2026-05-11', 'CONTD and FTC details 110526.xlsx'),
    ('2026-05-12', 'CONTD and FTC details 120526.xlsx'),
    ('2026-05-13', 'CONTD and FTC details 130526.xlsx'),
]

# ── helpers ──────────────────────────────────────────────────────────────────

def safe_dec(v):
    if v is None: return 0.0
    s = str(v).strip()
    if s in ('#VALUE!', '#N/A', '#NAME?', '#REF!', '#DIV/0!', '', '-', 'NA', 'None', '0.0'): return 0.0
    try:
        return float(s)
    except (ValueError, TypeError):
        return 0.0

def safe_str(v):
    if v is None: return None
    s = str(v).strip()
    return s or None

def parse_date(v):
    if v is None: return None
    if isinstance(v, datetime): return v.strftime('%Y-%m-%d')
    s = str(v).strip()
    if not s or s in ('-', '0', 'None', '0.0', 'NA', 'N/A', '--'): return None
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})', s)
    if m: return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.match(r'(\d{1,2})[-./](\d{1,2})[-./](\d{4})', s)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            datetime(y, mo, d)
            return f"{y}-{mo:02d}-{d:02d}"
        except ValueError:
            return None
    return None

def parse_capacity_month(v):
    """Parse "April'26", "May'26", etc. → YYYY-MM string."""
    if v is None: return None
    s = str(v).strip()
    MONTHS = {
        'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
        'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
        'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12',
    }
    # Match "April'26" or "Apr'26" or "April 26" etc.
    m = re.match(r"([A-Za-z]+)['\s-]?(\d{2,4})", s)
    if m:
        mon_str = m.group(1)[:3].lower()
        yr = m.group(2)
        if len(yr) == 2:
            yr = '20' + yr
        if mon_str in MONTHS:
            return f"{yr}-{MONTHS[mon_str]}"
    return None

def is_sr_num(v):
    if v is None: return False
    try:
        n = int(float(str(v)))
        return n > 0
    except (ValueError, TypeError):
        return False

def clean_voltage(v):
    if v is None: return None
    m = re.search(r'(\d+)', str(v))
    return int(m.group(1)) if m else None

def clean_length(v):
    if v is None: return None
    m = re.search(r'(\d+(?:\.\d+)?)', str(v))
    return float(m.group(1)) if m else None

def find_section_header(ws, keywords, exclude=None, start_row=1, max_row=300):
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

def plant_type_code(label):
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
    if not s: return 'SOLAR'
    u = str(s).upper().strip()
    if 'PSP' in u or 'PUMP' in u: return 'PSP'
    if 'HYDRO' in u: return 'HYDRO'
    if 'COAL' in u or 'THERMAL' in u: return 'COAL'
    if 'BESS' in u or 'BATTERY' in u: return 'BESS'
    if 'SOLAR' in u: return 'SOLAR'
    if 'WIND' in u: return 'WIND'
    return 'SOLAR'

def get_source_from_project(p):
    """Replicate app's getProjectSource() logic."""
    pt = p.get('plantTypeCode', 'SOLAR')
    if 'HYBRID' in pt:
        return 'HYBRID'
    phases = p.get('phases', [])
    if phases:
        return phases[0].get('sourceType', 'SOLAR')
    if pt == 'SOLAR': return 'SOLAR'
    if pt == 'WIND': return 'WIND'
    if pt == 'BESS': return 'BESS'
    if pt == 'COAL': return 'COAL'
    if pt == 'HYDRO': return 'HYDRO'
    if pt == 'PSP': return 'PSP'
    return 'SOLAR'

def tx_type(t):
    if not t: return 'LINE'
    u = str(t).upper().strip()
    if u in ('LINE', 'SR', 'LINES'): return 'LINE'
    if u in ('ICT', 'PT'):           return 'ICT'
    if u in ('GT', 'BR', 'BAYS', 'REACTORS'): return 'GT'
    if u == 'ST':                    return 'ST'
    return 'LINE'

# ── Extraction functions ──────────────────────────────────────────────────────

def extract_contd4(ws, region_code, title_row, end_row, col_offset=0):
    """Extract CONTD-4 rows; parse capacityMonth dynamically from col 7."""
    data_start = None
    for i in range(title_row + 1, min(title_row + 5, end_row)):
        row = list(ws.iter_rows(min_row=i, max_row=i, values_only=True))[0]
        if is_sr_num(row[0]):
            data_start = i
            break
    if data_start is None:
        return []

    records = []
    last_region = region_code
    for i in range(data_start, end_row):
        row = list(ws.iter_rows(min_row=i, max_row=i, values_only=True))[0]

        o = col_offset
        if is_sr_num(row[0]):
            # Normal data row
            name      = safe_str(row[1 + o])
            gen_type  = safe_str(row[4 + o])
            cap       = safe_dec(row[5 + o])
            cap_apr   = safe_dec(row[8 + o])
            cap_month_raw = safe_str(row[7 + o])
            cap_month = parse_capacity_month(cap_month_raw)
            if name and cap > 0:
                records.append({
                    'name':            name,
                    'region':          region_code,
                    'plantTypeCode':   plant_type_code(gen_type),
                    'totalCapacityMw': cap,
                    'capacityApr26Mw': cap_apr,
                    'capacityMonth':   cap_month,
                })
        else:
            # Continuation row: Sr.No is None but has gen_type and cap (e.g. Serentica BESS)
            # Pattern: row[0]=None, row[1+o..3+o]=None, row[4+o]=genType, row[5+o]=cap
            gen_type = safe_str(row[4 + o])
            cap      = safe_dec(row[5 + o])
            cap_apr  = safe_dec(row[8 + o])
            cap_month_raw = safe_str(row[7 + o])
            cap_month = parse_capacity_month(cap_month_raw)
            has_name_cols_empty = all(row[j + o] is None for j in range(1, 4) if j + o < len(row))
            if gen_type and cap and cap > 0 and has_name_cols_empty:
                # Use last station name with a suffix
                last_name = records[-1]['name'] if records else 'Unknown'
                records.append({
                    'name':            f"{last_name} ({gen_type})",
                    'region':          region_code,
                    'plantTypeCode':   plant_type_code(gen_type),
                    'totalCapacityMw': cap,
                    'capacityApr26Mw': cap_apr or 0.0,
                    'capacityMonth':   cap_month,
                })
    return records

def extract_ftc(ws, region_code, title_row, end_row=None):
    """Extract FTC project rows."""
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
        plant_tp   = safe_str(row[3])
        total_cap  = safe_dec(row[5])
        contd4_cap = safe_dec(row[6])
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

        if not name:
            i += 1
            continue

        pt_code  = plant_type_code(plant_tp)
        src_enum = source_type_primary(src_type)

        projects.append({
            'name':            name,
            'region':          region_code,
            'plantTypeCode':   pt_code,
            'totalCapacityMw': total_cap,
            'contd4CapacityMw': contd4_cap,
            'phases': [{
                'sourceType':         src_enum,
                'capacityAppliedMw':  applied_mw,
                'ftcCompletedMw':     ftc_done,
                'capacityUnderFtcMw': under_ftc,
                'tocIssuedMw':        toc_issued,
                'capacityUnderTocMw': under_toc,
                'codDeclaredMw':      cod_done,
                'expectedApr26Mw':    exp_apr,
            }],
        })
        i += 1

    return projects

def extract_tx(ws, region_code, title_row, end_row=None):
    """Extract Transmission Elements."""
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

        ename    = safe_str(row[2])
        etype    = safe_str(row[3])
        re_flag  = safe_str(row[4])
        cap_mva  = safe_dec(row[6])
        line_km  = clean_length(row[7])
        pending  = safe_str(row[9])
        cap_apr  = safe_dec(row[11])
        len_apr  = clean_length(row[12])

        if not ename:
            i += 1
            continue

        pending_bool = str(pending or '').strip().upper() in ('YES', 'Y')
        is_re = str(re_flag or '').strip().upper() == 'RE'

        elements.append({
            'region':            region_code,
            'elementName':       ename,
            'elementType':       tx_type(etype),
            'isRe':              is_re,
            'capacityMva':       cap_mva,
            'lineLengthKm':      line_km,
            'pendingFtc':        pending_bool,
            'capacityApr26Mva':  cap_apr,
            'lineLengthApr26Km': len_apr,
        })
        i += 1
    return elements

def extract_workbook(wb):
    """Extract all data from a workbook's regional sheets."""
    contd4 = []
    ftc    = []
    tx     = []

    regions = {
        'NR': ('NR', 0),
        'WR': ('WR', 1),
        'ER': ('ER', 0),
        'NER': ('NER', 0),
        'SR': ('SR', 0),
    }

    for sheet_name, (region_code, c4_offset) in regions.items():
        if sheet_name not in wb.sheetnames:
            continue
        ws = wb[sheet_name]

        contd4_title = find_section_header(ws, 'CONTD-4', start_row=1, max_row=10)
        ftc_titles   = find_all_section_headers(ws, ['Generation Capacity', 'FTC'],
                            exclude=['Transmission', 'Source wise'], start_row=1, max_row=200)
        source_wise  = find_section_header(ws, 'Source wise Segregation', start_row=1, max_row=300)
        tx_title     = find_section_header(ws, ['Transmission Elements', 'FTC'], start_row=1, max_row=300)

        if contd4_title:
            ends = [t for t in [(ftc_titles[0] if ftc_titles else None), tx_title] if t and t > contd4_title]
            c4_end = min(ends) if ends else contd4_title + 100
            contd4.extend(extract_contd4(ws, region_code, contd4_title, c4_end, c4_offset))

        if ftc_titles:
            main_ftc = ftc_titles[0]
            cands = [t for t in [tx_title, source_wise] if t and t > main_ftc]
            if len(ftc_titles) >= 2:
                cands.append(ftc_titles[1])
            ftc_end = min(cands) if cands else None
            ftc.extend(extract_ftc(ws, region_code, main_ftc, end_row=ftc_end))

        if tx_title:
            tx_end = None
            if sheet_name == 'SR' and ftc_titles:
                for t in ftc_titles:
                    if t > tx_title + 5:
                        tx_end = t
                        break
            elif source_wise and source_wise > tx_title:
                tx_end = source_wise
            tx.extend(extract_tx(ws, region_code, tx_title, end_row=tx_end))

    return contd4, ftc, tx

# ── Compute summary tables ────────────────────────────────────────────────────

def compute_t1(contd4_projects):
    """Group active CONTD-4 projects by region×source."""
    t1 = {}
    for p in contd4_projects:
        region = p['region']
        source = get_source_from_project(p)
        key = f"{region}|{source}"
        if key not in t1:
            t1[key] = {'region': region, 'source': source, 'totalMw': 0.0, 'months': {}}
        t1[key]['totalMw'] += p['totalCapacityMw']
        month = p.get('capacityMonth')
        mw    = p.get('capacityApr26Mw', 0.0)
        if month and mw:
            t1[key]['months'][month] = t1[key]['months'].get(month, 0.0) + mw
    return t1

def compute_t2(ftc_projects):
    """Group CLEARED FTC projects by region×source."""
    t2 = {}
    for p in ftc_projects:
        region = p['region']
        source = get_source_from_project(p)
        key = f"{region}|{source}"
        if key not in t2:
            t2[key] = {
                'region': region, 'source': source,
                'totalMw': 0.0, 'contd4Mw': 0.0, 'appliedMw': 0.0,
                'ftcMw': 0.0, 'ftcPendingMw': 0.0, 'tocMw': 0.0,
                'tocPendingMw': 0.0, 'codMw': 0.0, 'codPendingMw': 0.0,
                'expectedMw': 0.0,
            }
        row = t2[key]
        row['totalMw']  += p['totalCapacityMw']
        row['contd4Mw'] += p.get('contd4CapacityMw') or 0.0
        for ph in p.get('phases', []):
            row['appliedMw']    += ph.get('capacityAppliedMw') or 0.0
            row['ftcMw']        += ph.get('ftcCompletedMw') or 0.0
            row['ftcPendingMw'] += ph.get('capacityUnderFtcMw') or 0.0
            row['tocMw']        += ph.get('tocIssuedMw') or 0.0
            row['tocPendingMw'] += ph.get('capacityUnderTocMw') or 0.0
            cod_val              = ph.get('codDeclaredMw') or 0.0
            toc_val              = ph.get('tocIssuedMw') or 0.0
            row['codMw']        += cod_val
            row['codPendingMw'] += max(0.0, toc_val - cod_val)
            row['expectedMw']   += ph.get('expectedApr26Mw') or 0.0
    return t2

def compute_t3(tx_elements):
    """Group TX elements by region×category."""
    t3 = {}
    for el in tx_elements:
        region = el['region']
        is_re  = el['isRe']
        etype  = el['elementType']
        if etype == 'LINE':
            cat = 'LINE_RE' if is_re else 'LINE_NONRE'
        elif etype == 'ICT':
            cat = 'ICT_RE' if is_re else 'ICT_NONRE'
        else:
            continue  # Skip GT, ST — not in Summary

        key = f"{region}|{cat}"
        if key not in t3:
            t3[key] = {'completedNo': 0, 'completedKmMva': 0.0, 'pendingNo': 0, 'pendingKmMva': 0.0}
        row = t3[key]
        is_line = (etype == 'LINE')
        if not el['pendingFtc']:
            row['completedNo'] += 1
            comp_val = el['lineLengthKm'] if is_line else el['capacityMva']
            row['completedKmMva'] += comp_val or 0.0
        else:
            row['pendingNo'] += 1
            if is_line:
                pend_val = (el['lineLengthApr26Km'] or 0.0) or (el['lineLengthKm'] or 0.0)
            else:
                pend_val = (el['capacityApr26Mva'] or 0.0) or (el['capacityMva'] or 0.0)
            row['pendingKmMva'] += pend_val
    return t3

# ── Read Excel Summary sheet ──────────────────────────────────────────────────

EXCEL_SOURCE_MAP = {
    'wind': 'WIND',
    'solar': 'SOLAR',
    'bess': 'BESS',
    'hybrid': 'HYBRID',
    'hybrid(wind+solar)': 'HYBRID',
    'hybrid(solar+bess)': 'HYBRID',
    'hybrid(wind+solar+bess)': 'HYBRID',
    'coal': 'COAL',
    'hydro': 'HYDRO',
    'psp': 'PSP',
}

T1_REGIONS = {  # region → (start_row, end_row_excl)
    'NR': (6, 12),
    'WR': (13, 19),
    'SR': (20, 26),
}

T2_REGIONS = {  # region → (start_row, end_row_excl)
    'NR':  (38, 45),
    'WR':  (46, 53),
    'SR':  (54, 61),
    'ER':  (62, 69),
    'NER': (70, 77),
}

T3_REGIONS = {  # region → (start_row, end_row_excl)
    'NR':  (91, 95),
    'WR':  (95, 99),
    'SR':  (99, 103),
    'ER':  (103, 107),
    'NER': (107, 111),
}

T3_CAT_LABELS = [
    ('LINE_RE',   ['line', 're pocket']),
    ('LINE_NONRE',['line', 'non', 'pocket']),  # matches "Not RE" and "Non RE"
    ('ICT_RE',    ['ict', 're pocket']),
    ('ICT_NONRE', ['ict', 'non']),
]

def norm_tx_label(s):
    if not s: return ''
    return str(s).lower()

def classify_tx_label(s):
    n = norm_tx_label(s)
    # Check NONRE before RE to avoid false positive ('not re pocket' contains 're pocket')
    if 'line' in n and ('not' in n or 'non' in n):
        return 'LINE_NONRE'
    if 'line' in n and 're' in n:
        return 'LINE_RE'
    if 'ict' in n and ('non' in n or 'not' in n):
        return 'ICT_NONRE'
    if 'ict' in n and 're' in n:
        return 'ICT_RE'
    return None

def read_summary_t1(ws):
    """Read Table 1 from Summary sheet. Returns dict keyed by 'region|source'."""
    result = {}
    current_region = None
    for row_num in range(5, 34):
        row = list(ws.iter_rows(min_row=row_num, max_row=row_num, values_only=True))[0]
        if row[0] and str(row[0]).strip() in ('NR', 'WR', 'SR', 'ER', 'NER', 'All India'):
            current_region = str(row[0]).strip()
        if not current_region or current_region == 'All India':
            continue
        src_raw = safe_str(row[1])
        if not src_raw or src_raw.lower() == 'total':
            continue
        src = EXCEL_SOURCE_MAP.get(src_raw.lower())
        if not src:
            continue
        key = f"{current_region}|{src}"
        total_mw  = safe_dec(row[2])
        mar26_mw  = safe_dec(row[3])
        apr26_mw  = safe_dec(row[4])
        may26_mw  = safe_dec(row[5])
        jun26_mw  = safe_dec(row[6])
        entry = result.get(key, {'totalMw': 0.0, 'months': {}})
        entry['totalMw'] += total_mw
        if apr26_mw: entry['months']['2026-04'] = entry['months'].get('2026-04', 0.0) + apr26_mw
        if may26_mw: entry['months']['2026-05'] = entry['months'].get('2026-05', 0.0) + may26_mw
        if mar26_mw: entry['months']['2026-03'] = entry['months'].get('2026-03', 0.0) + mar26_mw
        if jun26_mw: entry['months']['2026-06'] = entry['months'].get('2026-06', 0.0) + jun26_mw
        result[key] = entry
    return result

def read_summary_t2(ws):
    """Read Table 2 from Summary sheet."""
    result = {}
    current_region = None
    for row_num in range(36, 86):
        row = list(ws.iter_rows(min_row=row_num, max_row=row_num, values_only=True))[0]
        if row[0] and str(row[0]).strip() in ('NR', 'WR', 'SR', 'ER', 'NER', 'All India'):
            current_region = str(row[0]).strip()
        if not current_region or current_region == 'All India':
            continue
        src_raw = safe_str(row[1])
        if not src_raw or src_raw.lower() == 'total':
            continue
        src = EXCEL_SOURCE_MAP.get(src_raw.lower())
        if not src:
            continue
        key = f"{current_region}|{src}"
        if key not in result:
            result[key] = {
                'totalMw': 0.0, 'contd4Mw': 0.0, 'appliedMw': 0.0,
                'ftcMw': 0.0, 'ftcPendingMw': 0.0, 'tocMw': 0.0,
                'tocPendingMw': 0.0, 'codMw': 0.0, 'codPendingMw': 0.0,
                'expectedMw': 0.0,
            }
        r = result[key]
        # Excel columns: 2=total, 3=contd4, 4=applied, 5=ftc, 6=ftcPend, 7=toc, 8=tocPend, 9=cod, 10=codPend, 11=exp
        r['totalMw']      += safe_dec(row[2])
        r['contd4Mw']     += safe_dec(row[3])
        r['appliedMw']    += safe_dec(row[4])
        r['ftcMw']        += safe_dec(row[5])
        r['ftcPendingMw'] += safe_dec(row[6])
        r['tocMw']        += safe_dec(row[7])
        r['tocPendingMw'] += safe_dec(row[8])
        r['codMw']        += safe_dec(row[9])
        r['codPendingMw'] += safe_dec(row[10])
        r['expectedMw']   += safe_dec(row[11])
    return result

def read_summary_t3(ws):
    """Read Table 3 (TX) from Summary sheet."""
    result = {}
    current_region = None
    for row_num in range(88, 115):
        row = list(ws.iter_rows(min_row=row_num, max_row=row_num, values_only=True))[0]
        if row[0] and str(row[0]).strip() in ('NR', 'WR', 'SR', 'ER', 'NER', 'All India'):
            current_region = str(row[0]).strip()
        if not current_region or current_region == 'All India':
            continue
        label = safe_str(row[1])
        cat   = classify_tx_label(label)
        if not cat:
            continue
        key = f"{current_region}|{cat}"
        if key not in result:
            result[key] = {'completedKmMva': 0.0, 'completedNo': 0, 'pendingKmMva': 0.0, 'pendingNo': 0}
        r = result[key]
        r['completedKmMva'] += safe_dec(row[2])
        r['completedNo']    += int(safe_dec(row[3]))
        r['pendingKmMva']   += safe_dec(row[4])
        r['pendingNo']      += int(safe_dec(row[5]))
    return result

# ── Comparison and reporting ──────────────────────────────────────────────────

def approx_eq(a, b, tol=TOL):
    return abs(a - b) <= tol + tol * max(abs(a), abs(b), 1.0) * 0.001

def cmp_sym(ok):
    return '✅' if ok else '❌'

def fmt(v):
    if isinstance(v, float):
        if v == int(v): return str(int(v))
        return f"{v:.2f}"
    return str(v)

def compare_t1(computed, excel, date_str):
    """Compare Table 1: CONTD-4 study."""
    issues = []
    all_keys = sorted(set(list(computed.keys()) + list(excel.keys())))
    REGIONS = ['NR', 'WR', 'SR', 'ER', 'NER']

    print(f"\n  {'Region':<6} {'Source':<8} {'CmpTotal':>9} {'XlTotal':>9} {'CmpApr':>8} {'XlApr':>8} {'CmpMay':>8} {'XlMay':>8}  Status")
    print(f"  {'-'*6} {'-'*8} {'-'*9} {'-'*9} {'-'*8} {'-'*8} {'-'*8} {'-'*8}  ------")

    for key in all_keys:
        region, source = key.split('|')
        if region not in REGIONS:
            continue
        c = computed.get(key, {'totalMw': 0.0, 'months': {}})
        x = excel.get(key, {'totalMw': 0.0, 'months': {}})
        c_total = c['totalMw']
        x_total = x['totalMw']
        c_apr = c['months'].get('2026-04', 0.0)
        x_apr = x['months'].get('2026-04', 0.0)
        c_may = c['months'].get('2026-05', 0.0)
        x_may = x['months'].get('2026-05', 0.0)
        ok = approx_eq(c_total, x_total) and approx_eq(c_apr, x_apr) and approx_eq(c_may, x_may)
        sym = cmp_sym(ok)
        if not ok:
            issues.append(f"T1 {key}: total={fmt(c_total)} vs {fmt(x_total)}, apr={fmt(c_apr)} vs {fmt(x_apr)}, may={fmt(c_may)} vs {fmt(x_may)}")
        print(f"  {region:<6} {source:<8} {fmt(c_total):>9} {fmt(x_total):>9} {fmt(c_apr):>8} {fmt(x_apr):>8} {fmt(c_may):>8} {fmt(x_may):>8}  {sym}")
    return issues

def compare_t2(computed, excel, date_str):
    """Compare Table 2: FTC Pipeline."""
    issues = []
    FIELDS = [
        ('totalMw', 'total'), ('contd4Mw', 'contd4'), ('appliedMw', 'applied'),
        ('ftcMw', 'ftcOK'), ('ftcPendingMw', 'ftcPend'),
        ('tocMw', 'tocOK'), ('tocPendingMw', 'tocPend'),
        ('codMw', 'codOK'), ('codPendingMw', 'codPend'), ('expectedMw', 'exp'),
    ]
    REGIONS = ['NR', 'WR', 'SR', 'ER', 'NER']

    print(f"\n  {'Key':<12} {'Field':<12} {'Computed':>10} {'Excel':>10}  St")
    print(f"  {'-'*12} {'-'*12} {'-'*10} {'-'*10}  --")

    all_keys = sorted(set(list(computed.keys()) + list(excel.keys())))
    for key in all_keys:
        region = key.split('|')[0]
        if region not in REGIONS:
            continue
        c = computed.get(key, {f: 0.0 for f, _ in FIELDS})
        x = excel.get(key, {f: 0.0 for f, _ in FIELDS})
        for field, label in FIELDS:
            cv = c.get(field, 0.0)
            xv = x.get(field, 0.0)
            ok = approx_eq(cv, xv)
            sym = cmp_sym(ok)
            if not ok:
                issues.append(f"T2 {key} {label}: computed={fmt(cv)} vs excel={fmt(xv)}")
                print(f"  {key:<12} {label:<12} {fmt(cv):>10} {fmt(xv):>10}  {sym}")
    if not issues:
        print("  All T2 fields match ✅")
    return issues

def compare_t3(computed, excel, date_str):
    """Compare Table 3: Transmission."""
    issues = []
    REGIONS = ['NR', 'WR', 'SR', 'ER', 'NER']
    CATS    = ['LINE_RE', 'LINE_NONRE', 'ICT_RE', 'ICT_NONRE']

    print(f"\n  {'Key':<16} {'CmpKmMva':>9} {'XlKmMva':>9} {'CmpNo':>6} {'XlNo':>6} {'CmpPndKm':>9} {'XlPndKm':>9} {'CmpPN':>6} {'XlPN':>6}  St")
    print(f"  {'-'*16} {'-'*9} {'-'*9} {'-'*6} {'-'*6} {'-'*9} {'-'*9} {'-'*6} {'-'*6}  --")

    for region in REGIONS:
        for cat in CATS:
            key = f"{region}|{cat}"
            c = computed.get(key, {'completedKmMva': 0.0, 'completedNo': 0, 'pendingKmMva': 0.0, 'pendingNo': 0})
            x = excel.get(key, {'completedKmMva': 0.0, 'completedNo': 0, 'pendingKmMva': 0.0, 'pendingNo': 0})
            ck, xk = c['completedKmMva'], x['completedKmMva']
            cn, xn = c['completedNo'], x['completedNo']
            pk, xpk = c['pendingKmMva'], x['pendingKmMva']
            pn, xpn = c['pendingNo'], x['pendingNo']
            ok = approx_eq(ck, xk) and cn == xn and approx_eq(pk, xpk) and pn == xpn
            sym = cmp_sym(ok)
            if not ok:
                issues.append(f"T3 {key}: cmpKm={fmt(ck)}/{cn} xl={fmt(xk)}/{xn}; pnd={fmt(pk)}/{pn} xl={fmt(xpk)}/{xpn}")
            if not ok or (ck + xk + cn + xn + pk + xpk + pn + xpn > 0):
                print(f"  {key:<16} {fmt(ck):>9} {fmt(xk):>9} {cn:>6} {xn:>6} {fmt(pk):>9} {fmt(xpk):>9} {pn:>6} {xpn:>6}  {sym}")
    return issues

# ── Main ──────────────────────────────────────────────────────────────────────

def validate_file(date_str, filename):
    filepath = EXCEL_DIR / filename
    if not filepath.exists():
        print(f"  FILE NOT FOUND: {filepath}")
        return

    wb = openpyxl.load_workbook(str(filepath), data_only=True)

    # Extract data from regional sheets
    contd4, ftc, tx = extract_workbook(wb)

    # Compute summaries
    c_t1 = compute_t1(contd4)
    c_t2 = compute_t2(ftc)
    c_t3 = compute_t3(tx)

    # Read Excel Summary
    ws_sum = wb['Summary']
    x_t1   = read_summary_t1(ws_sum)
    x_t2   = read_summary_t2(ws_sum)
    x_t3   = read_summary_t3(ws_sum)

    # Report
    print(f"\n{'═'*80}")
    print(f"  {date_str}  |  {filename}")
    print(f"  Extracted: {len(contd4)} CONTD-4, {len(ftc)} FTC, {len(tx)} TX")
    print(f"{'═'*80}")

    print("\n── TABLE 1: CONTD-4 Study (Computed vs Excel Summary) ──")
    issues_t1 = compare_t1(c_t1, x_t1, date_str)

    print("\n── TABLE 2: FTC Pipeline (mismatches only) ──")
    issues_t2 = compare_t2(c_t2, x_t2, date_str)

    print("\n── TABLE 3: Transmission (non-zero rows + mismatches) ──")
    issues_t3 = compare_t3(c_t3, x_t3, date_str)

    all_issues = issues_t1 + issues_t2 + issues_t3
    if all_issues:
        print(f"\n  ⚠  {len(all_issues)} discrepancies found (Excel Summary may have formula range bugs):")
        for iss in all_issues:
            print(f"    - {iss}")
    else:
        print("\n  All tables match ✅")

    return len(all_issues)

def main():
    target = sys.argv[1] if len(sys.argv) > 1 else None
    total_issues = 0

    print("FTC Communication Portal — Excel Summary Validation")
    print(f"Comparing computed data (from regional sheets) vs Summary sheet\n")

    for date_str, filename in FILES:
        if target and target not in (date_str, filename):
            continue
        n = validate_file(date_str, filename)
        if n:
            total_issues += n

    print(f"\n{'═'*80}")
    print(f"  TOTAL ISSUES: {total_issues}")
    print(f"{'═'*80}\n")

if __name__ == '__main__':
    main()
