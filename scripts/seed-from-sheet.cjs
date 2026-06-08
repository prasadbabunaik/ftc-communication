/* eslint-disable no-console */
// Unified seed straight from the LIVE Google Sheet (CONTD and FTC details).
// Single source of truth — does NOT rely on any prior hand-coded seed data.
//
// Per region it reads four stacked tables, detected by title / header row:
//   1) Generation Capacity Under Process of CONTD-4   → CONTD-4 study projects
//   2) Generation Capacity Under Process of FTC       → NON-hybrid FTC projects
//   3) Transmission Elements Under Process of FTC      → transmission elements
//   4) Source wise Segregation of hybrid …            → HYBRID projects, one
//      CommissioningPhase PER COMPONENT (proper source-wise quantum + dated
//      events). For SR this 4th table is its 2nd "…Under Process of FTC" table.
//
// Hybrids are taken ONLY from table 4 (bifurcated). Hybrid rows in table 2 are
// skipped to avoid a lumped double-count. Run:
//   node scripts/seed-from-sheet.cjs           # dry-run: extract + matrix, NO writes
//   node scripts/seed-from-sheet.cjs --seed    # delete transactional data + seed
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SHEET = process.env.FTC_XLSX || '/tmp/ftc_sheet_live.xlsx';
const DO_SEED = process.argv.includes('--seed');
const REGIONS = ['NR', 'WR', 'SR', 'ER', 'NER'];

const wb = XLSX.readFile(SHEET);
const rowsOf = (s) => XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1, blankrows: false, defval: '' });
const joined = (r) => r.map((x) => String(x).trim()).join(' | ');

// ── value helpers ─────────────────────────────────────────────────────────────
function num(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const m = String(v).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/); // first number in the cell
  return m ? parseFloat(m[0]) : 0;
}
const r3 = (n) => Math.round(n * 1000) / 1000;

