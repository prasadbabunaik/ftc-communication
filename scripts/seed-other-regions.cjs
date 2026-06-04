// Seed WR / SR / ER / NER from the Google-Sheet workbook (NR is seeded
// separately by seed-nr.cjs and is left untouched). Non-hybrid projects come
// from each region's main FTC table; hybrids are bifurcated per component from
// the "source-wise segregation" table. One event per milestone per phase
// (dated at the milestone date) — totals are taken from the explicit columns
// so the computed matrix is faithful to the sheet's per-project rows.
//
//   node scripts/seed-other-regions.cjs --dry    (compute + compare, NO writes)
//   node scripts/seed-other-regions.cjs          (delete WR/SR/ER/NER + seed)
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const fs = require('fs');
const XLSX = require('xlsx-js-style');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DRY = process.argv.includes('--dry');
const XLSX_JSON = '/tmp/ftc_xlsx.json';
const REGIONS = ['WR', 'SR', 'ER', 'NER'];

// ── helpers ──────────────────────────────────────────────────────────────────
const num = (v) => { const n = parseFloat(String(v).replace(/[, ]/g, '')); return Number.isFinite(n) ? n : 0; };
const isNumeric = (v) => v !== '' && v != null && Number.isFinite(parseFloat(String(v).replace(/[, ]/g, '')));

// Excel serial date → ISO (UTC). 25569 = days between 1899-12-30 and 1970-01-01.
function serialToISO(serial) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (isNaN(d) || d.getUTCFullYear() < 2020 || d.getUTCFullYear() > 2030) return null;
  return d.toISOString().slice(0, 10);
}
// Parse a date cell that may be an Excel serial number or a messy string.
// Returns the LATEST date found (representative), or null.
function parseDateCell(v) {
  if (v == null || v === '' || v === '-') return null;
  if (typeof v === 'number') return v > 40000 && v < 60000 ? serialToISO(v) : null;
  const s = String(v);
  // collect dd.mm.yyyy / dd-mm-yyyy / dd Mon yyyy / dd Mon yy
  const found = [];
  let m;
  const re1 = /(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/g;
  while ((m = re1.exec(s))) { let [_, d, mo, y] = m; y = y.length === 2 ? '20' + y : y; found.push(`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`); }
  const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
  const re2 = /(\d{1,2})\s*[-]?\s*([A-Za-z]{3,})\s*[-]?\s*(\d{2,4})/g;
  while ((m = re2.exec(s))) { const mo = months[m[2].slice(0,3).toLowerCase()]; if (mo) { let y = m[3].length===2?'20'+m[3]:m[3]; found.push(`${y}-${mo}-${String(m[1]).padStart(2,'0')}`); } }
  if (!found.length) return null;
  found.sort();
  return found[found.length - 1];  // latest
}

// Parse a milestone date cell into ALL dated partial events. Handles the
// sheet's "DD-MM-YYYY (51.975MW)" / "DD-MM-YYYY (U1 240MW)" / "150MW (30.03.2026)"
// formats, one event per line. Returns [{ mw, date }] (date = ISO).
function parseEvents(v) {
  if (v == null) return [];
  if (typeof v === 'number') { const d = v > 40000 && v < 60000 ? serialToISO(v) : null; return d ? [{ mw: null, date: d }] : []; }
  const s = String(v);
  if (!s.trim() || /^[-\s]*$/.test(s)) return [];
  const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
  const out = [];
  for (const ch of s.split(/[\n;]+/)) {
    if (!ch.trim()) continue;
    let date = null;
    let m = ch.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/);
    if (m) { let y = m[3].length === 2 ? '20' + m[3] : m[3]; date = `${y}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`; }
    else { m = ch.match(/(\d{1,2})\s*[-]?\s*([A-Za-z]{3,})\s*[-]?\s*(\d{2,4})/); if (m && months[m[2].slice(0,3).toLowerCase()]) { let y = m[3].length === 2 ? '20' + m[3] : m[3]; date = `${y}-${months[m[2].slice(0,3).toLowerCase()]}-${String(m[1]).padStart(2,'0')}`; } }
    if (!date) continue;
    const mw = ch.match(/(\d+(?:\.\d+)?)\s*MW/i);  // number directly before "MW" (e.g. "U1 240MW" → 240)
    out.push({ mw: mw ? parseFloat(mw[1]) : null, date });
  }
  return out;
}
const sumEv = (evs) => Math.round(evs.reduce((a, e) => a + (e.mw || 0), 0) * 1000) / 1000;
// Turn parsed events into final {mw,date} list: dateless-MW events absorb the
// leftover toward the milestone total; drop zero/empty.
function resolveEvents(events, total) {
  if (!events || !events.length) return [];
  const known = events.filter(e => e.mw != null);
  const unknown = events.filter(e => e.mw == null);
  if (unknown.length) {
    const rem = Math.max(0, (total || 0) - known.reduce((a, e) => a + e.mw, 0));
    const per = Math.round((rem / unknown.length) * 1000) / 1000;
    unknown.forEach(e => { e.mw = per; });
  }
  return events.filter(e => e.mw > 0).map(e => ({ mw: e.mw, date: e.date }));
}

