/* eslint-disable no-console */
// TARGETED + SAFE: fill ONLY the CONTD-4 application dates (applicationDate,
// proposedFtcDate) on existing Contd4Application rows, pulled from the live
// sheet's "Generation Capacity Under Process of CONTD-4" tables.
//
// It NEVER touches FTC/commissioning data (CommissioningPhase / Ftc/Toc/Cod
// events), never creates/deletes projects, and only writes the two date
// columns on already-present Contd4Application rows it can match by name+region.
//
//   node scripts/fill-contd4-dates.cjs            # DRY RUN — report only, no writes
//   node scripts/fill-contd4-dates.cjs --apply    # write the two date fields
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SHEET = process.env.FTC_XLSX || '/tmp/ftc_sheet_live.xlsx';
const APPLY = process.argv.includes('--apply');
const REGIONS = ['NR', 'WR', 'SR', 'ER', 'NER'];

const wb = XLSX.readFile(SHEET);
const rowsOf = (s) => XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1, blankrows: false, defval: '' });
const joined = (r) => r.map((x) => String(x).trim()).join(' | ');

function serialToISO(serial) {
  const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
function parseOneDate(s) {
  if (s == null) return null;
  if (typeof s === 'number') return (s > 40000 && s < 60000) ? serialToISO(s) : null;
  const str = String(s);
  let m = str.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`; }
  m = str.match(/(\d{1,2})\s*[-\s]\s*([A-Za-z]{3,})\s*[-\s]\s*(\d{2,4})/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${MONTHS[m[2].slice(0, 3).toLowerCase()]}-${String(m[1]).padStart(2, '0')}`; }
  return null;
}

const isContdTitle = (r) => /Generation Capacity Under Process of CONTD/i.test(joined(r));
const isGenHdr = (r) => /Generating Station/i.test(String(r[1])) && /Total Plant Capacity/i.test(joined(r));
const isTitle = (r) => /Generation Capacity Under Process|Transmission Elements Under Process|Source wise Segregation/i.test(joined(r));

// Extract CONTD-4 rows (name, app date, proposed-FTC date) — same column layout
// the seeder uses (WR carries an extra "Name of Developer" col → offset +1).
function extractContd4(region) {
  const rows = rowsOf(region);
  const ti = rows.findIndex(isContdTitle);
  if (ti < 0) return [];
  const off = region === 'WR' ? 1 : 0;
  const out = [];
  for (let i = ti + 2; i < rows.length; i++) {
    const r = rows[i];
    if (isTitle(r) || isGenHdr(r)) break;
    const name = region === 'WR'
      ? (String(r[1] || '').trim() || String(r[2] || '').trim())
      : String(r[1] || '').trim();
    if (!name || /^total/i.test(name) || /^sr\.?\s*no/i.test(name) || /name of developer/i.test(name)) continue;
    if (String(r[3 + off] || '').trim().toUpperCase() !== region) continue;
    out.push({
      name,
      region,
      pool: String(r[2 + off] || '').trim(),  // Pooling Station — disambiguates same-named developers
      app: parseOneDate(r[6 + off]),          // Application Date
      proposedFtc: parseOneDate(r[7 + off]),  // Proposed FTC date
    });
  }
  return out;
}

const norm = (s) => String(s || '').toUpperCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
const D = (iso) => (iso ? new Date(iso + 'T00:00:00.000Z') : null);
const isoOf = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