function serialToISO(serial) {
  // Excel serial date (days since 1899-12-30) → ISO yyyy-mm-dd
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
// Parse a milestone cell into dated lots. Handles "DD-MM-YYYY (51.975MW)" lines,
// unit labels ("U1 240MW" / "Unit-2: 02.12.2025"), serials, MW(date) per line.
function parseEvents(v) {
  if (v == null) return [];
  if (typeof v === 'number') { const d = parseOneDate(v); return d ? [{ mw: null, date: d }] : []; }
  const s = String(v);
  if (!s.trim() || /^[-\s]*$/.test(s)) return [];
  const out = [];
  for (const ch of s.split(/[\n;]+/)) {
    if (!ch.trim()) continue;
    const date = parseOneDate(ch);
    if (!date) continue;
    const mw = ch.match(/(\d+(?:\.\d+)?)\s*MW/i); // number directly before "MW"
    out.push({ mw: mw ? parseFloat(mw[1]) : null, date });
  }
  return out;
}
const sumEv = (evs) => r3(evs.reduce((a, e) => a + (e.mw || 0), 0));
// Dateless-MW events absorb the leftover toward the milestone total; drop zeros.
function resolveEvents(events, total) {
  if (!events || !events.length) return [];
  const known = events.filter((e) => e.mw != null);
  const unknown = events.filter((e) => e.mw == null);
  if (unknown.length) {
    const rem = Math.max(0, (total || 0) - known.reduce((a, e) => a + e.mw, 0));
    const per = r3(rem / unknown.length);
    unknown.forEach((e) => { e.mw = per; });
  }
  return events.filter((e) => e.mw > 0).map((e) => ({ mw: e.mw, date: e.date }));
}

// ── source / plant-type classification ────────────────────────────────────────
const ABBR = { WIND: 'W', SOLAR: 'S', BESS: 'B', COAL: 'C', HYDRO: 'H', PSP: 'P' };
const ORDER = ['WIND', 'SOLAR', 'BESS', 'COAL', 'HYDRO', 'PSP'];
const NAME = { WIND: 'Wind', SOLAR: 'Solar', BESS: 'BESS', COAL: 'Coal', HYDRO: 'Hydro', PSP: 'PSP' };
function sourcesOf(str) {
  const t = String(str || '').toUpperCase();
  const c = [];
  if (/WIND/.test(t)) c.push('WIND');
  if (/SOLAR/.test(t)) c.push('SOLAR');
  if (/BESS|BATTERY/.test(t)) c.push('BESS');
  if (/COAL|THERMAL/.test(t)) c.push('COAL');
  if (/HYDRO/.test(t)) c.push('HYDRO');
  if (/PSP|PUMP/.test(t)) c.push('PSP');
  let ordered = ORDER.filter((s) => c.includes(s));
  // A pumped-storage plant is often tagged "PSP HYDRO" — PSP subsumes hydro, so
  // it's a single PSP source, NOT a Hydro+PSP hybrid (e.g. Tehri).
  if (ordered.includes('PSP') && ordered.includes('HYDRO')) ordered = ordered.filter((s) => s !== 'HYDRO');
  return ordered;
}
function classify(plantStr, srcStr) {
  let ordered = sourcesOf(`${plantStr || ''} ${srcStr || ''}`);
  if (!ordered.length) ordered = ['SOLAR'];
  const isHybrid = /HYBRID/i.test(String(plantStr || '')) || ordered.length > 1;
  const code = isHybrid ? 'HYBRID_' + ordered.map((s) => ABBR[s]).join('') : ordered[0];
  const category = ordered.some((s) => ['COAL', 'HYDRO'].includes(s)) ? 'CONVENTIONAL'
    : ordered.some((s) => ['WIND', 'SOLAR'].includes(s)) ? 'RENEWABLE' : 'STORAGE';
  return { code, source: ordered[0], isHybrid, category, comps: ordered };
}
const sourceEnum = (s) => { const o = sourcesOf(s); return o[0] || 'SOLAR'; };
function labelFor(code, isHybrid) {
  if (!isHybrid) return ({ SOLAR: 'Solar', WIND: 'Wind', BESS: 'Battery Energy Storage (BESS)', COAL: 'Coal', HYDRO: 'Hydro', PSP: 'Pumped Storage Plant (PSP)' })[code] ?? code;
  return 'Hybrid (' + code.replace('HYBRID_', '').split('').map((a) => Object.keys(ABBR).find((k) => ABBR[k] === a)).map((k) => NAME[k]).join('+') + ')';
}

// ── table locators ────────────────────────────────────────────────────────────
const isGenHdr = (r) => /Generating Station/i.test(String(r[1])) && /Total Plant Capacity/i.test(joined(r));
const isTitle = (r) => /Generation Capacity Under Process|Transmission Elements Under Process|Source wise Segregation/i.test(joined(r));
const isContdTitle = (r) => /Generation Capacity Under Process of CONTD/i.test(joined(r));
const isFtcTitle = (r) => /Generation Capacity Under Process of FTC|Generation Capacity Under Process for FTC/i.test(joined(r));
const isSegTitle = (r) => /Source wise Segregation/i.test(joined(r));
const isTxTitle = (r) => /Transmission Elements Under Process/i.test(joined(r));

// CONTD-4 study table. WR has an extra "Name of Developer" column (offset +1).
function extractContd4(region) {
  const rows = rowsOf(region);
  const ti = rows.findIndex(isContdTitle);
  if (ti < 0) return [];
  const off = region === 'WR' ? 1 : 0;
  const out = [];
  for (let i = ti + 2; i < rows.length; i++) {
    const r = rows[i];
    if (isTitle(r) || isGenHdr(r)) break;
    // WR carries an extra "Name of Developer" (col1); prefer it as the name
    // since the station column there is just a cryptic pooling code.
    const name = region === 'WR'
      ? (String(r[1] || '').trim() || String(r[2] || '').trim())
      : String(r[1] || '').trim();
    if (!name || /^total/i.test(name) || /^sr\.?\s*no/i.test(name) || /name of developer/i.test(name)) continue;
    if (String(r[3 + off] || '').trim().toUpperCase() !== region) continue; // region col
    out.push({
      name, pool: String(r[2 + off] || '').trim(), type: String(r[4 + off] || '').trim(),
      cap: num(r[5 + off]), app: parseOneDate(r[6 + off]),
      jun: num(r[8 + off]), rem: String(r[9 + off] || '').trim() || null,
    });
  }
  return out;
}

// A generation (FTC / segregation) row → structured cells (shared column layout).
function genRow(r) {
  return {
    station: String(r[1] || '').trim(), pooling: String(r[2] || '').trim(), plantStr: String(r[3] || ''),
    region: String(r[4] || '').trim(), total: num(r[5]), contd4: num(r[6]), applied: num(r[7]), srcStr: String(r[8] || ''),
    ftc: num(r[9]), ftcEvents: parseEvents(r[10]), ftcDate: parseOneDate(r[10]),
    toc: num(r[11]), tocEvents: parseEvents(r[12]), tocDate: parseOneDate(r[12]),
    cod: num(r[13]), codEvents: parseEvents(r[14]), codDate: parseOneDate(r[14]),
    proposedFtc: parseOneDate(r[15]), expected: num(r[19]),
    issues: String(r[20] || '').trim() || null, other: String(r[21] || '').trim() || null,
    rawTotal: String(r[5] || ''), rawApplied: String(r[7] || ''),
  };
}

// Main FTC table = FIRST gen-column header in the sheet.
function extractMain(region) {
  const rows = rowsOf(region);
  const hdr = rows.findIndex(isGenHdr);
  if (hdr < 0) return [];
  const out = [];
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i];
    if (isTitle(r) || isGenHdr(r)) break;
    const g = genRow(r);
    if (!g.station || /^total/i.test(g.station)) continue;
    if (g.region.toUpperCase() !== region) continue;
    out.push(g);
  }
  return out;
}