// Classify a plant-type / source string into { code, source, isHybrid, category, comps }
const ABBR = { WIND:'W', SOLAR:'S', BESS:'B', COAL:'C', HYDRO:'H', PSP:'P' };
const ORDER = ['WIND','SOLAR','BESS','COAL','HYDRO','PSP'];
function classify(plantStr, srcStr) {
  const t = `${plantStr || ''} ${srcStr || ''}`.toUpperCase();
  const comps = [];
  if (/WIND/.test(t)) comps.push('WIND');
  if (/SOLAR/.test(t)) comps.push('SOLAR');
  if (/BESS|BATTERY/.test(t)) comps.push('BESS');
  if (/COAL|THERMAL/.test(t)) comps.push('COAL');
  if (/HYDRO/.test(t)) comps.push('HYDRO');
  if (/PSP|PUMP/.test(t)) comps.push('PSP');
  if (comps.length === 0) comps.push('SOLAR'); // fallback
  const ordered = ORDER.filter(s => comps.includes(s));
  const isHybrid = /HYBRID/.test(t) || ordered.length > 1;
  const code = isHybrid ? 'HYBRID_' + ordered.map(s => ABBR[s]).join('') : ordered[0];
  const category = ordered.some(s => ['COAL','HYDRO'].includes(s)) ? 'CONVENTIONAL'
    : ordered.some(s => ['WIND','SOLAR'].includes(s)) ? 'RENEWABLE' : 'STORAGE';
  return { code, source: ordered[0], isHybrid, category, comps: ordered };
}
const sourceEnum = (s) => { const u = String(s||'').toUpperCase(); if (/WIND/.test(u)) return 'WIND'; if (/SOLAR/.test(u)) return 'SOLAR'; if (/BESS|BATTERY/.test(u)) return 'BESS'; if (/COAL/.test(u)) return 'COAL'; if (/HYDRO/.test(u)) return 'HYDRO'; if (/PSP|PUMP/.test(u)) return 'PSP'; return 'SOLAR'; };

// ── workbook extraction ──────────────────────────────────────────────────────
const wb = XLSX.read(Buffer.from(JSON.parse(fs.readFileSync(XLSX_JSON, 'utf8')).content, 'base64'), { type: 'buffer' });
const sheetRows = (name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: '' });
const isFtcHdr = (r) => /Generating Station/i.test(String(r[1])) && /Total Plant Capacity/i.test(r.map(String).join(' '));

