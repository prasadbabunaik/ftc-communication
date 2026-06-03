// NR-only reseed from the Google Sheet (raw entry — calculations are derived).
// Deletes all TRANSACTIONAL grid data (keeps master: regions, plant types,
// generating stations, users) and seeds the NR region's FTC pipeline + CONTD-4
// study projects with full milestone-event granularity. Then computes our
// pipeline matrix as-of 30-Jun-2026 and prints a comparison vs the sheet.
//
// Run:  node scripts/seed-nr.cjs
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { computePipelineMatrix } = require('../lib/grid-computations');

const D = (s) => s ? new Date(s + 'T00:00:00.000Z') : null;
const sum = (evs) => Math.round(evs.reduce((a, e) => a + e[0], 0) * 1000) / 1000;
const lastDate = (evs) => evs.length ? evs.map(e => e[1]).sort().slice(-1)[0] : null;

// ── NR FTC pipeline projects (raw per-project data) ──────────────────────────
// ev rows are [mw, 'YYYY-MM-DD']. col totals (applied/contd4/total/expected)
// are the explicit sheet numbers; ftc/toc/cod totals are derived from events.
const FTC = [
  { n:'IB VOGT SOLAR SEVEN PRIVATE LIMITED(IBVSSPL)', ps:'Fatehgarh-III', pt:'SOLAR', src:'SOLAR', total:300, contd4:300, applied:300, exp:100,
    ftc:[[300,'2026-03-18']], toc:[[200,'2026-03-27']], cod:[[150,'2026-03-30'],[50,'2026-04-01']] },
  { n:'RENEW SAMIR SHAKTI THREE PRIVATE LIMITED', ps:'Fatehgarh-III', pt:'SOLAR', src:'SOLAR', total:300, contd4:300, applied:300, exp:0,
    ftc:[[300,'2026-02-16']], toc:[[210.31,'2026-03-17'],[64.67,'2026-03-24'],[25.02,'2026-03-31']], cod:[[210.31,'2026-03-17'],[64.67,'2026-03-26'],[25.02,'2026-04-02']] },
  { n:'RENEW SOLAR SHAKTI THREE PRIVATE LIMITED(RSS3PL)', ps:'Fatehgarh-III', pt:'SOLAR', src:'SOLAR', total:300, contd4:300, applied:300, exp:0,
    ftc:[[300,'2026-02-11']], toc:[[300,'2026-03-11']], cod:[[300,'2026-03-13']] },
  { n:'ADANI SOLAR ENERGY BARMER ONE LIMITED(ASEB1L)', ps:'Fatehgarh-III', pt:'SOLAR', src:'SOLAR', total:600, contd4:600, applied:251, exp:0,
    ftc:[[251,'2026-03-15']], toc:[[251,'2026-03-23']], cod:[[251,'2026-03-25']] },  // COD date sheet says 25.03.2025 (likely 2026)
  { n:'Khaba Renewable Energy Private Limited (KREPL)', ps:'Fatehgarh-III', pt:'SOLAR', src:'SOLAR', total:250, contd4:250, applied:221, exp:71,
    ftc:[[221,'2026-03-02']], toc:[[100,'2026-03-13'],[50,'2026-03-27']], cod:[[100,'2026-03-14'],[50,'2026-03-27']] },
  // Hybrid — bifurcated per component (Solar / BESS / Wind). The sheet labels
  // each milestone lot by source ("88MW solar", "90MW BESS", "Wind 50.4MW").
  { n:'Juniper Green Stellar Private Limited(JGSPL)', ps:'Fatehgarh-IV', pt:'HYBRID_WSB', total:715, contd4:365, exp:0,
    components:[
      { src:'SOLAR', total:285, contd4:365, applied:285, exp:0,
        ftc:[[185,'2026-03-16'],[100,'2026-04-06']], toc:[[88,'2026-03-25'],[97,'2026-04-10']], cod:[[88,'2026-03-27'],[97,'2026-04-12']] },
      { src:'BESS', total:180, contd4:0, applied:180, exp:0,
        ftc:[[90,'2026-03-17'],[90,'2026-03-21']], toc:[[90,'2026-04-02'],[90,'2026-04-22']], cod:[[90,'2026-04-08'],[90,'2026-04-24']] },
      // Wind: only 50.4MW applied/FTC'd of the 250MW plant; dropped extra 25.2MW (26.05) to reconcile to col total.
      { src:'WIND', total:250, contd4:0, applied:50.4, exp:0,
        ftc:[[50.4,'2026-05-16']], toc:[], cod:[] },
    ] },
  { n:'PROJECT ELEVEN RENEWABLE POWER PRIVATE LIMITED(P11RPPL)', ps:'Bhadla-II', pt:'SOLAR', src:'SOLAR', total:150, contd4:150, applied:150, exp:0,
    ftc:[[100,'2026-03-25'],[50,'2026-05-26']], toc:[[87.5,'2026-04-17'],[12.5,'2026-05-13']], cod:[[87.5,'2026-04-19'],[12.5,'2026-05-15']] },
  { n:'PROJECT 16 RENEWABLE POWER PRIVATE LIMITED(P16RPPL)', ps:'Bhadla-II', pt:'SOLAR', src:'SOLAR', total:300, contd4:300, applied:300, exp:0,
    ftc:[[200,'2026-03-25'],[100,'2026-05-26']], toc:[[150,'2026-04-16'],[50,'2026-05-13']], cod:[[150,'2026-04-18'],[50,'2026-05-15']] },
  { n:'ACME SUN POWER PRIVATE LIMITED(ASPPL)', ps:'Bhadla-II', pt:'BESS', src:'BESS', total:300, contd4:300, applied:291.669, exp:33.331,
    ftc:[[66.67,'2026-02-26'],[33.333,'2026-03-17'],[66.667,'2026-03-24'],[124.999,'2026-04-27']],
    toc:[[33.335,'2026-03-06'],[33.335,'2026-03-12'],[33.33,'2026-03-31'],[33.33,'2026-04-01'],[33.334,'2026-04-06'],[33.333,'2026-05-04'],[33.333,'2026-05-11'],[33.333,'2026-06-01']],
    cod:[[33.335,'2026-03-08'],[33.335,'2026-03-14'],[33.333,'2026-04-02'],[33.333,'2026-04-03'],[33.334,'2026-04-08'],[33.333,'2026-05-06'],[33.333,'2026-05-13'],[33.333,'2026-06-03']] },
  { n:'ACME SURYODAYA PRIVATE LIMITED(ACME_SPL)', ps:'Fatehgarh-I', pt:'BESS', src:'BESS', total:300, contd4:285, applied:285, exp:0,
    ftc:[[76,'2026-02-10'],[95,'2026-03-14'],[114,'2026-03-29']],
    toc:[[19,'2026-02-25'],[38,'2026-03-03'],[19,'2026-03-11'],[95,'2026-03-23'],[76,'2026-04-06'],[38,'2026-04-13']],
    cod:[[19,'2026-02-27'],[38,'2026-03-05'],[19,'2026-03-13'],[95,'2026-03-25'],[76,'2026-04-08'],[38,'2026-04-15']] },
  { n:'ACME Surya POWER Private Limited (ASRPPL)', ps:'Bikaner-II', pt:'BESS', src:'BESS', total:250, contd4:250, applied:245.536, exp:4.464,
    ftc:[[71.429,'2026-03-16'],[35.714,'2026-03-17'],[35.714,'2026-03-24'],[35.714,'2026-04-17'],[66.965,'2026-04-23']],
    toc:[[60,'2026-03-23'],[35.71,'2026-03-24'],[11.429,'2026-03-29'],[32.366,'2026-04-13'],[35.714,'2026-04-29'],[35.714,'2026-05-11'],[34.598,'2026-05-27']],
    cod:[[60,'2026-03-23'],[35.714,'2026-03-24'],[11.429,'2026-03-29'],[32.366,'2026-04-15'],[35.714,'2026-05-01'],[35.714,'2026-05-13'],[34.598,'2026-05-29']] },
  { n:'Clean Max Celestial Private Limited(CMCPL)', ps:'Bikaner-II', pt:'SOLAR', src:'SOLAR', total:250, contd4:250, applied:250, exp:15.43,
    ftc:[[234.57,'2026-04-27'],[15.43,'2026-05-26']], toc:[[98.8,'2026-05-20'],[61.75,'2026-05-26'],[74.02,'2026-05-26']], cod:[[98.8,'2026-05-22'],[61.75,'2026-05-28'],[74.02,'2026-05-28']] },
  { n:'Clean Max Enviro Energy Solutions Limited(CMEESL)', ps:'Bikaner-II', pt:'SOLAR', src:'SOLAR', total:100, contd4:100, applied:100, exp:6.25,
    ftc:[[93.75,'2026-04-27'],[6.25,'2026-05-26']], toc:[[62.5,'2026-05-20'],[31.25,'2026-05-26']], cod:[[62.5,'2026-05-22'],[31.25,'2026-05-28']] },
  { n:'Energizent POWER Private Limited', ps:'Fatehgarh-III', pt:'SOLAR', src:'SOLAR', total:250, contd4:250, applied:129.6, exp:0,
    ftc:[[60.6,'2026-03-27'],[69,'2025-10-29']], toc:[[69,'2025-11-07'],[60.6,'2026-04-22']], cod:[[69,'2025-11-09'],[60.6,'2026-04-22']] },
  { n:'BBMB Panipat', ps:'Panipat', pt:'SOLAR', src:'SOLAR', total:10, contd4:8.8, applied:8.8, exp:0,
    ftc:[[8.8,'2026-03-02']], toc:[[8.8,'2026-03-11']], cod:[[8.8,'2026-03-11']] },
  { n:'Tehri', ps:null, pt:'PSP', src:'PSP', total:1000, contd4:1000, applied:1000, exp:0,
    // TOC/COD date text only specifies 250MW lot; col totals are 1000.
    ftc:[[1000,'2026-03-06']], toc:[[1000,'2026-04-10']], cod:[[1000,'2026-04-12']] },
  { n:'Adani Green Energy Twenty Five B Limited (AGE25BL)', ps:'Ramgarh-II', pt:'SOLAR', src:'SOLAR', total:500, contd4:500, applied:137.5, exp:362.5,
    ftc:[[137.5,'2026-03-23']], toc:[[137.5,'2026-03-28']], cod:[[137.5,'2026-03-30']] },
  { n:'Teq Green POWER XVIII Private Limited', ps:'Fatehgarh-III', pt:'SOLAR', src:'SOLAR', total:50, contd4:50, applied:0, exp:50, other:'FTC yet to apply for FTC',
    ftc:[], toc:[], cod:[] },
  { n:'Renew Solar Shakti Five Private Limited', ps:'Fatehgarh-III', pt:'SOLAR', src:'SOLAR', total:400, contd4:400, applied:400, exp:0,
    ftc:[[200,'2026-03-25'],[200,'2026-03-28']], toc:[[211,'2026-05-06']], cod:[[211,'2026-05-09']] },
  { n:'AMPIN ENERGY GREEN TEN PRIVATE LIMITED(AEG10PL)', ps:'Fatehgarh-IV', pt:'HYBRID_WS', total:155, contd4:120, exp:0,
    components:[
      { src:'SOLAR', total:114.4, contd4:120, applied:114.4, exp:0,
        ftc:[[114.4,'2026-02-12']], toc:[[114.4,'2026-03-27']], cod:[[114.4,'2026-04-04']] },
      { src:'WIND', total:40.6, contd4:0, applied:40.4, exp:0,
        ftc:[[40.4,'2026-02-12']], toc:[[40.4,'2026-03-31']], cod:[[40.4,'2026-04-04']] },
    ] },
  { n:'HRP Green POWER Private Limited', ps:'Bhadla-III', pt:'SOLAR', src:'SOLAR', total:300, contd4:296, applied:296, exp:0,
    ftc:[[296,'2026-04-01']], toc:[[148,'2026-04-13'],[96.2,'2026-04-16'],[51.8,'2026-05-06']], cod:[[148,'2026-04-15'],[96.2,'2026-04-18'],[51.8,'2026-05-08']] },
  // Row 22 Aditya Birla (608 MW, "not applied") intentionally EXCLUDED — applied=0,
  // and the sheet's NR Hybrid installed (870 = Juniper 715 + AMPIN 155) confirms exclusion.
  { n:'Serentica Renewables India 9 Private Limited (SRI9PL)', ps:'Fatehgarh-III', pt:'SOLAR', src:'SOLAR', total:600, contd4:600, applied:446.801, exp:0,
    ftc:[[280.841,'2026-04-29'],[165.96,'2026-05-21']], toc:[[153.19,'2026-05-15'],[127.651,'2026-05-20']], cod:[[153.19,'2026-05-15'],[127.651,'2026-05-20']] },
  { n:'SERENTICA RENEWABLES INDIA 8 PRIVATE LIMITED (SRI8PL)', ps:'Fatehgarh-III', pt:'SOLAR', src:'SOLAR', total:200, contd4:200, applied:200, exp:0,
    ftc:[[200,'2026-05-27']], toc:[], cod:[] },
];