(async () => {
  // Pull every CONTD-4 row from the sheet.
  const sheetRows = REGIONS.flatMap(extractContd4);
  console.log(`Sheet CONTD-4 rows: ${sheetRows.length}`);
  const withApp = sheetRows.filter((r) => r.app).length;
  const withFtc = sheetRows.filter((r) => r.proposedFtc).length;
  console.log(`  with app date: ${withApp} | with proposed-FTC date: ${withFtc}`);

  // Load existing Contd4Applications (with project name + region + pooling).
  const apps = await prisma.contd4Application.findMany({
    select: {
      id: true, applicationDate: true, proposedFtcDate: true, status: true,
      project: { select: { name: true, region: { select: { code: true } }, poolingStation: { select: { name: true } } } },
    },
  });
  // Index by region|name|pooling. Track ambiguous keys (>1 DB row) so we never
  // write to a record we can't pin down uniquely.
  const byKey = new Map();
  const dupKeys = new Set();
  for (const a of apps) {
    const k = `${a.project.region.code}|${norm(a.project.name)}|${norm(a.project.poolingStation?.name)}`;
    if (byKey.has(k)) dupKeys.add(k);
    byKey.set(k, a);
  }

  let matched = 0;
  const unmatched = [];
  const ambiguous = [];
  const updates = [];           // ONLY null→value fills — safe to write
  const conflicts = [];         // existing value differs from sheet — NOT written
  for (const row of sheetRows) {
    const key = `${row.region}|${norm(row.name)}|${norm(row.pool)}`;
    if (dupKeys.has(key)) { ambiguous.push(row); continue; }   // never write when not unique
    const app = byKey.get(key);
    if (!app) { unmatched.push(row); continue; }
    matched++;
    const curApp = isoOf(app.applicationDate);
    const curFtc = isoOf(app.proposedFtcDate);
    const data = {};
    // FILL only — never overwrite an existing value (may be a custom edit).
    if (row.app && !curApp) data.applicationDate = D(row.app);
    if (row.proposedFtc && !curFtc) data.proposedFtcDate = D(row.proposedFtc);
    if (Object.keys(data).length) updates.push({ id: app.id, name: app.project.name, region: app.project.region.code, curApp, curFtc, ...row, data });
    // Record (but never write) cases where the sheet disagrees with an existing value.
    if (row.app && curApp && row.app !== curApp) conflicts.push({ ...row, field: 'app', cur: curApp, sheet: row.app });
    if (row.proposedFtc && curFtc && row.proposedFtc !== curFtc) conflicts.push({ ...row, field: 'ftc', cur: curFtc, sheet: row.proposedFtc });
  }

  const setApp = updates.filter((u) => u.data.applicationDate).length;
  const setFtc = updates.filter((u) => u.data.proposedFtcDate).length;
  console.log(`\nMatched to DB: ${matched}/${sheetRows.length}`);
  console.log(`Rows to FILL (empty -> value, safe): ${updates.length}  (app: ${setApp}, proposed-FTC: ${setFtc})`);
  console.log('\n--- fills (first 20) ---');
  for (const u of updates.slice(0, 20)) {
    console.log(`  [${u.region}] ${u.name.slice(0, 38).padEnd(38)} app: ${String(u.curApp)} -> ${u.data.applicationDate ? u.app : '(unchanged)'} | ftc: ${String(u.curFtc)} -> ${u.data.proposedFtcDate ? u.proposedFtc : '(unchanged)'}`);
  }
  if (conflicts.length) {
    console.log(`\n--- ⚠ SHEET DISAGREES with an EXISTING value — left UNTOUCHED (${conflicts.length}) ---`);
    for (const c of conflicts) console.log(`  [${c.region}] ${c.name.slice(0, 38).padEnd(38)} ${c.field}: keep ${c.cur}  (sheet says ${c.sheet})`);
  }
  if (unmatched.length) {
    console.log(`\n--- sheet rows with NO unique DB match (${unmatched.length}) ---`);
    for (const r of unmatched.slice(0, 20)) console.log(`  [${r.region}] ${r.name} @ ${r.pool}`);
  }
  if (ambiguous.length) {
    console.log(`\n--- AMBIGUOUS (same name+pool on >1 DB row) — skipped (${ambiguous.length}) ---`);
    for (const r of ambiguous.slice(0, 20)) console.log(`  [${r.region}] ${r.name} @ ${r.pool}`);
  }

  if (!APPLY) {
    console.log('\nDRY RUN — no writes. Re-run with --apply to write the two date fields.');
    await prisma.$disconnect();
    return;
  }

  console.log(`\nAPPLYING ${updates.length} updates (applicationDate / proposedFtcDate only)...`);
  let done = 0;
  for (const u of updates) {
    await prisma.contd4Application.update({ where: { id: u.id }, data: u.data });
    done++;
  }
  console.log(`Done. Updated ${done} Contd4Application rows. No FTC/commissioning data touched.`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