// Main FTC table → one row per project (hybrids appear as a single aggregate row).
function extractMain(region) {
  const rows = sheetRows(region);
  const hdr = rows.findIndex(isFtcHdr);
  if (hdr < 0) return [];
  const out = [];
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i];
    const station = String(r[1] || '').trim();
    if (!station || /^total/i.test(station)) break;
    if (String(r[4] || '').trim().toUpperCase() !== region) continue;
    out.push({
      name: station, pooling: String(r[2] || '').trim(), plantStr: String(r[3] || ''),
      total: num(r[5]), contd4: num(r[6]), applied: num(r[7]), srcStr: String(r[8] || ''),
      ftc: num(r[9]), ftcDate: parseDateCell(r[10]), ftcEvents: parseEvents(r[10]),
      toc: num(r[11]), tocDate: parseDateCell(r[12]), tocEvents: parseEvents(r[12]),
      cod: num(r[13]), codDate: parseDateCell(r[14]), codEvents: parseEvents(r[14]),
      expected: num(r[19]),
      issues: String(r[20] || '').trim() || null, other: String(r[21] || '').trim() || null,
    });
  }
  return out;
}

// Segregation table → { stationName: [ {source, total, applied, ftc/ftcDate, ...} ] }
function extractSegregation(region) {
  const rows = sheetRows(region);
  const hdrs = rows.map((r, i) => isFtcHdr(r) ? i : -1).filter(i => i >= 0);
  if (hdrs.length < 2) return {};
  const hdr = hdrs[1]; // second FTC table = segregation
  const map = {}; let cur = null;
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i];
    const station = String(r[1] || '').trim();
    if (station && /^total/i.test(station)) break;
    if (station) cur = station;
    if (!cur) continue;
    if (String(r[4] || '').trim().toUpperCase() !== region) { if (station && !isNumeric(r[5])) break; else continue; }
    (map[cur] ??= []).push({
      source: sourceEnum(r[8]), total: num(r[5]), applied: num(r[7]),
      ftc: num(r[9]), ftcDate: parseDateCell(r[10]), toc: num(r[11]), tocDate: parseDateCell(r[12]),
      cod: num(r[13]), codDate: parseDateCell(r[14]),
    });
  }
  return map;
}

// CONTD-4 study table (status RECEIVED) per region.
function extractContd4(region) {
  const rows = sheetRows(region);
  const hdr = rows.findIndex(r => /Generating Station/i.test(String(r[1] ?? r[0])) && /Application Date/i.test(r.map(String).join(' ')));
  if (hdr < 0) return [];
  // column offset: some tabs have Sr in col0, station col1
  const c = rows[hdr].map(x => String(x).toLowerCase());
  const ci = (kw) => c.findIndex(x => x.includes(kw));
  const idxStation = ci('generating station'), idxPool = ci('pooling'), idxType = ci('generation type') >= 0 ? ci('generation type') : ci('plant type'),
        idxCap = ci('capacity(mw)') >= 0 ? ci('capacity(mw)') : ci('capacity'), idxApp = ci('application date'),
        idxJun = c.findIndex(x => x.includes('to be completed')), idxRem = c.findIndex(x => x.includes('issues') || x.includes('remark'));
  const out = []; let lastType = null;
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i];
    const station = String(r[idxStation] || '').trim();
    const typ = String(r[idxType] || '').trim();
    // stop when we hit the FTC table or a blank gap
    if (/generation capacity under process of ftc/i.test(r.map(String).join(' '))) break;
    if (isFtcHdr(r)) break;
    if (!station && !typ) continue;
    if (String(r[4] || r[idxStation+3] || '').trim() && String(r[4]||'').toUpperCase() !== region && idxStation === 1) { /* region col may differ */ }
    const cap = num(r[idxCap]);
    if (!station && typ) {
      // continuation row (second source of a multi-source CONTD-4 project)
      out.push({ name: `${out.length ? out[out.length-1].name : 'Unknown'} (${typ})`, contStation: true, pool: out[out.length-1]?.pool ?? null, type: typ, cap, jun: num(r[idxJun]), app: parseDateCell(r[idxApp]), rem: String(r[idxRem]||'').trim() || null });
      continue;
    }
    if (cap <= 0 && num(r[idxJun]) <= 0 && !typ) continue;
    out.push({ name: station, pool: String(r[idxPool]||'').trim() || null, type: typ, cap, jun: num(r[idxJun]), app: parseDateCell(r[idxApp]), rem: String(r[idxRem]||'').trim() || null });
  }
  return out.filter(p => p.cap > 0 || p.jun > 0);
}

