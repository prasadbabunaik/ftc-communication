// Diff three Excel snapshots (11/12/13 May 2026) and output a structured changelog.
// Reads FTC and CONTD-4 sections from NR/WR/SR/ER/NER sheets and detects:
//   - new projects, removed projects
//   - status changes (CONTD-4 status, FTC progress)
//   - capacity/MW changes
//   - date changes (FTC, TOC, COD)
//   - new phases / partial commissioning

const XLSX = require('xlsx');
const path = require('path');

const FILES = [
  { date: '2026-05-11', file: 'CONTD and FTC details 110526.xlsx' },
  { date: '2026-05-12', file: 'CONTD and FTC details 120526.xlsx' },
  { date: '2026-05-13', file: 'CONTD and FTC details 130526.xlsx' },
];

const BASE = path.join(__dirname, '..', 'public', 'data', 'excel');

// Column maps — regional sheets differ between NR/SR (offset 0) and WR (offset 1)
function getFtcRows(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const sections = [];
  let cur = null;
  rows.forEach((r, i) => {
    const rowStr = r.join('');
    if (rowStr.includes('Generation Capacity Under Process of FTC') && !rowStr.includes('Transmission')) {
      cur = { startIdx: i, dataRows: [] };
      sections.push(cur);
    } else if (rowStr.includes('Transmission Elements Under Process of FTC')) {
      cur = null;
    } else if (cur && r[0] && typeof r[0] === 'number' && r[1]) {
      cur.dataRows.push(r);
    }
  });
  // Flatten and extract key fields
  const out = [];
  for (const sec of sections) {
    for (const r of sec.dataRows) {
      const name = String(r[1]).trim();
      if (!name) continue;
      // For WR sheet, plant type column shifts — detect by checking if r[3] looks like region code
      const isWrFormat = r[4] === sheetName && typeof r[5] === 'number';
      const get = (regIdx, normIdx) => isWrFormat ? r[regIdx] : r[normIdx];
      out.push({
        name,
        sheet: sheetName,
        plantType: String(r[3] ?? ''),
        total: r[5] ?? null,
        contd4: r[6] ?? null,
        applied: r[7] ?? null,
        srcApplied: String(r[8] ?? ''),
        ftcMw: r[9] ?? null,
        ftcDate: r[10] ?? null,
        tocMw: r[11] ?? null,
        tocDate: r[12] ?? null,
        codMw: r[13] ?? null,
        codDate: r[14] ?? null,
        underFtc: r[16] ?? null,
        underToc: r[17] ?? null,
        pendingCod: r[18] ?? null,
        expected: r[19] ?? null,
      });
    }
  }
  return out;
}

function getContd4Rows(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  let inContd4 = false, doneContd4 = false;
  const out = [];
  rows.forEach((r, i) => {
    const rowStr = r.join('');
    if (rowStr.includes('Generation Capacity Under Process of CONTD-4')) { inContd4 = true; return; }
    if (rowStr.includes('Generation Capacity Under Process of FTC')) { inContd4 = false; doneContd4 = true; }
    if (!inContd4 || doneContd4) return;
    // Detect WR format (developer name shifts cols)
    const num = typeof r[0] === 'number' ? r[0] : null;
    if (!num) return;
    const isWrFormat = !!r[1] && !!r[2] && (typeof r[6] === 'number' || r[6] === '');
    const name = String((isWrFormat ? r[2] : r[1]) ?? '').trim();
    if (!name) return;
    out.push({
      name,
      sheet: sheetName,
      developer: isWrFormat ? String(r[1] ?? '') : '',
      plantType: String((isWrFormat ? r[5] : r[4]) ?? ''),
      capacity:  (isWrFormat ? r[6] : r[5]) ?? null,
      applicationDate: (isWrFormat ? r[7] : r[6]) ?? null,
      proposedFtcDate: (isWrFormat ? r[8] : r[7]) ?? null,
      apr26Mw: (isWrFormat ? r[9] : r[8]) ?? null,
      remarks: String((isWrFormat ? r[10] : r[9]) ?? ''),
    });
  });
  return out;
}

