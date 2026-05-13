/**
 * Demo seed — creates realistic test data across ALL regions, source types,
 * and pipeline stages so the Summary page has something to display.
 *
 * Safe to re-run: skips projects/elements that already exist.
 *
 * What it creates (mirroring the real Excel structure):
 *
 *  NR  — 8 generation projects (Solar, BESS, PSP, Hybrid Solar+BESS, Coal)
 *       — 3 cleared with full FTC→TOC→COD phases
 *       — 5 in CONTD-4 (PENDING/RECEIVED)
 *       — 4 transmission elements
 *
 *  WR  — 9 generation projects (Wind, Solar, BESS, Hybrid Wind+Solar)
 *       — 4 cleared with partial/full pipeline
 *       — 5 in CONTD-4
 *       — 5 transmission elements
 *
 *  SR  — 6 generation projects (Solar, Wind, Hybrid Wind+Solar)
 *       — 2 cleared with phases
 *       — 4 in CONTD-4
 *       — 3 transmission elements
 *
 *  ER  — 3 generation projects (Coal)
 *       — 2 cleared with partial COD
 *       — 2 transmission elements
 *
 *  NER — 2 generation projects (Hydro)
 *       — 1 cleared with phases
 *       — 2 transmission elements
 */

const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

// ── helpers ───────────────────────────────────────────────────────────────────

const d = (s) => new Date(s);