// Transmission elements table per region.
function extractTransmission(region) {
  const rows = sheetRows(region);
  const ti = rows.findIndex(r => /Transmission Elements Under Process of FTC/i.test(r.map(String).join(' ')));
  const hi = rows.findIndex((r, i) => i > ti && /Agency.?Owner|Name of Line/i.test(r.map(String).join(' ')));
  if (hi < 0) return [];
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    // Stop at the next section — the FTC/segregation table header or title, or a
    // row whose Type column is a generation source (we've left the TX table).
    if (isFtcHdr(r)) break;
    const joined = r.map(String).join(' ');
    if (/Generation Capacity Under Process|Segregation of hybrid|Generating Station/i.test(joined)) break;
    const agency = String(r[1] || '').trim(), name = String(r[2] || '').trim();
    if (!agency && !name) { if (out.length) break; else continue; }
    if (/^total/i.test(agency) || /^total/i.test(name)) break;
    const ty = String(r[3] || '').toUpperCase();
    if (/SOLAR|WIND|HYBRID|BESS|COAL|HYDRO|PSP|PUMP/.test(ty)) break;   // entered a generation table
    const elementType = /ICT/.test(ty) ? 'ICT' : /GT/.test(ty) ? 'GT' : /ST/.test(ty) ? 'ST' : 'LINE';
    out.push({
      agencyOwner: agency || name, elementName: name || agency, elementType,
      isRe: /RE/i.test(String(r[4])) && !/NON/i.test(String(r[4])),
      voltageRatingKv: isNumeric(r[5]) ? Math.round(num(r[5])) : null,
      capacityMva: isNumeric(r[6]) ? num(r[6]) : null,
      lineLengthKm: isNumeric(r[7]) ? num(r[7]) : null,
      firstEnergyDate: parseDateCell(r[8]),
      pendingFtc: /yes/i.test(String(r[9])),
      proposedFtcDate: parseDateCell(r[10]),
      capacityApr26Mva: isNumeric(r[11]) ? num(r[11]) : null,
      lineLengthApr26Km: isNumeric(r[12]) ? num(r[12]) : null,
      remarks: String(r[13] || '').trim() || null,
    });
  }
  return out;
}

// ── Build seed model per region ──────────────────────────────────────────────
function buildRegion(region) {
  const main = extractMain(region);
  const seg = extractSegregation(region);
  const projects = [];
  for (const p of main) {
    const cls = classify(p.plantStr, p.srcStr);
    // Always take the project's totals from its single MAIN-table row (the
    // authoritative per-project list the Summary tab is built from). For
    // hybrids we additionally attach the per-component breakdown from the
    // segregation table as hybridComponentsJson (display only) when it's
    // present — it does NOT change the aggregate.
    const segComps = (cls.isHybrid && seg[p.name]) ? seg[p.name].filter(c => c.total > 0 || c.applied > 0) : null;
    projects.push({
      name: p.name, pooling: p.pooling, plantCode: cls.code, isHybrid: cls.isHybrid, category: cls.category,
      total: p.total, contd4: p.contd4, expected: p.expected, issues: p.issues, other: p.other,
      components: [{
        src: cls.source, total: p.total, applied: p.applied,
        ftc: p.ftc, ftcDate: p.ftcDate, ftcEvents: p.ftcEvents,
        toc: p.toc, tocDate: p.tocDate, tocEvents: p.tocEvents,
        cod: p.cod, codDate: p.codDate, codEvents: p.codEvents,
      }],
      hybridComps: segComps,
    });
  }
  return { projects, contd4: extractContd4(region) };
}

