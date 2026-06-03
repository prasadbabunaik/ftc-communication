// Read snapshots (11/12/13 May 2026), diff them, and log material changes as
// ProjectNotes (SYSTEM source). The AuditFeed UI surfaces these automatically.
//
// Run: node scripts/log-snapshot-changes.js [--dry]

require('dotenv').config({ path: '.env.local' });
const XLSX = require('xlsx');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry');
const BASE = path.join(__dirname, '..', 'public', 'data', 'excel');

const SNAPSHOTS = [
  { date: '2026-05-11', file: 'CONTD and FTC details 110526.xlsx', ts: '2026-05-11T18:00:00+05:30' },
  { date: '2026-05-12', file: 'CONTD and FTC details 120526.xlsx', ts: '2026-05-12T18:00:00+05:30' },
  { date: '2026-05-13', file: 'CONTD and FTC details 130526.xlsx', ts: '2026-05-13T18:00:00+05:30' },
];

// ── Excel row parsing ────────────────────────────────────────────────────────
function readFtcRows(wb, sheet) {
  const ws = wb.Sheets[sheet];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  let inFtc = false;
  const out = [];
  rows.forEach((r) => {
    const rowStr = r.join('');
    if (rowStr.includes('Generation Capacity Under Process of FTC') && !rowStr.includes('Transmission')) { inFtc = true; return; }
    if (rowStr.includes('Transmission Elements Under Process of FTC')) { inFtc = false; return; }
    if (!inFtc) return;
    if (typeof r[0] !== 'number') return;
    const name = String(r[1] ?? '').trim();
    if (!name) return;
    out.push({
      name,
      sheet,
      plantType:  String(r[3] ?? ''),
      total:      r[5] ?? null,
      contd4:     r[6] ?? null,
      applied:    r[7] ?? null,
      srcApplied: String(r[8] ?? ''),
      ftcMw:      r[9] ?? null,
      tocMw:      r[11] ?? null,
      codMw:      r[13] ?? null,
      underFtc:   r[16] ?? null,
      underToc:   r[17] ?? null,
      pendingCod: r[18] ?? null,
      expected:   r[19] ?? null,
    });
  });
  return out;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function num(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.round(v * 1000) / 1000;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
}

function changed(a, b) {
  const an = num(a), bn = num(b);
  if (an === null && bn === null) return false;
  if (an === null || bn === null) return true;
  return Math.abs(an - bn) > 0.01;
}

function indexByName(rows) {
  const m = {};
  for (const r of rows) {
    const k = r.name.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 40);
    if (!m[k]) m[k] = r;
  }
  return m;
}