// Segregation table (NR/WR "Source wise Segregation"; SR = 2nd FTC table).
// Rows belong to one project until the next non-empty station name. Returns
// { STATIONKEY: { name, pooling, contd4, comps: [ per-component genRow ] } }.
function extractSegregation(region) {
  const rows = rowsOf(region);
  let hdr = -1;
  const segTitleIdx = rows.findIndex(isSegTitle);
  if (segTitleIdx >= 0) {
    for (let i = segTitleIdx + 1; i < rows.length; i++) if (isGenHdr(rows[i])) { hdr = i; break; }
  } else {
    // SR style: the SECOND gen-column header is the per-source hybrid table.
    const hdrs = rows.map((r, i) => (isGenHdr(r) ? i : -1)).filter((i) => i >= 0);
    if (hdrs.length >= 2) hdr = hdrs[1];
  }
  if (hdr < 0) return {};
  const map = {}; let cur = null;
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i];
    if (isTitle(r) || isGenHdr(r)) break;
    const g = genRow(r);
    if (g.station && /^total/i.test(g.station)) break;
    // A new project starts on a non-empty station name; component continuation
    // rows have a BLANK station (and blank region) — they belong to `cur`. So we
    // must NOT filter by region here (only the first row carries the region).
    if (g.station) cur = g.station;
    if (!cur) continue;
    const key = cur.toUpperCase().replace(/\s+/g, ' ');
    if (!map[key]) map[key] = { name: cur, pooling: g.pooling, contd4: g.contd4, plantStr: g.plantStr, comps: [] };
    // Accept only rows that describe a SINGLE source component; skip the
    // combined "solar+Wind" aggregate/summary rows (col8 lists >1 source).
    const srcs = sourcesOf(g.srcStr);
    if (srcs.length === 1 && (g.total > 0 || g.applied > 0 || g.ftc > 0 || g.toc > 0 || g.cod > 0)) {
      map[key].comps.push(g);
    }
  }
  return map;
}