// ── Dry-run: compute region×source matrix and compare to the Summary tab ──────
function summaryTargets() {
  const rows = sheetRows('Summary');
  const hdr = rows.findIndex(r => /Total Installed Capacity/i.test(r.map(String).join('|')) && /FTC approved/i.test(r.map(String).join('|')));
  const t = {}; let region = null;
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i];
    const rg = String(r[0] || '').trim();
    const src = String(r[1] || '').trim();
    if (rg && ['NR','WR','SR','ER','NER','All India'].includes(rg)) region = rg;
    if (!region || !src || src === 'Total') continue;
    if (region === 'All India') break;
    const SRC = src.toUpperCase() === 'HYBRID' ? 'HYBRID' : src.toUpperCase();
    t[`${region}|${SRC}`] = { installed: num(r[2]), contd4: num(r[3]), applied: num(r[4]), ftc: num(r[5]), toc: num(r[7]), cod: num(r[9]), expected: num(r[11]) };
  }
  return t;
}

function computeMatrix(byRegion) {
  const m = {};
  for (const [region, data] of Object.entries(byRegion)) {
    for (const p of data.projects) {
      const src = p.isHybrid ? 'HYBRID' : p.components[0].src;
      const key = `${region}|${src}`;
      (m[key] ??= { installed:0, contd4:0, applied:0, ftc:0, toc:0, cod:0, expected:0 });
      m[key].installed += p.total; m[key].contd4 += p.contd4; m[key].expected += p.expected;
      for (const c of p.components) { m[key].applied += c.applied; m[key].ftc += c.ftc; m[key].toc += c.toc; m[key].cod += c.cod; }
    }
  }
  return m;
}