// ── NR CONTD-4 study projects (not yet FTC; PENDING/RECEIVED) ─────────────────
// jun26 = capacity expected to complete in Jun'26 → Contd4Phase @ 2026-06.
const CONTD4 = [
  { n:'TP SAURYA LIMITED', ps:'Bikaner-III', pt:'HYBRID_SB', total:300, jun26:100, app:'2026-01-23', remarks:'Under Process (Final Grant yet to be approved by CTUIL for BESS)' },
  { n:'SOLTOWN INFRA PRIVATE LIMITED', ps:'Bikaner-II', pt:'SOLAR', total:325, jun26:125, app:'2025-08-05', remarks:'Reply received 14.05.2026, under review at CTUIL & NRLDC' },
  { n:'Serentica Renewables India Private Ltd (BESS)', ps:'Bikaner-II', pt:'BESS', total:50, jun26:50, app:'2026-03-12', remarks:'Reply pending at plant end' },
  { n:'Serentica Renewables India Private Ltd (Solar)', ps:'Bikaner-II', pt:'SOLAR', total:141, jun26:0, app:'2026-03-24', remarks:'Final Grant given for 281 MW (Solar+BESS)' },
  { n:'Serentica Renewables India Private Ltd (BESS-2)', ps:'Bikaner-II', pt:'BESS', total:140, jun26:0, app:'2026-03-24', remarks:'Final Grant given for 281 MW (Solar+BESS)' },
  { n:'Hazel Hybren Private Ltd', ps:'Bikaner-IV', pt:'SOLAR', total:300, jun26:0, app:null, remarks:'Under Process (application date 31-09-2025 invalid in sheet)' },
  { n:'Litsolaire Energy Private Ltd', ps:'Bikaner-II', pt:'SOLAR', total:100, jun26:0, app:'2026-01-20', remarks:'Under Process' },
  { n:'Furies Solren Private Ltd', ps:'Bikaner-IV', pt:'SOLAR', total:300, jun26:0, app:'2025-12-30', remarks:'Reply pending at plant end' },
  { n:'ACME Cleantech Solutions Private Limited.', ps:'Bikaner-III', pt:'SOLAR', total:300, jun26:0, app:null, remarks:'Under Process' },
  { n:'ALF Solar Amarsar', ps:'Bikaner-II', pt:'SOLAR', total:600, jun26:0, app:null, remarks:'Under Process' },
];