// Transmission table.
function extractTransmission(region) {
  const rows = rowsOf(region);
  const ti = rows.findIndex(isTxTitle);
  if (ti < 0) return [];
  const out = [];
  for (let i = ti + 2; i < rows.length; i++) {
    const r = rows[i];
    if (isTitle(r) || isGenHdr(r)) break;
    const name = String(r[2] || '').trim();
    const agency = String(r[1] || '').trim();
    if ((!name && !agency) || /^total/i.test(name) || /^agency/i.test(agency)) continue;
    const type = String(r[3] || '').trim();
    const kv = String(r[5] || '').match(/\d+/); // "765/400" → 765
    out.push({
      agencyOwner: agency || name, elementName: name || agency,
      elementType: /ICT/i.test(type) ? 'ICT' : /\bGT\b/i.test(type) ? 'GT' : /\bST\b/i.test(type) ? 'ST' : 'LINE',
      isRe: !/non/i.test(String(r[4])),
      voltageRatingKv: kv ? parseInt(kv[0], 10) : null, capacityMva: num(r[6]) || null,
      lineLengthKm: num(r[7]) || null, firstEnergyDate: parseOneDate(r[8]),
      pendingFtc: /yes/i.test(String(r[9])), proposedFtcDate: parseOneDate(r[10]),
      remarks: String(r[13] || r[12] || '').trim() || null,
    });
  }
  return out;
}

// ── build per-region project list ─────────────────────────────────────────────
const warnings = [];
function buildRegion(region) {
  const main = extractMain(region);
  const seg = extractSegregation(region);
  const projects = [];

  // 1) Non-hybrid projects from the main FTC table (skip hybrid rows — those are
  //    handled, bifurcated, from the segregation table).
  for (const g of main) {
    const cls = classify(g.plantStr, g.srcStr);
    if (cls.isHybrid) {
      const key = g.station.toUpperCase().replace(/\s+/g, ' ');
      if (!seg[key]) {
        // Hybrid present only in the main table (no per-source breakdown).
        if (g.applied > 0) {
          warnings.push(`${region}: hybrid "${g.station}" has no segregation breakdown — kept as a single lumped phase (applied ${g.applied}).`);
          projects.push(onePhaseProject(g, cls));
        } else {
          warnings.push(`${region}: hybrid "${g.station}" (${g.rawTotal}) excluded — applied=0 / not applied.`);
        }
      }
      continue; // hybrids with a breakdown come from seg below
    }
    // De-dup: a station that also exists as a hybrid (in the segregation table)
    // must appear ONCE — as the hybrid. Skip the same-named non-hybrid main row
    // (e.g. WR "AGE26BL Khavda PSS10" is listed as both a Solar row and a
    // Hybrid row; keep only the hybrid).
    const nkey = g.station.toUpperCase().replace(/\s+/g, ' ');
    if (seg[nkey]) {
      warnings.push(`${region}: non-hybrid "${g.station}" skipped — a same-named hybrid exists (kept the hybrid).`);
      continue;
    }
    if (g.applied <= 0 && g.total <= 0) continue;
    projects.push(onePhaseProject(g, cls));
  }

  // 2) Hybrid projects from the segregation table — one phase per component.
  for (const key of Object.keys(seg)) {
    const grp = seg[key];
    const comps = grp.comps.filter((c) => c.total > 0 || c.applied > 0 || c.ftc > 0);
    if (!comps.length) continue;
    const srcOrder = ORDER.filter((s) => comps.some((c) => sourceEnum(c.srcStr) === s));
    const cls = { code: 'HYBRID_' + srcOrder.map((s) => ABBR[s]).join(''), isHybrid: true,
      category: srcOrder.some((s) => ['COAL', 'HYDRO'].includes(s)) ? 'CONVENTIONAL' : srcOrder.some((s) => ['WIND', 'SOLAR'].includes(s)) ? 'RENEWABLE' : 'STORAGE' };
    const total = r3(comps.reduce((a, c) => a + c.total, 0));
    projects.push({
      name: grp.name, pooling: grp.pooling, plantCode: cls.code, isHybrid: true, category: cls.category,
      total, contd4: grp.contd4, issues: comps.find((c) => c.issues)?.issues ?? null, other: comps.find((c) => c.other)?.other ?? null,
      components: comps.map((c) => ({
        src: sourceEnum(c.srcStr), total: c.total, applied: c.applied,
        ftc: c.ftc, ftcDate: c.ftcDate, ftcEvents: c.ftcEvents,
        toc: c.toc, tocDate: c.tocDate, tocEvents: c.tocEvents,
        cod: c.cod, codDate: c.codDate, codEvents: c.codEvents,
        expected: c.expected,
      })),
    });
  }
  return { projects, contd4: extractContd4(region), transmission: extractTransmission(region) };
}
function onePhaseProject(g, cls) {
  return {
    name: g.station, pooling: g.pooling, plantCode: cls.code, isHybrid: cls.isHybrid, category: cls.category,
    total: g.total, contd4: g.contd4, issues: g.issues, other: g.other,
    components: [{
      src: cls.source, total: g.total, applied: g.applied,
      ftc: g.ftc, ftcDate: g.ftcDate, ftcEvents: g.ftcEvents,
      toc: g.toc, tocDate: g.tocDate, tocEvents: g.tocEvents,
      cod: g.cod, codDate: g.codDate, codEvents: g.codEvents,
      expected: g.expected,
    }],
  };
}