function normalize(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  return String(v).trim();
}

// Build maps keyed by normalized name
function indexByName(rows) {
  const map = {};
  for (const r of rows) {
    const key = r.name.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 35);
    if (!map[key]) map[key] = r;
  }
  return map;
}

function diffPair(prev, cur, sheet, table) {
  const changes = [];
  const prevMap = indexByName(prev);
  const curMap  = indexByName(cur);

  // Removed
  for (const k of Object.keys(prevMap)) {
    if (!curMap[k]) changes.push({ type: 'REMOVED', sheet, table, name: prevMap[k].name });
  }
  // Added
  for (const k of Object.keys(curMap)) {
    if (!prevMap[k]) changes.push({ type: 'ADDED', sheet, table, name: curMap[k].name, plantType: curMap[k].plantType });
  }
  // Changed
  for (const k of Object.keys(curMap)) {
    if (!prevMap[k]) continue;
    const p = prevMap[k], c = curMap[k];
    const fields = table === 'FTC'
      ? ['total','contd4','applied','srcApplied','ftcMw','ftcDate','tocMw','tocDate','codMw','codDate','underFtc','underToc','pendingCod','expected']
      : ['capacity','applicationDate','proposedFtcDate','apr26Mw','remarks'];
    const diffs = [];
    for (const f of fields) {
      const a = normalize(p[f]), b = normalize(c[f]);
      if (a !== b) diffs.push({ field: f, before: a, after: b });
    }
    if (diffs.length) changes.push({ type: 'MODIFIED', sheet, table, name: c.name, diffs });
  }
  return changes;
}

function main() {
  const snapshots = FILES.map(({ date, file }) => {
    const wb = XLSX.readFile(path.join(BASE, file));
    const ftc = {}, contd4 = {};
    for (const sh of ['NR','WR','SR','ER','NER']) {
      ftc[sh]    = getFtcRows(wb, sh);
      contd4[sh] = getContd4Rows(wb, sh);
    }
    return { date, ftc, contd4 };
  });

  // Diff between consecutive snapshots
  const allChanges = [];
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i-1], cur = snapshots[i];
    for (const sh of ['NR','WR','SR','ER','NER']) {
      const ftcChanges    = diffPair(prev.ftc[sh],    cur.ftc[sh],    sh, 'FTC');
      const contd4Changes = diffPair(prev.contd4[sh], cur.contd4[sh], sh, 'CONTD4');
      for (const c of [...ftcChanges, ...contd4Changes]) {
        allChanges.push({ from: prev.date, to: cur.date, ...c });
      }
    }
  }

  console.log(`Total changes: ${allChanges.length}\n`);
  for (const c of allChanges) {
    if (c.type === 'ADDED') {
      console.log(`  [${c.to}] [${c.sheet}/${c.table}] ADDED: ${c.name} (${c.plantType ?? ''})`);
    } else if (c.type === 'REMOVED') {
      console.log(`  [${c.to}] [${c.sheet}/${c.table}] REMOVED: ${c.name}`);
    } else if (c.type === 'MODIFIED') {
      console.log(`  [${c.to}] [${c.sheet}/${c.table}] MODIFIED: ${c.name}`);
      for (const d of c.diffs) {
        const before = d.before === null ? '∅' : String(d.before).substring(0, 40);
        const after  = d.after  === null ? '∅' : String(d.after).substring(0, 40);
        console.log(`      ${d.field}: ${before} → ${after}`);
      }
    }
  }

  // Save as JSON for downstream consumers
  const fs = require('fs');
  const outPath = path.join(__dirname, 'excel-diff-output.json');
  fs.writeFileSync(outPath, JSON.stringify(allChanges, null, 2));
  console.log(`\nSaved diff to ${outPath}`);
}

main();