// Sheet's NR summary (line 64) — comparison target [installed, contd4, applied, ftc, ftcPend, toc, tocPend, cod, codPend, expected]
const SHEET_NR = {
  WIND:   [0,0,0,0,0,0,0,0,0,0],
  SOLAR:  [4860,4855,3791,3791,0,2597,0,2862,0,605],
  BESS:   [850,835,822,822,0,764,0,764,0,71],
  HYBRID: [870,585,670,670,0,520,0,520,0,0],
  COAL:   [0,0,0,0,0,0,0,0,0,0],
  HYDRO:  [0,0,0,0,0,0,0,0,0,0],
  PSP:    [1000,1000,1000,1000,0,1000,0,1000,0,0],
};

async function main() {
  const region = await prisma.gridRegion.findFirst({ where: { code: 'NR' } });
  const admin  = await prisma.user.findFirst({ where: { role: 'ADMIN' } }) || await prisma.user.findFirst();
  const plantTypes = await prisma.plantType.findMany();
  const ptByCode = Object.fromEntries(plantTypes.map(t => [t.code, t.id]));
  const ptLabel  = Object.fromEntries(plantTypes.map(t => [t.code, t.label]));
  if (!region || !admin) throw new Error('NR region or admin user missing');

  // ── Delete TRANSACTIONAL data (keep master: regions, plantTypes, stations, users) ──
  console.log('Deleting transactional grid data…');
  await prisma.$transaction([
    prisma.ftcEvent.deleteMany(),
    prisma.tocEvent.deleteMany(),
    prisma.codEvent.deleteMany(),
    prisma.transmissionAuditLog.deleteMany(),
    prisma.projectNote.deleteMany(),
    prisma.commissioningPhase.deleteMany(),
    prisma.contd4Phase.deleteMany(),
    prisma.contd4Application.deleteMany(),
    prisma.generationProject.deleteMany(),
    prisma.transmissionElement.deleteMany(),
  ]);
  await prisma.gridSnapshot.deleteMany().catch(() => {});
  await prisma.notification.deleteMany().catch(() => {});

  const psCache = {};
  async function poolingStation(name) {
    if (!name) return null;
    if (psCache[name]) return psCache[name];
    let ps = await prisma.poolingStation.findFirst({ where: { name, regionId: region.id } });
    if (!ps) ps = await prisma.poolingStation.create({ data: { name, regionId: region.id } });
    psCache[name] = ps.id;
    return ps.id;
  }

  const r3 = (v) => Math.max(0, Math.round(v * 1000) / 1000);

  // ── Seed FTC pipeline projects ──
  // Hybrid projects carry a `components` array → one CommissioningPhase per
  // source component (Solar / Wind / BESS), each with its own milestone events,
  // plus a hybridComponentsJson for the breakdown card. Non-hybrid projects
  // collapse to a single component.
  let ftcCount = 0;
  for (const p of FTC) {
    const comps = p.components || [{ src: p.src, total: p.total, contd4: p.contd4, applied: p.applied, exp: p.exp, ftc: p.ftc, toc: p.toc, cod: p.cod }];
    const psId = await poolingStation(p.ps);

    const hybridJson = p.components ? {
      hybridType: ptLabel[p.pt],
      components: comps.map(c => {
        const f = sum(c.ftc), t = sum(c.toc), d = sum(c.cod);
        return { sourceType: c.src, totalMw: c.total, contd4Mw: c.contd4 ?? 0, appliedMw: c.applied,
          ftcMw: f, ftcDate: lastDate(c.ftc), tocMw: t, tocDate: lastDate(c.toc),
          codMw: d, codDate: lastDate(c.cod), expectedMw: c.exp ?? 0 };
      }),
    } : null;

    const proj = await prisma.generationProject.create({
      data: {
        name: p.n, regionId: region.id, plantTypeId: ptByCode[p.pt], poolingStationId: psId,
        totalCapacityMw: p.total, inFtcPipeline: true, createdById: admin.id,
        hybridComponentsJson: hybridJson,
        contd4: { create: { status: 'CLEARED', capacityApr26Mw: p.contd4, applicationDate: null } },
      },
    });

    for (const c of comps) {
      const ftcMw = sum(c.ftc), tocMw = sum(c.toc), codMw = sum(c.cod);
      const phase = await prisma.commissioningPhase.create({
        data: {
          projectId: proj.id, sourceType: c.src, capacityAppliedMw: c.applied,
          ftcCompletedMw: ftcMw, ftcCompletedDate: D(lastDate(c.ftc)),
          tocIssuedMw: tocMw,    tocIssuedDate:    D(lastDate(c.toc)),
          codDeclaredMw: codMw,  codDeclaredDate:  D(lastDate(c.cod)),
          capacityUnderFtcMw: r3(c.applied - ftcMw),
          capacityUnderTocMw: r3(ftcMw - tocMw),
          capacityPendingCodMw: r3(tocMw - codMw),
          expectedApr26Mw: c.exp ?? 0, expectedMonth: '2026-06',
          delayRemarks: p.issues ?? null, otherRemarks: p.other ?? null,
        },
      });
      for (const [mw, dd] of c.ftc) await prisma.ftcEvent.create({ data: { phaseId: phase.id, capacityMw: mw, eventDate: D(dd) } });
      for (const [mw, dd] of c.toc) await prisma.tocEvent.create({ data: { phaseId: phase.id, capacityMw: mw, eventDate: D(dd) } });
      for (const [mw, dd] of c.cod) await prisma.codEvent.create({ data: { phaseId: phase.id, capacityMw: mw, eventDate: D(dd) } });
    }
    ftcCount++;
  }
  console.log(`  ✓ FTC pipeline projects: ${ftcCount}`);

  // ── Seed CONTD-4 study projects ──
  let c4Count = 0;
  for (const p of CONTD4) {
    const psId = await poolingStation(p.ps);
    await prisma.generationProject.create({
      data: {
        name: p.n, regionId: region.id, plantTypeId: ptByCode[p.pt], poolingStationId: psId,
        totalCapacityMw: p.total, inFtcPipeline: false, createdById: admin.id,
        contd4: {
          create: {
            status: 'RECEIVED', capacityApr26Mw: p.jun26, capacityMonth: '2026-06',
            applicationDate: D(p.app), remarks: p.remarks,
            phases: p.jun26 > 0 ? { create: { declaredDate: D(p.app) || D('2026-06-01'), capacityMw: p.jun26, capacityMonth: '2026-06' } } : undefined,
          },
        },
      },
    });
    c4Count++;
  }
  console.log(`  ✓ CONTD-4 study projects: ${c4Count}`);

  // ── Compute NR pipeline matrix as-of 30-Jun-2026 and compare ──
  const projects = await prisma.generationProject.findMany({
    where: { regionId: region.id },
    include: { region: true, plantType: true, contd4: true, phases: { include: { ftcEvents: true, tocEvents: true, codEvents: true } } },
  });
  const asOf = new Date('2026-06-30T23:59:59.999Z');
  const matrix = computePipelineMatrix(projects, asOf);
  const fields = ['totalCapacityMw','contd4CapacityMw','appliedMw','ftcApprovedMw','ftcPendingMw','tocIssuedMw','tocPendingMw','codCompletedMw','codPendingMw','expectedMw'];
  const labels = ['Installed','CONTD4','Applied','FTC','FTC-Pend','TOC','TOC-Pend','COD','COD-Pend','Expected'];
  const r = (v) => Math.round(v * 100) / 100;

  console.log('\n================ NR PIPELINE: OURS (as-of 30-Jun-26) vs SHEET ================');
  for (const src of ['WIND','SOLAR','BESS','HYBRID','COAL','HYDRO','PSP']) {
    const row = matrix[`NR|${src}`] || {};
    const sheet = SHEET_NR[src];
    const ours = fields.map(f => r(row[f] || 0));
    const diffs = ours.map((o, i) => r(o - sheet[i]));
    const hasDiff = diffs.some(d => Math.abs(d) > 0.5);
    console.log(`\n${src}${hasDiff ? '  *** MISMATCH ***' : '  (match)'}`);
    labels.forEach((lab, i) => {
      const mark = Math.abs(diffs[i]) > 0.5 ? '  <-- diff ' + diffs[i] : '';
      if (ours[i] !== 0 || sheet[i] !== 0)
        console.log(`   ${lab.padEnd(9)} ours=${String(ours[i]).padStart(9)}  sheet=${String(sheet[i]).padStart(9)}${mark}`);
    });
  }

  const counts = { projects: await prisma.generationProject.count(), phases: await prisma.commissioningPhase.count(),
    ftcEv: await prisma.ftcEvent.count(), tocEv: await prisma.tocEvent.count(), codEv: await prisma.codEvent.count() };
  console.log('\nCounts:', counts);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