// Reconcile dated events against the sheet's explicit completed-capacity column
// (FTC/TOC/COD col, e.g. the 4th-table per-source quantum):
//   • events sum > stated → CAP to the stated quantum (a later-dated lot beyond
//     the stated completed capacity isn't counted as done — honours the 4th
//     table's quantum, e.g. Juniper Solar FTC 185 not 285).
//   • events sum < stated → keep the DATED events as-is (the undated remainder
//     has no date to gate on, so it doesn't count until dated). This matches the
//     sheet Summary's own calculation for partially-dated milestones.
const recon = [];
function reconcile(rawEvents, stated, ctx) {
  let evs = resolveEvents(rawEvents, stated);
  if (stated <= 0.5) return evs;
  evs = evs.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const sum = sumEv(evs);
  if (sum > stated + 0.5) {
    let cum = 0; const kept = [];
    for (const e of evs) {
      if (cum + e.mw <= stated + 0.01) { kept.push(e); cum = r3(cum + e.mw); }
      else { const room = r3(stated - cum); if (room > 0.01) { kept.push({ mw: room, date: e.date }); } break; }
    }
    if (ctx) recon.push(`${ctx}: dated events summed ${sum} > stated ${stated} → capped to ${stated}`);
    return kept;
  }
  if (sum < stated - 0.5 && evs.length && ctx) {
    recon.push(`${ctx}: dated events summed ${sum} < stated ${stated} → using dated ${sum} (undated remainder ${r3(stated - sum)} not date-gated)`);
  }
  return evs;
}