(async () => {
  const byRegion = {};
  for (const rg of REGIONS) byRegion[rg] = buildRegion(rg);

  console.log('=== Extraction counts ===');
  for (const rg of REGIONS) console.log(`  ${rg}: ${byRegion[rg].projects.length} FTC projects (${byRegion[rg].projects.filter(p=>p.isHybrid).length} hybrid), ${byRegion[rg].contd4.length} CONTD-4`);

  const targets = summaryTargets();
  const matrix = computeMatrix(byRegion);
  const r2 = (v) => Math.round(v * 100) / 100;
  console.log('\n=== Computed (ours, from per-project rows) vs Summary tab ===');
  for (const rg of REGIONS) {
    for (const src of ['WIND','SOLAR','BESS','HYBRID','COAL','HYDRO','PSP']) {
      const o = matrix[`${rg}|${src}`]; const t = targets[`${rg}|${src}`];
      if (!o && (!t || (t.installed===0 && t.applied===0))) continue;
      const O = o || { installed:0,contd4:0,applied:0,ftc:0,toc:0,cod:0,expected:0 };
      const T = t || { installed:0,contd4:0,applied:0,ftc:0,toc:0,cod:0,expected:0 };
      const diffs = ['installed','contd4','applied','ftc','toc','cod','expected'].map(k => r2(O[k]-T[k]));
      const bad = diffs.some(d => Math.abs(d) > 1);
      console.log(`${rg} ${src}${bad?'  *** DIFF ***':'  ok'}  inst ${r2(O.installed)}/${r2(T.installed)}  app ${r2(O.applied)}/${r2(T.applied)}  ftc ${r2(O.ftc)}/${r2(T.ftc)}  toc ${r2(O.toc)}/${r2(T.toc)}  cod ${r2(O.cod)}/${r2(T.cod)}  exp ${r2(O.expected)}/${r2(T.expected)}`);
    }
  }

  if (DRY) { console.log('\n[dry-run] no DB writes.'); await prisma.$disconnect(); return; }

  // ── Seed into the live DB (WR/SR/ER/NER only; NR untouched) ────────────────
  const regionRows = await prisma.gridRegion.findMany();
  const regionId = Object.fromEntries(regionRows.map(r => [r.code, r.id]));
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } }) || await prisma.user.findFirst();
  const plantTypes = await prisma.plantType.findMany();
  const ptByCode = Object.fromEntries(plantTypes.map(t => [t.code, t.id]));
  const labelFor = (code, isHybrid) => {
    if (!isHybrid) return ({ SOLAR:'Solar', WIND:'Wind', BESS:'Battery Energy Storage (BESS)', COAL:'Coal', HYDRO:'Hydro', PSP:'Pumped Storage Plant (PSP)' })[code] ?? code;
    const names = { W:'Wind', S:'Solar', B:'BESS', C:'Coal', H:'Hydro', P:'PSP' };
    return 'Hybrid (' + code.replace('HYBRID_','').split('').map(a => names[a]).join('+') + ')';
  };
  async function plantId(code, isHybrid, category) {
    if (ptByCode[code]) return ptByCode[code];
    const pt = await prisma.plantType.create({ data: { code, label: labelFor(code, isHybrid), isHybrid, category } });
    ptByCode[code] = pt.id; return pt.id;
  }

  const targetRegionIds = REGIONS.map(r => regionId[r]);
  console.log('\nDeleting WR/SR/ER/NER transactional data (NR kept)…');
  const projIds = (await prisma.generationProject.findMany({ where: { regionId: { in: targetRegionIds } }, select: { id: true } })).map(p => p.id);
  await prisma.ftcEvent.deleteMany({ where: { phase: { projectId: { in: projIds } } } });
  await prisma.tocEvent.deleteMany({ where: { phase: { projectId: { in: projIds } } } });
  await prisma.codEvent.deleteMany({ where: { phase: { projectId: { in: projIds } } } });
  await prisma.projectNote.deleteMany({ where: { projectId: { in: projIds } } });
  await prisma.commissioningPhase.deleteMany({ where: { projectId: { in: projIds } } });
  await prisma.contd4Phase.deleteMany({ where: { contd4: { projectId: { in: projIds } } } });
  await prisma.contd4Application.deleteMany({ where: { projectId: { in: projIds } } });
  await prisma.generationProject.deleteMany({ where: { id: { in: projIds } } });
  // Transmission was wiped by earlier seeds — reseed ALL regions (NR included).
  await prisma.transmissionAuditLog.deleteMany({});
  await prisma.transmissionElement.deleteMany({});

  const D = (s) => { if (!s) return null; const d = new Date(s + 'T00:00:00.000Z'); return isNaN(d.getTime()) ? null : d; };
  const r3 = (v) => Math.max(0, Math.round(v * 1000) / 1000);
  const psCache = {};
  async function poolingStation(name, rid) {
    const nm = (name || '').trim();
    if (!nm || /^[-–—\s]+$/.test(nm)) return null;
    const key = rid + '|' + nm;
    if (psCache[key]) return psCache[key];
    let ps = await prisma.poolingStation.findFirst({ where: { name: nm, regionId: rid } });
    if (!ps) ps = await prisma.poolingStation.create({ data: { name: nm, regionId: rid } });
    psCache[key] = ps.id; return ps.id;
  }

  let ftcCount = 0, c4Count = 0, ftcEvCount = 0, txCount = 0;
  for (const rg of REGIONS) {
    const rid = regionId[rg];
    for (const p of byRegion[rg].projects) {
      const psId = await poolingStation(p.pooling, rid);
      const ptId = await plantId(p.plantCode, p.isHybrid, p.category);
      const hybridJson = (p.isHybrid && p.hybridComps && p.hybridComps.length) ? {
        hybridType: labelFor(p.plantCode, true),
        components: p.hybridComps.map(c => ({ sourceType: c.source, totalMw: c.total, appliedMw: c.applied, ftcMw: c.ftc, ftcDate: c.ftcDate, tocMw: c.toc, tocDate: c.tocDate, codMw: c.cod, codDate: c.codDate, expectedMw: 0 })),
      } : null;
      const proj = await prisma.generationProject.create({
        data: {
          name: p.name, regionId: rid, plantTypeId: ptId, poolingStationId: psId,
          totalCapacityMw: p.total, inFtcPipeline: true, createdById: admin.id, hybridComponentsJson: hybridJson,
          contd4: { create: { status: 'CLEARED', capacityApr26Mw: p.contd4, applicationDate: null } },
        },
      });
      for (const c of p.components) {
        // Resolve granular dated events; distribute any leftover MW to dateless
        // events, and fall back to a single cached total when nothing parsed.
        const F = resolveEvents(c.ftcEvents, c.ftc), T = resolveEvents(c.tocEvents, c.toc), Cc = resolveEvents(c.codEvents, c.cod);
        const ftcMw = F.length ? sumEv(F) : c.ftc, tocMw = T.length ? sumEv(T) : c.toc, codMw = Cc.length ? sumEv(Cc) : c.cod;
        const lastDate = (evs, fb) => evs.length ? evs.map(e => e.date).sort().slice(-1)[0] : fb;
        const phase = await prisma.commissioningPhase.create({
          data: {
            projectId: proj.id, sourceType: c.src, capacityAppliedMw: c.applied,
            ftcCompletedMw: ftcMw, ftcCompletedDate: D(lastDate(F, c.ftcDate)),
            tocIssuedMw: tocMw, tocIssuedDate: D(lastDate(T, c.tocDate)),
            codDeclaredMw: codMw, codDeclaredDate: D(lastDate(Cc, c.codDate)),
            capacityUnderFtcMw: r3(c.applied - ftcMw), capacityUnderTocMw: r3(ftcMw - tocMw), capacityPendingCodMw: r3(tocMw - codMw),
            expectedApr26Mw: p.expected, expectedMonth: '2026-06',
            delayRemarks: p.issues, otherRemarks: p.other,
          },
        });
        for (const e of F) await prisma.ftcEvent.create({ data: { phaseId: phase.id, capacityMw: e.mw, eventDate: D(e.date) } });
        for (const e of T) await prisma.tocEvent.create({ data: { phaseId: phase.id, capacityMw: e.mw, eventDate: D(e.date) } });
        for (const e of Cc) await prisma.codEvent.create({ data: { phaseId: phase.id, capacityMw: e.mw, eventDate: D(e.date) } });
        ftcEvCount += F.length + T.length + Cc.length;
      }
      ftcCount++;
    }
    for (const p of byRegion[rg].contd4) {
      const psId = await poolingStation(p.pool, rid);
      const cls = classify(p.type, p.type);
      const ptId = await plantId(cls.code, cls.isHybrid, cls.category);
      await prisma.generationProject.create({
        data: {
          name: p.name, regionId: rid, plantTypeId: ptId, poolingStationId: psId,
          totalCapacityMw: p.cap, inFtcPipeline: false, createdById: admin.id,
          contd4: { create: { status: 'RECEIVED', capacityApr26Mw: p.jun, capacityMonth: '2026-06', applicationDate: D(p.app), remarks: p.rem,
            phases: p.jun > 0 ? { create: { declaredDate: D(p.app) || D('2026-06-01'), capacityMw: p.jun, capacityMonth: '2026-06' } } : undefined } },
        },
      });
      c4Count++;
    }
  }

  // ── Transmission for ALL regions (NR included; tx was wiped earlier) ───────
  for (const rg of ['NR', 'WR', 'SR', 'ER', 'NER']) {
    const rid = regionId[rg];
    for (const e of extractTransmission(rg)) {
      const { firstEnergyDate, proposedFtcDate, ...rest } = e;
      await prisma.transmissionElement.create({
        data: { regionId: rid, ...rest, firstEnergyDate: D(firstEnergyDate), proposedFtcDate: D(proposedFtcDate) },
      });
      txCount++;
    }
  }

  console.log(`  ✓ seeded ${ftcCount} FTC projects (${ftcEvCount} dated events) + ${c4Count} CONTD-4 + ${txCount} transmission elements`);
  console.log('Counts now:', {
    projects: await prisma.generationProject.count(),
    ftcEv: await prisma.ftcEvent.count(), tocEv: await prisma.tocEvent.count(), codEv: await prisma.codEvent.count(),
    tx: await prisma.transmissionElement.count(),
  });
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