// Map Excel sheet name → DB region code (they're the same for our case)
// Map Excel name → DB project (loose match on lowercased substring)
async function resolveDbProject(excelName, sheet) {
  const region = await prisma.gridRegion.findUnique({ where: { code: sheet } });
  if (!region) return null;
  const norm = excelName.toLowerCase();
  // Find by partial match
  const candidates = await prisma.generationProject.findMany({
    where: { regionId: region.id },
    select: { id: true, name: true },
  });
  // Score by character overlap and prefix match
  let best = null, bestScore = 0;
  for (const c of candidates) {
    const cName = c.name.toLowerCase();
    let score = 0;
    // Exact contains
    if (cName.includes(norm) || norm.includes(cName)) score = 100;
    // Prefix
    else {
      const minLen = Math.min(cName.length, norm.length);
      let i = 0;
      while (i < minLen && cName[i] === norm[i]) i++;
      score = i;
    }
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= 8 ? best : null;  // Require at least 8-char overlap
}

// ── Diff snapshot pairs ──────────────────────────────────────────────────────
function diffMaterial(prev, cur) {
  const changes = [];
  const pMap = indexByName(prev), cMap = indexByName(cur);

  for (const k of Object.keys(cMap)) {
    const c = cMap[k];
    const p = pMap[k];

    if (!p) {
      changes.push({ kind: 'NEW_IN_FTC', name: c.name, sheet: c.sheet });
      continue;
    }

    const fieldChecks = [
      ['ftcCompletedMw',    p.ftcMw,      c.ftcMw,      'FTC Approved (MW)'],
      ['tocIssuedMw',       p.tocMw,      c.tocMw,      'TOC Issued (MW)'],
      ['codDeclaredMw',     p.codMw,      c.codMw,      'COD Declared (MW)'],
      ['capacityUnderFtcMw', p.underFtc,  c.underFtc,   'Capacity Under FTC (MW)'],
      ['capacityUnderTocMw', p.underToc,  c.underToc,   'Capacity Under TOC (MW)'],
      ['capacityAppliedMw', p.applied,    c.applied,    'Applied for FTC (MW)'],
      ['expectedApr26Mw',   p.expected,   c.expected,   'Expected (MW)'],
      ['contd4ApprovedMw',  p.contd4,     c.contd4,     'CONTD-4 Capacity (MW)'],
    ];
    const diffs = [];
    for (const [dbField, before, after, label] of fieldChecks) {
      if (changed(before, after)) diffs.push({ dbField, label, before: num(before), after: num(after) });
    }
    if (diffs.length) changes.push({ kind: 'MODIFIED', name: c.name, sheet: c.sheet, diffs });
  }
  return changes;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Loading ${SNAPSHOTS.length} snapshots...`);
  const data = SNAPSHOTS.map(s => {
    const wb = XLSX.readFile(path.join(BASE, s.file));
    const ftc = {};
    for (const sh of ['NR','WR','SR','ER','NER']) ftc[sh] = readFtcRows(wb, sh);
    return { ...s, ftc };
  });

  const systemUser = await prisma.user.findUnique({ where: { email: 'admin@grid-india.in' } });
  if (!systemUser) { console.error('admin user not found'); process.exit(1); }

  let created = 0, unmatched = 0;
  for (let i = 1; i < data.length; i++) {
    const prev = data[i-1], cur = data[i];
    console.log(`\n--- Diff: ${prev.date} → ${cur.date} ---`);

    for (const sh of ['NR','WR','SR','ER','NER']) {
      const changes = diffMaterial(prev.ftc[sh], cur.ftc[sh]);
      for (const change of changes) {
        const dbProject = await resolveDbProject(change.name, sh);
        if (!dbProject) {
          unmatched++;
          console.log(`  [unmatched: ${sh}] ${change.name}`);
          continue;
        }

        if (change.kind === 'NEW_IN_FTC') {
          console.log(`  [NEW] ${sh} ${change.name}`);
          if (!DRY) {
            await prisma.projectNote.create({
              data: {
                projectId: dbProject.id, userId: systemUser.id, source: 'SYSTEM',
                field: 'Entered FTC pipeline', oldValue: null, newValue: 'CLEARED',
                text: `Project added to FTC tracker (snapshot ${cur.date})`,
                createdAt: new Date(cur.ts),
              },
            });
            created++;
          }
          continue;
        }

        for (const d of change.diffs) {
          console.log(`  [MOD] ${sh} ${change.name} | ${d.label}: ${d.before} → ${d.after}`);
          if (!DRY) {
            await prisma.projectNote.create({
              data: {
                projectId: dbProject.id, userId: systemUser.id, source: 'SYSTEM',
                field: d.label,
                oldValue: d.before == null ? null : String(d.before),
                newValue: d.after  == null ? null : String(d.after),
                text: `Snapshot ${prev.date} → ${cur.date}`,
                createdAt: new Date(cur.ts),
              },
            });
            created++;
          }
        }
      }
    }
  }

  console.log(`\nDone. Created ${created} notes, ${unmatched} projects unmatched. (mode: ${DRY ? 'DRY' : 'WRITE'})`);
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