// ── dry-run matrix (per calc, region × source) ───────────────────────────────
function phaseMilestones(c, ctx) {
  const F = reconcile(c.ftcEvents, c.ftc, ctx && `${ctx} FTC`), T = reconcile(c.tocEvents, c.toc, ctx && `${ctx} TOC`), Cc = reconcile(c.codEvents, c.cod, ctx && `${ctx} COD`);
  return {
    applied: c.applied,
    ftc: F.length ? sumEv(F) : c.ftc, toc: T.length ? sumEv(T) : c.toc, cod: Cc.length ? sumEv(Cc) : c.cod,
    F, T, Cc,
  };
}
function dryRun(byRegion) {
  console.log('\n──────── EXTRACTION (per calculation) ────────');
  const SRC = ['WIND', 'SOLAR', 'BESS', 'HYBRID', 'COAL', 'HYDRO', 'PSP'];
  for (const rg of REGIONS) {
    const { projects, contd4, transmission } = byRegion[rg];
    const hyb = projects.filter((p) => p.isHybrid);
    console.log(`\n${rg}: ${projects.length} FTC projects (${hyb.length} hybrid), ${contd4.length} CONTD-4, ${transmission.length} transmission`);
    const m = {};
    for (const p of projects) {
      const src = p.isHybrid ? 'HYBRID' : p.components[0].src;
      m[src] ??= { installed: 0, applied: 0, ftc: 0, toc: 0, cod: 0 };
      m[src].installed += p.total;
      for (const c of p.components) { const x = phaseMilestones(c, `${rg} ${p.name} ${c.src}`); m[src].applied += x.applied; m[src].ftc += x.ftc; m[src].toc += x.toc; m[src].cod += x.cod; }
    }
    for (const s of SRC) if (m[s]) console.log(`   ${s.padEnd(7)} inst=${r3(m[s].installed)}  applied=${r3(m[s].applied)}  ftc=${r3(m[s].ftc)}  toc=${r3(m[s].toc)}  cod=${r3(m[s].cod)}`);
    // hybrid component detail
    for (const p of hyb) {
      console.log(`   ⤷ ${p.name} [${p.plantCode}] total=${p.total}`);
      for (const c of p.components) { const x = phaseMilestones(c); console.log(`       ${c.src.padEnd(5)} applied=${c.applied} ftc=${x.ftc} toc=${x.toc} cod=${x.cod}  (${x.F.length}/${x.T.length}/${x.Cc.length} events)`); }
    }
  }
  if (warnings.length) { console.log('\n──────── WARNINGS / EXCLUSIONS ────────'); warnings.forEach((w) => console.log('  • ' + w)); }
  if (recon.length) { console.log('\n──────── EVENT↔STATED RECONCILIATIONS (sheet inconsistencies) ────────'); [...new Set(recon)].forEach((w) => console.log('  • ' + w)); }
}