async function findOrSkip(check, create) {
  if (await check()) return null;
  return create();
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  // ── master data ────────────────────────────────────────────────────────────
  const regions  = await p.gridRegion.findMany();
  const rgn      = Object.fromEntries(regions.map(r => [r.code, r.id]));

  const plantTypes = await p.plantType.findMany();
  const pt         = Object.fromEntries(plantTypes.map(t => [t.code, t.id]));

  const users = await p.user.findMany();
  const admin = users.find(u => u.role === 'ADMIN') ?? users[0];
  if (!admin) throw new Error('Run the main seed.js first to create users.');
  if (!rgn.NR) throw new Error('Run the main seed.js first to create regions.');

  console.log(`Admin user: ${admin.email}`);

  // ── pooling stations ────────────────────────────────────────────────────────
  const pools = {};

  async function getOrMakePool(name, regionCode, voltageKv = 400) {
    const regionId = rgn[regionCode];
    let ps = await p.poolingStation.findFirst({ where: { name, regionId } });
    if (!ps) ps = await p.poolingStation.create({ data: { name, regionId, voltageKv } });
    return pools[`${regionCode}:${name}`] = ps.id;
  }

  // NR pools
  const NR_FATEHGARH  = await getOrMakePool('Fatehgarh-III',  'NR');
  const NR_BIKANER    = await getOrMakePool('Bikaner-II',      'NR');
  const NR_RAMGARH    = await getOrMakePool('Ramgarh-II',      'NR');
  const NR_PANIPAT    = await getOrMakePool('Panipat PS',      'NR');
  const NR_GHATAMPUR  = await getOrMakePool('Ghatampur PS',    'NR');
  // WR pools
  const WR_JAMKH      = await getOrMakePool('Jamkhambaliya PS','WR');
  const WR_BHUJ       = await getOrMakePool('Bhuj PS',         'WR');
  const WR_KALLAM     = await getOrMakePool('Kallam PS',       'WR');
  const WR_RAJGARH    = await getOrMakePool('Rajgarh PS',      'WR');
  const WR_KHAVDA     = await getOrMakePool('Khavda-1 PS',     'WR', 765);
  // SR pools
  const SR_HIRIYUR    = await getOrMakePool('400/220kV Hiriyur PS',  'SR');
  const SR_KURNOOL    = await getOrMakePool('765/400kV Kurnool-III', 'SR', 765);
  const SR_KOPPAL     = await getOrMakePool('765/400kV Koppal-II',   'SR', 765);
  // ER pools
  const ER_BARH       = await getOrMakePool('Barh PS',         'ER');
  // NER pools
  const NER_SILCHAR   = await getOrMakePool('Silchar PS',      'NER', 220);

  // ── CREATE PROJECT helper ──────────────────────────────────────────────────

  async function makeProject({
    name, regionCode, plantCode, capacityMw,
    windMw, solarMw, bessMw, poolingId,
    contd4, phases = [],
  }) {
    const existing = await p.generationProject.findFirst({
      where: { name, regionId: rgn[regionCode] },
    });
    if (existing) {
      console.log(`  SKIP (exists): ${name}`);
      return existing;
    }

    const proj = await p.generationProject.create({
      data: {
        name, regionId: rgn[regionCode],
        plantTypeId: pt[plantCode],
        poolingStationId: poolingId ?? null,
        totalCapacityMw: capacityMw,
        windCapacityMw:  windMw  ?? null,
        solarCapacityMw: solarMw ?? null,
        bessCapacityMw:  bessMw  ?? null,
        createdById: admin.id,
        ...(contd4 ? {
          contd4: { create: {
            applicationDate: contd4.appDate,
            proposedFtcDate: contd4.proposedFtc ?? null,
            capacityApr26Mw: contd4.capMonth ?? null,
            capacityMonth:   contd4.month ?? null,
            status:          contd4.status ?? 'PENDING',
            remarks:         contd4.remarks ?? null,
          }},
        } : {}),
      },
    });

    if (phases.length) {
      await p.commissioningPhase.createMany({
        data: phases.map(ph => ({
          projectId: proj.id,
          sourceType:          ph.src,
          capacityAppliedMw:   ph.applied,
          ftcCompletedMw:      ph.ftc      ?? null,
          ftcCompletedDate:    ph.ftcDate  ?? null,
          proposedFtcDate:     ph.proposed ?? null,
          capacityUnderFtcMw:  ph.underFtc ?? null,
          tocIssuedMw:         ph.toc      ?? null,
          tocIssuedDate:       ph.tocDate  ?? null,
          capacityUnderTocMw:  ph.underToc ?? null,
          codDeclaredMw:       ph.cod      ?? null,
          codDeclaredDate:     ph.codDate  ?? null,
          expectedApr26Mw:     ph.expected ?? null,
          delayRemarks:        ph.delay    ?? null,
        })),
      });
    }

    console.log(`  + ${name} [${regionCode}] — ${phases.length} phases`);
    return proj;
  }

  // ── TRANSMISSION helper ────────────────────────────────────────────────────

  async function makeTx({ name, regionCode, type, isRe, voltKv, capMva, lenKm,
    firstEnergy, pendingFtc, proposedFtc, capApr26, lenApr26, remarks }) {
    const exists = await p.transmissionElement.findFirst({
      where: { elementName: name, regionId: rgn[regionCode] },
    });
    if (exists) { console.log(`  SKIP TX (exists): ${name}`); return; }

    await p.transmissionElement.create({
      data: {
        regionId:          rgn[regionCode],
        agencyOwner:       'POWERGRID',
        elementName:       name,
        elementType:       type,
        isRe:              isRe ?? false,
        voltageRatingKv:   voltKv,
        capacityMva:       capMva   ?? null,
        lineLengthKm:      lenKm    ?? null,
        firstEnergyDate:   firstEnergy ?? null,
        pendingFtc:        pendingFtc ?? false,
        proposedFtcDate:   proposedFtc ?? null,
        capacityApr26Mva:  capApr26 ?? null,
        lineLengthApr26Km: lenApr26 ?? null,
        remarks:           remarks  ?? null,
      },
    });
    console.log(`  + TX: ${name} [${regionCode}]`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NR — NORTHERN REGION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── NR Generation Projects ──');

  // 1. IB VOGT Solar 300 MW — CLEARED — full COD ✓
  await makeProject({
    name: 'IB VOGT Solar Seven Pvt Ltd', regionCode: 'NR',
    plantCode: 'SOLAR', capacityMw: 300, poolingId: NR_FATEHGARH,
    contd4: { appDate: d('2024-06-01'), proposedFtc: d('2026-03-01'),
      capMonth: 300, month: '2026-03', status: 'CLEARED',
      remarks: 'FTC issued. COD declared.' },
    phases: [{ src: 'SOLAR', applied: 300, ftc: 300, ftcDate: d('2026-03-13'),
      toc: 200, tocDate: d('2026-03-27'), cod: 200, codDate: d('2026-03-30'),
      underFtc: 0, underToc: 0, expected: 100 }],
  });

  // 2. ReNew Samir Solar 300 MW — CLEARED — full COD ✓
  await makeProject({
    name: 'ReNew Samir Shakti Three Pvt Ltd', regionCode: 'NR',
    plantCode: 'SOLAR', capacityMw: 300, poolingId: NR_FATEHGARH,
    contd4: { appDate: d('2024-09-01'), proposedFtc: d('2026-02-01'),
      capMonth: 300, month: '2026-02', status: 'CLEARED',
      remarks: 'FTC and TOC completed. Full COD declared.' },
    phases: [{ src: 'SOLAR', applied: 300, ftc: 300, ftcDate: d('2026-02-13'),
      toc: 300, tocDate: d('2026-03-17'), cod: 300, codDate: d('2026-03-26'),
      underFtc: 0, underToc: 0, expected: 0 }],
  });

  // 3. Adani Barmer Solar 600 MW — CLEARED — partial COD
  await makeProject({
    name: 'Adani Solar Energy Barmer One Ltd', regionCode: 'NR',
    plantCode: 'SOLAR', capacityMw: 600, poolingId: NR_FATEHGARH,
    contd4: { appDate: d('2024-07-15'), proposedFtc: d('2026-03-01'),
      capMonth: 251, month: '2026-03', status: 'CLEARED',
      remarks: 'FTC issued for 251MW. TOC and COD declared.' },
    phases: [{ src: 'SOLAR', applied: 251, ftc: 251, ftcDate: d('2026-03-15'),
      toc: 251, tocDate: d('2026-03-23'), cod: 251, codDate: d('2026-03-25'),
      underFtc: 0, underToc: 0, expected: 0 }],
  });

  // 4. ACME SunPower BESS 300 MW — CLEARED — partial pipeline
  await makeProject({
    name: 'ACME SunPower Private Limited', regionCode: 'NR',
    plantCode: 'BESS', capacityMw: 300, poolingId: NR_BIKANER,
    contd4: { appDate: d('2025-01-10'), proposedFtc: d('2026-04-01'),
      capMonth: 100, month: '2026-04', status: 'CLEARED',
      remarks: 'FTC/TOC/COD issued in tranches. Balance under process.' },
    phases: [
      { src: 'BESS', applied: 100, ftc: 100, ftcDate: d('2026-02-26'),
        toc: 100, tocDate: d('2026-03-06'), cod: 100, codDate: d('2026-03-08'),
        underFtc: 0, underToc: 0, expected: 0 },
      { src: 'BESS', applied: 100, ftc: 100, ftcDate: d('2026-03-15'),
        toc: 100, tocDate: d('2026-03-22'), cod: 100, codDate: d('2026-04-10'),
        underFtc: 0, underToc: 0, expected: 0 },
      { src: 'BESS', applied: 100, ftc: 0, proposed: d('2026-06-01'),
        underFtc: 100, expected: 100, delay: 'PSCAD models not complied for this tranche' },
    ],
  });

  // 5. Tehri PSP 1000 MW — CLEARED — FTC done, TOC/COD in progress
  await makeProject({
    name: 'Tehri PSP', regionCode: 'NR',
    plantCode: 'PSP', capacityMw: 1000, poolingId: NR_PANIPAT,
    contd4: { appDate: d('2025-06-01'), proposedFtc: d('2026-06-01'),
      capMonth: 0, month: '2026-06', status: 'CLEARED',
      remarks: 'FTC completed. TOC and COD declaration in progress.' },
    phases: [{ src: 'PSP', applied: 1000, ftc: 1000, ftcDate: d('2026-03-06'),
      toc: 1000, tocDate: d('2026-04-10'), cod: 1000, codDate: d('2026-04-12'),
      underFtc: 0, underToc: 0, expected: 0 }],
  });

  // 6. Ghatampur TPS 660 MW — CLEARED — FTC done, TOC pending
  await makeProject({
    name: 'Ghatampur TPS Unit-3', regionCode: 'NR',
    plantCode: 'COAL', capacityMw: 660, poolingId: NR_GHATAMPUR,
    contd4: { appDate: d('2025-03-01'), proposedFtc: d('2026-03-01'),
      capMonth: 660, month: '2026-03', status: 'CLEARED',
      remarks: 'FTC completed. TOC pending.' },
    phases: [{ src: 'COAL', applied: 660, ftc: 660, ftcDate: d('2026-03-30'),
      underFtc: 0, underToc: 660, expected: 660,
      delay: 'TOC grant awaited after FTC compliance verification' }],
  });

  // 7. Clean Max Celestial Solar 250 MW — CONTD-4 PENDING
  await makeProject({
    name: 'Clean Max Celestial Pvt Ltd', regionCode: 'NR',
    plantCode: 'SOLAR', capacityMw: 250, poolingId: NR_BIKANER,
    contd4: { appDate: d('2025-07-20'), proposedFtc: d('2026-05-01'),
      capMonth: 250, month: '2026-05', status: 'RECEIVED',
      remarks: 'Review of study completed. Under finalization.' },
  });

  // 8. Hybrid Solar+BESS (TP Saurya) 300 MW — CONTD-4 PENDING
  await makeProject({
    name: 'TP Saurya Limited', regionCode: 'NR',
    plantCode: 'HYBRID_SB', capacityMw: 300,
    solarMw: 160, bessMw: 140, poolingId: NR_BIKANER,
    contd4: { appDate: d('2026-01-23'), proposedFtc: d('2026-04-01'),
      capMonth: 100, month: '2026-04', status: 'PENDING',
      remarks: 'Under process. Final grant yet to be approved.' },
  });

  // ── NR Transmission ────────────────────────────────────────────────────────
  console.log('\n── NR Transmission Elements ──');
  await makeTx({ name: '765kV Fatehgarh-III–Beawar Ckt-1', regionCode: 'NR',
    type: 'LINE', isRe: true, voltKv: 765, lenKm: 317.34,
    firstEnergy: d('2026-03-26'), pendingFtc: false, remarks: 'FTC issued 23.03.2026' });
  await makeTx({ name: '400kV Bikaner-II–Bikaner-III Ckt-3', regionCode: 'NR',
    type: 'LINE', isRe: true, voltKv: 400, lenKm: 39.55,
    firstEnergy: d('2026-03-26'), pendingFtc: false });
  await makeTx({ name: '1500 MVA ICT-1 at Beawar SS', regionCode: 'NR',
    type: 'ICT', isRe: true, voltKv: 765, capMva: 1500,
    firstEnergy: d('2026-04-01'), pendingFtc: false, remarks: 'FTC issued 23.03.2026' });
  await makeTx({ name: '500 MVA ICT-1 at 400kV Garautha (UPPTCL)', regionCode: 'NR',
    type: 'ICT', isRe: false, voltKv: 400, capMva: 500,
    firstEnergy: d('2026-03-18'), pendingFtc: true,
    proposedFtc: d('2026-06-01'), capApr26: 500,
    remarks: 'FTC pending — state utility coordination' });

  // ═══════════════════════════════════════════════════════════════════════════
  // WR — WESTERN REGION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── WR Generation Projects ──');

  // 1. ASEJ Wind 62.4 MW — CLEARED — full COD ✓
  await makeProject({
    name: 'ASEJ6PL Khavda PSS8', regionCode: 'WR',
    plantCode: 'WIND', capacityMw: 62.4, poolingId: WR_KHAVDA,
    contd4: { appDate: d('2025-02-01'), proposedFtc: d('2026-03-01'),
      capMonth: 62.4, month: '2026-03', status: 'CLEARED' },
    phases: [{ src: 'WIND', applied: 62.4, ftc: 62.4, ftcDate: d('2026-03-06'),
      toc: 62.4, tocDate: d('2026-03-28'), cod: 62.4, codDate: d('2026-04-02'),
      underFtc: 0, underToc: 0, expected: 0 }],
  });

  // 2. Sprng Akshay Urja Wind 163.2 MW — CLEARED — full COD ✓
  await makeProject({
    name: 'Sprng Akshay Urja Pvt Ltd', regionCode: 'WR',
    plantCode: 'WIND', capacityMw: 163.2, poolingId: WR_RAJGARH,
    contd4: { appDate: d('2024-11-01'), proposedFtc: d('2026-01-01'),
      capMonth: 162.7, month: '2026-01', status: 'CLEARED' },
    phases: [{ src: 'WIND', applied: 165, ftc: 165, ftcDate: d('2026-01-13'),
      toc: 165, tocDate: d('2026-04-08'), cod: 162.7, codDate: d('2026-04-10'),
      underFtc: 0, underToc: 0, expected: 0 }],
  });

  // 3. NTPC REL Wind 280 MW — CLEARED — partial FTC
  await makeProject({
    name: 'NTPC Renewable Energy Ltd - Jamjhodpur', regionCode: 'WR',
    plantCode: 'WIND', capacityMw: 280, poolingId: WR_JAMKH,
    contd4: { appDate: d('2025-10-29'), proposedFtc: d('2026-04-01'),
      capMonth: 50, month: '2026-04', status: 'CLEARED',
      remarks: 'Revised PSCAD models awaited. FTC partially completed.' },
    phases: [
      { src: 'WIND', applied: 116.55, ftc: 50.4, ftcDate: d('2026-04-20'),
        underFtc: 66.15, expected: 50, delay: 'Revised PSCAD models awaited from developer' },
    ],
  });

  // 4. GIPCL Solar 600 MW — CLEARED — FTC in progress
  await makeProject({
    name: 'Gujarat Industries Power Company Ltd', regionCode: 'WR',
    plantCode: 'SOLAR', capacityMw: 600, poolingId: WR_BHUJ,
    contd4: { appDate: d('2026-02-24'), proposedFtc: d('2026-04-01'),
      capMonth: 300, month: '2026-04', status: 'CLEARED',
      remarks: 'Revised PSCAD models awaited from developer.' },
    phases: [{ src: 'SOLAR', applied: 300, ftc: 0, underFtc: 300,
      proposed: d('2026-05-01'), expected: 300 }],
  });

  // 5. Serentica Wind+BESS — CLEARED — full COD ✓
  await makeProject({
    name: 'Serentica Renewables India 4 Pvt Ltd', regionCode: 'WR',
    plantCode: 'WIND', capacityMw: 350, poolingId: WR_KALLAM,
    contd4: { appDate: d('2024-09-01'), proposedFtc: d('2026-04-01'),
      capMonth: 59.4, month: '2026-04', status: 'CLEARED' },
    phases: [{ src: 'WIND', applied: 95.7, ftc: 95.7, ftcDate: d('2026-04-30'),
      toc: 59.4, tocDate: d('2026-05-06'), cod: 59.4, codDate: d('2026-05-08'),
      underFtc: 0, underToc: 0, expected: 0 }],
  });

  // 6. Adani Solar 1050 MW — CLEARED — no phases yet
  await makeProject({
    name: 'Adani Green Energy Ltd KPSS7', regionCode: 'WR',
    plantCode: 'SOLAR', capacityMw: 1050, poolingId: WR_KHAVDA,
    contd4: { appDate: d('2025-11-26'), proposedFtc: d('2026-06-30'),
      capMonth: 0, month: '2026-06', status: 'CLEARED',
      remarks: 'Revised PSCAD models awaited.' },
    phases: [{ src: 'SOLAR', applied: 300, ftc: 0, underFtc: 300,
      proposed: d('2026-06-30'), expected: 0 }],
  });

  // 7. Hybrid Wind+Solar (Mounting Renewable / Tebhada) — CONTD-4 PENDING
  await makeProject({
    name: 'Mounting Renewable Power Ltd (Tebhada)', regionCode: 'WR',
    plantCode: 'HYBRID_WS', capacityMw: 250,
    windMw: 161.7, solarMw: 88.3, poolingId: WR_JAMKH,
    contd4: { appDate: d('2025-09-17'), proposedFtc: d('2026-04-01'),
      capMonth: 100, month: '2026-04', status: 'PENDING',
      remarks: 'Compliance sheet signed for 100 MW. FTC application awaited.' },
  });

  // 8. VEH Jayin Renewables Hybrid — CONTD-4 PENDING
  await makeProject({
    name: 'VEH Jayin Renewables Pvt Ltd', regionCode: 'WR',
    plantCode: 'HYBRID_WS', capacityMw: 151.8,
    windMw: 100, solarMw: 51.8, poolingId: WR_RAJGARH,
    contd4: { appDate: d('2025-12-23'), proposedFtc: d('2026-04-01'),
      capMonth: 0, month: '2026-05', status: 'PENDING',
      remarks: 'Revised PSCAD models awaited.' },
  });

  // 9. WR BESS — CLEARED — full COD
  await makeProject({
    name: 'TPREL BESS Warora', regionCode: 'WR',
    plantCode: 'BESS', capacityMw: 400, poolingId: WR_KALLAM,
    contd4: { appDate: d('2025-04-01'), proposedFtc: d('2026-03-01'),
      capMonth: 400, month: '2026-03', status: 'CLEARED' },
    phases: [
      { src: 'BESS', applied: 200, ftc: 200, ftcDate: d('2026-03-10'),
        toc: 200, tocDate: d('2026-03-20'), cod: 200, codDate: d('2026-04-05'),
        underFtc: 0, underToc: 0, expected: 0 },
      { src: 'BESS', applied: 200, ftc: 200, ftcDate: d('2026-04-05'),
        toc: 100, tocDate: d('2026-04-20'), cod: 100, codDate: d('2026-05-01'),
        underFtc: 0, underToc: 100, expected: 100 },
    ],
  });

  // ── WR Transmission ────────────────────────────────────────────────────────
  console.log('\n── WR Transmission Elements ──');
  await makeTx({ name: '400kV Warora–Akola Line Ckt-1', regionCode: 'WR',
    type: 'LINE', isRe: false, voltKv: 400, lenKm: 136,
    firstEnergy: d('2026-01-15'), pendingFtc: false });
  await makeTx({ name: '400kV Bhuj–Jamkhambaliya D/C Line', regionCode: 'WR',
    type: 'LINE', isRe: true, voltKv: 400, lenKm: 167.95,
    pendingFtc: true, proposedFtc: d('2026-06-30'),
    lenApr26: 167.95, remarks: 'RoW issues pending' });
  await makeTx({ name: '315 MVA ICT at Warora SS', regionCode: 'WR',
    type: 'ICT', isRe: false, voltKv: 400, capMva: 315,
    firstEnergy: d('2026-02-01'), pendingFtc: false });
  await makeTx({ name: '500 MVA ICT-2 at Bhuj (WR)', regionCode: 'WR',
    type: 'ICT', isRe: false, voltKv: 400, capMva: 500,
    pendingFtc: true, proposedFtc: d('2026-05-15'),
    capApr26: 500, remarks: 'Erection pending' });
  await makeTx({ name: '1000 MVA ICT at Khavda', regionCode: 'WR',
    type: 'ICT', isRe: true, voltKv: 765, capMva: 1000,
    firstEnergy: d('2026-03-01'), pendingFtc: false });

  // ═══════════════════════════════════════════════════════════════════════════
  // SR — SOUTHERN REGION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── SR Generation Projects ──');

  // 1. Zenataris Hybrid Wind+Solar 200 MW — CLEARED — COD partial ✓
  await makeProject({
    name: 'Zenataris Hybrid Power', regionCode: 'SR',
    plantCode: 'HYBRID_WS', capacityMw: 200,
    windMw: 100, solarMw: 100, poolingId: SR_HIRIYUR,
    contd4: { appDate: d('2025-03-27'), proposedFtc: d('2026-03-01'),
      capMonth: 134, month: '2026-03', status: 'CLEARED',
      remarks: 'Models complied. CONTD-4 issued for 200 MW.' },
    phases: [
      { src: 'WIND', applied: 100, ftc: 100, ftcDate: d('2026-03-15'),
        toc: 100, tocDate: d('2026-04-01'), cod: 67, codDate: d('2026-04-05'),
        underFtc: 0, underToc: 0, expected: 33 },
      { src: 'SOLAR', applied: 100, ftc: 100, ftcDate: d('2026-03-20'),
        toc: 67, tocDate: d('2026-04-08'), cod: 67, codDate: d('2026-04-15'),
        underFtc: 0, underToc: 33, expected: 33 },
    ],
  });

  // 2. IRCON Solar 100 MW — CLEARED — FTC in progress
  await makeProject({
    name: 'IRCON International Solar', regionCode: 'SR',
    plantCode: 'SOLAR', capacityMw: 100, poolingId: SR_KURNOOL,
    contd4: { appDate: d('2023-08-17'), proposedFtc: d('2026-03-01'),
      capMonth: 100, month: '2026-03', status: 'CLEARED',
      remarks: 'Applied for connectivity enhancement. Models submitted.' },
    phases: [{ src: 'SOLAR', applied: 100, ftc: 0, underFtc: 100,
      proposed: d('2026-05-01'), expected: 100 }],
  });

  // 3. NHPC Solar 100 MW — CONTD-4 PENDING
  await makeProject({
    name: 'NHPC Solar NP Kunta', regionCode: 'SR',
    plantCode: 'SOLAR', capacityMw: 100, poolingId: SR_KURNOOL,
    contd4: { appDate: d('2025-02-21'), proposedFtc: d('2026-06-01'),
      capMonth: 0, month: '2026-06', status: 'PENDING',
      remarks: 'PSCAD dynamic model & PSSE not complied.' },
  });

  // 4. KSPDCL Solar 300 MW — CONTD-4 PENDING
  await makeProject({
    name: 'KSPDCL Solar Pavagada', regionCode: 'SR',
    plantCode: 'SOLAR', capacityMw: 300, poolingId: SR_HIRIYUR,
    contd4: { appDate: d('2025-08-09'), proposedFtc: d('2026-03-01'),
      capMonth: 0, month: '2026-04', status: 'RECEIVED',
      remarks: 'Revised models received on 20.03.2026. Model check in progress.' },
  });

  // 5. Jindal Green Wind 700 MW — CONTD-4 PENDING
  await makeProject({
    name: 'Jindal Green Wind 1 Pvt Ltd', regionCode: 'SR',
    plantCode: 'WIND', capacityMw: 700, poolingId: SR_KOPPAL,
    contd4: { appDate: d('2025-12-31'), proposedFtc: d('2026-03-01'),
      capMonth: 0, month: '2026-05', status: 'PENDING',
      remarks: 'PSCAD Harmonic, dynamic model & PSSE models not complied.' },
  });

  // 6. TPREL Solar Koppal 170 MW — CONTD-4 PENDING
  await makeProject({
    name: 'TPREL Solar Koppal-II', regionCode: 'SR',
    plantCode: 'SOLAR', capacityMw: 170, poolingId: SR_KOPPAL,
    contd4: { appDate: d('2025-09-09'), proposedFtc: d('2026-09-01'),
      capMonth: 0, month: '2026-09', status: 'PENDING',
      remarks: 'Compliance sheet sent to CTUIL.' },
  });

  // ── SR Transmission ────────────────────────────────────────────────────────
  console.log('\n── SR Transmission Elements ──');
  await makeTx({ name: '400kV Kurnool-III–Ananthapuram Line', regionCode: 'SR',
    type: 'LINE', isRe: true, voltKv: 400, lenKm: 210,
    firstEnergy: d('2026-02-10'), pendingFtc: false });
  await makeTx({ name: '500 MVA ICT at Koppal-II', regionCode: 'SR',
    type: 'ICT', isRe: true, voltKv: 400, capMva: 500,
    firstEnergy: d('2026-01-20'), pendingFtc: false });
  await makeTx({ name: '400kV Hiriyur–Tumkur D/C Line', regionCode: 'SR',
    type: 'LINE', isRe: false, voltKv: 400, lenKm: 125,
    pendingFtc: true, proposedFtc: d('2026-05-01'),
    lenApr26: 125, remarks: 'Forest clearance pending' });

  // ═══════════════════════════════════════════════════════════════════════════
  // ER — EASTERN REGION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── ER Generation Projects ──');

  // 1. PVUNL Coal 2×660 MW — CLEARED — partial COD
  await makeProject({
    name: 'PVUNL Unit-2 (Barh-II)', regionCode: 'ER',
    plantCode: 'COAL', capacityMw: 660, poolingId: ER_BARH,
    contd4: { appDate: d('2024-01-01'), proposedFtc: d('2026-01-01'),
      capMonth: 660, month: '2026-01', status: 'CLEARED',
      remarks: 'FTC/TOC issued. COD declared for Unit-2.' },
    phases: [{ src: 'COAL', applied: 660, ftc: 660, ftcDate: d('2026-01-15'),
      toc: 660, tocDate: d('2026-02-01'), cod: 660, codDate: d('2026-02-10'),
      underFtc: 0, underToc: 0, expected: 0 }],
  });

  // 2. Buxar Coal 660 MW — CLEARED — TOC in progress
  await makeProject({
    name: 'Buxar Thermal Power Unit-2', regionCode: 'ER',
    plantCode: 'COAL', capacityMw: 660, poolingId: ER_BARH,
    contd4: { appDate: d('2024-03-01'), proposedFtc: d('2026-02-01'),
      capMonth: 660, month: '2026-02', status: 'CLEARED',
      remarks: 'FTC issued. TOC in progress.' },
    phases: [{ src: 'COAL', applied: 660, ftc: 660, ftcDate: d('2026-02-20'),
      toc: 0, underToc: 660, underFtc: 0, expected: 660 }],
  });

  // 3. DVC Coal 660 MW — CONTD-4 RECEIVED
  await makeProject({
    name: 'DVC Raghunathpur Stage-II Unit-1', regionCode: 'ER',
    plantCode: 'COAL', capacityMw: 660, poolingId: ER_BARH,
    contd4: { appDate: d('2024-06-01'), proposedFtc: d('2026-06-01'),
      capMonth: 0, month: '2026-06', status: 'RECEIVED',
      remarks: 'PSCAD model under verification.' },
  });

  // ── ER Transmission ────────────────────────────────────────────────────────
  console.log('\n── ER Transmission Elements ──');
  await makeTx({ name: 'LILO of 220kV Dumka–Govindpur Circuit', regionCode: 'ER',
    type: 'LINE', isRe: false, voltKv: 220, lenKm: 20,
    pendingFtc: true, proposedFtc: d('2026-05-05'),
    lenApr26: 20, remarks: 'PTCC Clearance and Connectivity Agreement pending' });
  await makeTx({ name: '400kV Rearrangement at New Bongaigaon', regionCode: 'ER',
    type: 'LINE', isRe: false, voltKv: 400, lenKm: 5,
    firstEnergy: d('2026-03-01'), pendingFtc: false });

  // ═══════════════════════════════════════════════════════════════════════════
  // NER — NORTH-EASTERN REGION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── NER Generation Projects ──');

  // 1. Subansiri Lower Hydro 2000 MW — CLEARED — partial COD
  await makeProject({
    name: 'Subansiri Lower Hydro Electric Project', regionCode: 'NER',
    plantCode: 'HYDRO', capacityMw: 2000, poolingId: NER_SILCHAR,
    contd4: { appDate: d('2023-01-01'), proposedFtc: d('2025-12-01'),
      capMonth: 1000, month: '2026-02', status: 'CLEARED',
      remarks: 'Units 2 & 3 COD declared. Units 1, 4–8 in pipeline.' },
    phases: [
      { src: 'HYDRO', applied: 1000, ftc: 1000, ftcDate: d('2025-11-15'),
        toc: 1000, tocDate: d('2025-12-20'), cod: 1000, codDate: d('2025-12-23'),
        underFtc: 0, underToc: 0, expected: 250 },
      { src: 'HYDRO', applied: 1000, ftc: 0, underFtc: 1000,
        proposed: d('2026-09-01'), expected: 250 },
    ],
  });

  // 2. TSECL Solar — CONTD-4 PENDING
  await makeProject({
    name: 'TSECL Solar Project Agartala', regionCode: 'NER',
    plantCode: 'SOLAR', capacityMw: 50, poolingId: NER_SILCHAR,
    contd4: { appDate: d('2025-09-01'), proposedFtc: d('2026-06-01'),
      capMonth: 0, month: '2026-06', status: 'PENDING',
      remarks: 'Model check in progress.' },
  });

  // ── NER Transmission ────────────────────────────────────────────────────────
  console.log('\n── NER Transmission Elements ──');
  await makeTx({ name: '132kV SM Nagar ISTS–SM Nagar Line', regionCode: 'NER',
    type: 'LINE', isRe: false, voltKv: 132, lenKm: 10.33,
    pendingFtc: true, proposedFtc: d('2026-05-15'),
    lenApr26: 10.33, remarks: 'NERPC relay setting approval, Fresh Energization test' });
  await makeTx({ name: '220kV Sankardevnagar–Lower Kopili Line', regionCode: 'NER',
    type: 'LINE', isRe: false, voltKv: 220, lenKm: 46.6,
    pendingFtc: true, proposedFtc: d('2026-05-15'),
    lenApr26: 46.6, remarks: 'NERPC relay setting approval, Relay Coordination' });

  console.log('\n✅ Demo seed complete.');

  const counts = await Promise.all([
    p.generationProject.count(),
    p.commissioningPhase.count(),
    p.contd4Application.count(),
    p.transmissionElement.count(),
  ]);
  console.log(`\nDB totals → Projects: ${counts[0]} | Phases: ${counts[1]} | CONTD-4: ${counts[2]} | Tx: ${counts[3]}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