// ── seed ──────────────────────────────────────────────────────────────────────
const D = (s) => { if (!s) return null; const d = new Date(s + 'T00:00:00.000Z'); return Number.isNaN(d.getTime()) ? null : d; };
async function seed(byRegion) {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  const regionId = {};
  for (const rg of REGIONS) regionId[rg] = (await prisma.gridRegion.findFirst({ where: { code: rg } })).id;

  const ptCache = {};
  async function plantId(code, isHybrid, category) {
    if (ptCache[code]) return ptCache[code];
    let pt = await prisma.plantType.findFirst({ where: { code } });
    if (!pt) pt = await prisma.plantType.create({ data: { code, label: labelFor(code, isHybrid), isHybrid, category } });
    return (ptCache[code] = pt.id);
  }
  const psCache = {};
  async function poolingStation(name, rid) {
    const n = String(name || '').trim();
    if (!n || n === '-') return null;
    const k = rid + '|' + n.toUpperCase();
    if (psCache[k]) return psCache[k];
    let ps = await prisma.poolingStation.findFirst({ where: { regionId: rid, name: n } });
    if (!ps) ps = await prisma.poolingStation.create({ data: { regionId: rid, name: n } });
    return (psCache[k] = ps.id);
  }

  console.log('\n──────── DELETING current transactional data ────────');
  await prisma.ftcEvent.deleteMany({});
  await prisma.tocEvent.deleteMany({});
  await prisma.codEvent.deleteMany({});
  await prisma.projectNote.deleteMany({});
  await prisma.commissioningPhase.deleteMany({});
  await prisma.contd4Phase.deleteMany({});
  await prisma.contd4Application.deleteMany({});
  await prisma.generationProject.deleteMany({});
  await prisma.transmissionAuditLog.deleteMany({});
  await prisma.transmissionElement.deleteMany({});
  await prisma.gridSnapshot.deleteMany({});
  console.log('  ✓ cleared');

  let pCount = 0, evCount = 0, c4Count = 0, txCount = 0;
  for (const rg of REGIONS) {
    const rid = regionId[rg];
    for (const p of byRegion[rg].projects) {
      const psId = await poolingStation(p.pooling, rid);
      const ptId = await plantId(p.plantCode, p.isHybrid, p.category);
      const hybridJson = p.isHybrid ? {
        hybridType: labelFor(p.plantCode, true),
        components: p.components.map((c) => { const x = phaseMilestones(c); return { sourceType: c.src, totalMw: c.total, appliedMw: c.applied, ftcMw: x.ftc, ftcDate: c.ftcDate, tocMw: x.toc, tocDate: c.tocDate, codMw: x.cod, codDate: c.codDate, expectedMw: c.expected || 0 }; }),
      } : null;
      const proj = await prisma.generationProject.create({
        data: {
          name: p.name, regionId: rid, plantTypeId: ptId, poolingStationId: psId,
          totalCapacityMw: p.total, inFtcPipeline: true, createdById: admin.id, hybridComponentsJson: hybridJson,
          contd4: { create: { status: 'CLEARED', capacityApr26Mw: p.contd4 || 0, applicationDate: null } },
        },
      });
      for (const c of p.components) {
        const x = phaseMilestones(c);
        const lastDate = (evs, fb) => (evs.length ? evs.map((e) => e.date).sort().slice(-1)[0] : fb);
        const phase = await prisma.commissioningPhase.create({
          data: {
            projectId: proj.id, sourceType: c.src, capacityAppliedMw: c.applied,
            ftcCompletedMw: x.ftc, ftcCompletedDate: D(lastDate(x.F, c.ftcDate)),
            tocIssuedMw: x.toc, tocIssuedDate: D(lastDate(x.T, c.tocDate)),
            codDeclaredMw: x.cod, codDeclaredDate: D(lastDate(x.Cc, c.codDate)),
            capacityUnderFtcMw: r3(c.applied - x.ftc), capacityUnderTocMw: r3(x.ftc - x.toc), capacityPendingCodMw: r3(x.toc - x.cod),
            expectedApr26Mw: c.expected || 0, expectedMonth: '2026-06',
            delayRemarks: p.issues, otherRemarks: p.other,
          },
        });
        for (const e of x.F) await prisma.ftcEvent.create({ data: { phaseId: phase.id, capacityMw: e.mw, eventDate: D(e.date) } });
        for (const e of x.T) await prisma.tocEvent.create({ data: { phaseId: phase.id, capacityMw: e.mw, eventDate: D(e.date) } });
        for (const e of x.Cc) await prisma.codEvent.create({ data: { phaseId: phase.id, capacityMw: e.mw, eventDate: D(e.date) } });
        evCount += x.F.length + x.T.length + x.Cc.length;
      }
      pCount++;
    }
    for (const p of byRegion[rg].contd4) {
      const psId = await poolingStation(p.pool, rid);
      const cls = classify(p.type, p.type);
      const ptId = await plantId(cls.code, cls.isHybrid, cls.category);
      await prisma.generationProject.create({
        data: {
          name: p.name, regionId: rid, plantTypeId: ptId, poolingStationId: psId,
          totalCapacityMw: p.cap, inFtcPipeline: false, createdById: admin.id,
          contd4: { create: { status: 'UNDER_PROCESS', capacityApr26Mw: p.jun, capacityMonth: '2026-06', applicationDate: D(p.app), remarks: p.rem,
            phases: p.jun > 0 ? { create: { declaredDate: D(p.app) || D('2026-06-01'), capacityMw: p.jun, capacityMonth: '2026-06' } } : undefined } },
        },
      });
      c4Count++;
    }
    for (const e of byRegion[rg].transmission) {
      const { firstEnergyDate, proposedFtcDate, ...rest } = e;
      await prisma.transmissionElement.create({ data: { regionId: rid, ...rest, firstEnergyDate: D(firstEnergyDate), proposedFtcDate: D(proposedFtcDate) } });
      txCount++;
    }
  }

  // Single clean "as on today" snapshot baseline (no fake historical changes).
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  console.log(`\n  ✓ seeded ${pCount} FTC projects (${evCount} dated events) + ${c4Count} CONTD-4 + ${txCount} transmission`);
  return { pCount, evCount, c4Count, txCount, today };
}

(async () => {
  const byRegion = {};
  for (const rg of REGIONS) byRegion[rg] = buildRegion(rg);
  dryRun(byRegion);
  if (!DO_SEED) { console.log('\n(dry-run only — re-run with --seed to write)'); await prisma.$disconnect(); return; }
  await seed(byRegion);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
