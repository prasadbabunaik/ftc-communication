/**
 * Comprehensive seed matching "CONTD and FTC details 110526.pdf"
 * Clears all generation data and recreates from the official Excel snapshot.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── Region / PlantType IDs (from DB) ──────────────────────────────────────────
const R = {
  NR:  'cmogzdsem0008yeu5lypatweo',
  WR:  'cmogzdseo0009yeu5zmheo8dy',
  SR:  'cmogzdsei0007yeu5un5mm5p0',
  ER:  'cmogzdseq000ayeu576449e4l',
  NER: 'cmogzdses000byeu5pbv3ypdj',
};
const PT = {
  SOLAR:  'cmogzdseu000cyeu513dj90t4',
  WIND:   'cmogzdsf4000dyeu5x8vah7md',
  COAL:   'cmogzdsfa000gyeu55lusaouo',
  HYDRO:  'cmogzdsfc000hyeu50tjn0cz9',
  PSP:    'cmogzdsfh000iyeu5i5600y1p',
  BESS:   'cmogzdsfj000jyeu55ri1unt2',
  HWS:    'cmogzdsf7000eyeu55txggf6a',  // Wind+Solar
  HWSB:   'cmogzdsf9000fyeu5gwxo72yc',  // Wind+Solar+BESS
  HSB:    'cmol5vts70000yelpx1nddf81',   // Solar+BESS
};

// ── Pooling station IDs (from DB) ─────────────────────────────────────────────
const PS = {
  FATEHGARH3:  'cmp2eubre0001yem9ka4u07mi',
  BIKANER2:    'cmp2eubrj0003yem9l1zqin54',
  RAMGARH2:    'cmp2eubru0005yem9n25utt2d',
  PANIPAT:     'cmp2eubs00007yem9h5fthc4z',
  GHATAMPUR:   'cmp2eubs30009yem9erv0tfb2',
  KHAVDA1:     'cmp2eubsk000jyem96jtu9g2l',
  JAMKHAMB:    'cmp2eubs7000byem9yybhavdz',
  RAJGARH:     'cmp2eubsh000hyem909oy6glt',
  KALLAM:      'cmp2eubsd000fyem9r26om0jr',
  BHUJ:        'cmp2eubsa000dyem980yl4yrx',
  BHUJ2:       'cmoif5uoo0005ye7agaz2dnfe',
  BARH:        'cmp2eubsw000ryem9aa0ia7jc',
  GADAG:       'cmogzdsg90011yeu5x7ns6ifo',
  KURNOOL3:    'cmp2eubsq000nyem9u99pmao9',
  KOPPAL:      'cmp2eubst000pyem9yeac4igt',
  RAMAGUNDAM:  'cmogzdsg5000xyeu5k6lkofbd',
};

const d = (s) => new Date(s);

// ── Upsert a pooling station ──────────────────────────────────────────────────
async function pool(name, regionId) {
  const existing = await prisma.poolingStation.findFirst({ where: { name, regionId } });
  if (existing) return existing.id;
  const created = await prisma.poolingStation.create({ data: { name, regionId } });
  return created.id;
}

// ── Create one project + CONTD4 + phases ─────────────────────────────────────
async function makeProject({
  name, psId, regionId, plantTypeId, totalMw,
  windMw = null, solarMw = null, bessMw = null,
  contd4Mw, contd4Status = 'CLEARED', appDate = '2024-06-01', capacityMonth = null,
  phases = [],
}) {
  const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });

  // Delete existing to allow re-runs
  const existing = await prisma.generationProject.findFirst({ where: { name } });
  if (existing) {
    await prisma.commissioningPhase.deleteMany({ where: { projectId: existing.id } });
    await prisma.contd4Application.deleteMany({ where: { projectId: existing.id } });
    await prisma.generationProject.delete({ where: { id: existing.id } });
  }

  const proj = await prisma.generationProject.create({
    data: {
      name,
      regionId,
      plantTypeId,
      poolingStationId: psId,
      totalCapacityMw: totalMw,
      windCapacityMw:  windMw,
      solarCapacityMw: solarMw,
      bessCapacityMw:  bessMw,
      createdById: adminUser.id,
    },
  });

  await prisma.contd4Application.create({
    data: {
      projectId:       proj.id,
      applicationDate: d(appDate),
      capacityApr26Mw: contd4Mw,
      capacityMonth,
      status: contd4Status,
    },
  });

  for (const ph of phases) {
    await prisma.commissioningPhase.create({
      data: {
        projectId:           proj.id,
        sourceType:          ph.src,
        capacityAppliedMw:   ph.applied   ?? 0,
        ftcCompletedMw:      ph.ftc       ?? 0,
        ftcCompletedDate:    ph.ftcDate   ? d(ph.ftcDate) : null,
        capacityUnderFtcMw:  ph.underFtc  ?? 0,
        proposedFtcDate:     ph.propFtc   ? d(ph.propFtc) : null,
        tocIssuedMw:         ph.toc       ?? 0,
        tocIssuedDate:       ph.tocDate   ? d(ph.tocDate) : null,
        capacityUnderTocMw:  ph.underToc  ?? 0,
        codDeclaredMw:       ph.cod       ?? 0,
        codDeclaredDate:     ph.codDate   ? d(ph.codDate) : null,
        expectedApr26Mw:     ph.exp       ?? 0,
        delayRemarks:        ph.remarks   ?? null,
      },
    });
  }
  process.stdout.write(` + ${name}\n`);
}

// ── Transmission element ──────────────────────────────────────────────────────
async function makeTx({ name, regionId, type, isRe, voltKv, mvaMw = null, lenKm = null,
  pendingFtc = false, propFtc = null, mvaApr = null, lenApr = null, remarks = null,
  agency = 'PGCIL' }) {
  const existing = await prisma.transmissionElement.findFirst({ where: { elementName: name, regionId } });
  if (existing) await prisma.transmissionElement.delete({ where: { id: existing.id } });

  await prisma.transmissionElement.create({
    data: {
      elementName:      name,
      agencyOwner:      agency,
      regionId,
      elementType:      type,
      isRe,
      voltageRatingKv:  voltKv,
      capacityMva:      mvaMw,
      lineLengthKm:     lenKm,
      pendingFtc,
      proposedFtcDate:  propFtc ? d(propFtc) : null,
      capacityApr26Mva: mvaApr,
      lineLengthApr26Km: lenApr,
      remarks,
    },
  });
}

// ═════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('\n── NR Solar (16 projects) ──');
  // Pooling stations needed
  const fatehgarh3 = PS.FATEHGARH3;
  const bikaner2   = PS.BIKANER2;
  const ramgarh2   = PS.RAMGARH2;
  const bhadla2    = await pool('400kV Bhadla-II Pooling Station',  R.NR);
  const bhadla3    = await pool('400kV Bhadla-III Pooling Station', R.NR);
  const panipat    = PS.PANIPAT;

  await makeProject({ name: 'IB VOGT Solar Seven Pvt Ltd',         psId: fatehgarh3, regionId: R.NR, plantTypeId: PT.SOLAR, totalMw: 300,  contd4Mw: 300,  phases: [{ src:'SOLAR', applied:300, ftc:300, ftcDate:'2025-09-10', toc:200, tocDate:'2025-12-15', cod:200, codDate:'2026-01-20', exp:100 }] });
  await makeProject({ name: 'ReNew Samir Shakti Three Pvt Ltd',     psId: fatehgarh3, regionId: R.NR, plantTypeId: PT.SOLAR, totalMw: 300,  contd4Mw: 300,  phases: [{ src:'SOLAR', applied:300, ftc:300, ftcDate:'2025-08-20', toc:300, tocDate:'2025-11-10', cod:300, codDate:'2026-02-18', exp:0 }] });
  await makeProject({ name: 'ReNew Solar Shakti Three Pvt Ltd',     psId: fatehgarh3, regionId: R.NR, plantTypeId: PT.SOLAR, totalMw: 300,  contd4Mw: 300,  phases: [{ src:'SOLAR', applied:300, ftc:300, ftcDate:'2025-08-22', toc:300, tocDate:'2025-11-12', cod:300, codDate:'2026-02-20', exp:0 }] });
  await makeProject({ name: 'Adani Solar Energy Barmer One Ltd',    psId: fatehgarh3, regionId: R.NR, plantTypeId: PT.SOLAR, totalMw: 600,  contd4Mw: 600,  phases: [{ src:'SOLAR', applied:251, ftc:251, ftcDate:'2025-10-05', toc:251, tocDate:'2026-01-08', cod:251, codDate:'2026-01-10', exp:0 }] });
  await makeProject({ name: 'Khaba Renewable Energy Pvt Ltd',       psId: fatehgarh3, regionId: R.NR, plantTypeId: PT.SOLAR, totalMw: 250,  contd4Mw: 250,  phases: [{ src:'SOLAR', applied:221, ftc:221, ftcDate:'2025-11-01', toc:150, tocDate:'2026-02-10', cod:150, codDate:'2026-02-28', exp:71 }] });
  await makeProject({ name: 'Project Eleven Renewable Power Pvt Ltd', psId: bhadla2,  regionId: R.NR, plantTypeId: PT.SOLAR, totalMw: 150,  contd4Mw: 150,  phases: [{ src:'SOLAR', applied:100, ftc:100, ftcDate:'2025-12-15', toc:88,  tocDate:'2026-03-05', cod:88,  codDate:'2026-03-20', exp:63 }] });
  await makeProject({ name: 'Project 16 Renewable Power Pvt Ltd',   psId: bhadla2,  regionId: R.NR, plantTypeId: PT.SOLAR, totalMw: 300,  contd4Mw: 300,  phases: [{ src:'SOLAR', applied:200, ftc:200, ftcDate:'2025-12-10', toc:150, tocDate:'2026-03-01', cod:150, codDate:'2026-03-18', exp:50 }] });
  // CleanMax — FTC done, TOC under process (46139 = ~Apr'26 date in Excel, no capacity)
  await makeProject({ name: 'Clean Max Celestial Pvt Ltd',          psId: bikaner2,  regionId: R.NR, plantTypeId: PT.SOLAR, totalMw: 250,  contd4Mw: 250,  phases: [{ src:'SOLAR', applied:235, ftc:235, ftcDate:'2026-04-06', underToc:235, exp:0 }] });
  await makeProject({ name: 'Clean Max Enviro Energy Solutions Ltd', psId: bikaner2,  regionId: R.NR, plantTypeId: PT.SOLAR, totalMw: 100,  contd4Mw: 100,  phases: [{ src:'SOLAR', applied:94,  ftc:94,  ftcDate:'2026-04-06', underToc:94,  exp:0 }] });
  await makeProject({ name: 'Energizent Power Pvt Ltd',             psId: fatehgarh3, regionId: R.NR, plantTypeId: PT.SOLAR, totalMw: 250,  contd4Mw: 250,  phases: [{ src:'SOLAR', applied:130, ftc:130, ftcDate:'2025-12-20', toc:129, tocDate:'2026-03-15', cod:129, codDate:'2026-04-01', exp:61 }] });
  await makeProject({ name: 'BBMB Panipat Solar',                   psId: panipat,   regionId: R.NR, plantTypeId: PT.SOLAR, totalMw: 10,   contd4Mw: 9,    phases: [{ src:'SOLAR', applied:9,   ftc:9,   ftcDate:'2025-07-01', toc:9,   tocDate:'2025-09-01', cod:9, codDate:'2025-10-01', exp:0 }] });
  await makeProject({ name: 'Adani Green Energy Twenty Five B Ltd', psId: ramgarh2,  regionId: R.NR, plantTypeId: PT.SOLAR, totalMw: 500,  contd4Mw: 500,  phases: [{ src:'SOLAR', applied:138, ftc:138, ftcDate:'2026-01-10', toc:138, tocDate:'2026-03-20', cod:138, codDate:'2026-04-05', exp:363 }] });
  await makeProject({ name: 'Teq Green Power XVIII Pvt Ltd',        psId: fatehgarh3, regionId: R.NR, plantTypeId: PT.SOLAR, totalMw: 50,   contd4Mw: 50,   phases: [{ src:'SOLAR', applied:0,   ftc:0,   exp:50 }] });
  await makeProject({ name: 'ReNew Solar Shakti Five Pvt Ltd',      psId: fatehgarh3, regionId: R.NR, plantTypeId: PT.SOLAR, totalMw: 400,  contd4Mw: 400,  phases: [{ src:'SOLAR', applied:400, ftc:400, ftcDate:'2025-10-15', toc:211, tocDate:'2026-04-10', cod:211, codDate:'2026-04-15', exp:0 }] });
  // HRP: applied in stages (148+96.2+51.2 = 295.4 ≈ 296), Applied listed as 0 in formal column
  await makeProject({ name: 'HRP Green Power Pvt Ltd',              psId: bhadla3,   regionId: R.NR, plantTypeId: PT.SOLAR, totalMw: 300,  contd4Mw: 296,  phases: [{ src:'SOLAR', applied:0, ftc:296, ftcDate:'2026-05-06', toc:296, tocDate:'2026-05-06', cod:296, codDate:'2026-05-06', exp:0 }] });
  await makeProject({ name: 'Serentica Renewables India 9 Pvt Ltd', psId: fatehgarh3, regionId: R.NR, plantTypeId: PT.SOLAR, totalMw: 600,  contd4Mw: 600,  phases: [{ src:'SOLAR', applied:280.84, ftc:280.84, ftcDate:'2026-04-20', underToc:280.84, exp:0 }] });

  console.log('\n── NR BESS (3 projects) ──');
  await makeProject({ name: 'ACME SunPower Pvt Ltd',           psId: bhadla2,    regionId: R.NR, plantTypeId: PT.BESS, totalMw: 300, contd4Mw: 300, phases: [{ src:'BESS', applied:300, ftc:300, ftcDate:'2025-09-01', toc:200, tocDate:'2025-12-01', cod:200, codDate:'2026-02-15', exp:100 }] });
  await makeProject({ name: 'ACME Suryodaya Pvt Ltd',          psId: fatehgarh3, regionId: R.NR, plantTypeId: PT.BESS, totalMw: 300, contd4Mw: 285, phases: [{ src:'BESS', applied:285, ftc:285, ftcDate:'2025-10-10', toc:285, tocDate:'2026-01-20', cod:285, codDate:'2026-02-10', exp:0 }] });
  await makeProject({ name: 'ACME Surya Power Pvt Ltd',        psId: bikaner2,   regionId: R.NR, plantTypeId: PT.BESS, totalMw: 250, contd4Mw: 250, phases: [{ src:'BESS', applied:250, ftc:250, ftcDate:'2025-11-05', toc:175, tocDate:'2026-02-20', cod:175, codDate:'2026-03-10', exp:75 }] });

  console.log('\n── NR Hybrid (3 projects: 2 cleared, 1 CONTD-4 pending) ──');
  const fatehgarh4 = await pool('400kV Fatehgarh-IV Pooling Station', R.NR);
  // Juniper: 285MW Solar + 250MW Wind + 180MW BESS = 715MW total; CONTD4=365
  await makeProject({ name: 'Juniper Green Stellar Pvt Ltd', psId: fatehgarh4, regionId: R.NR, plantTypeId: PT.HWSB,
    totalMw: 715, solarMw: 285, windMw: 250, bessMw: 180, contd4Mw: 365,
    phases: [
      { src:'SOLAR', applied:146, ftc:146, ftcDate:'2025-11-01', toc:146, tocDate:'2026-02-01', cod:146, codDate:'2026-02-15', exp:75 },
      { src:'WIND',  applied:128, ftc:128, ftcDate:'2025-11-03', toc:128, tocDate:'2026-02-03', cod:128, codDate:'2026-02-17', exp:65 },
      { src:'BESS',  applied:91,  ftc:91,  ftcDate:'2025-11-05', toc:91,  tocDate:'2026-02-05', cod:91,  codDate:'2026-02-19', exp:47 },
    ] });
  // AMPIN: 114.4MW Solar + 40.95MW Wind = 155MW; CONTD4=120
  await makeProject({ name: 'AMPIN Energy Green Ten Pvt Ltd', psId: fatehgarh4, regionId: R.NR, plantTypeId: PT.HWS,
    totalMw: 155, solarMw: 114.4, windMw: 40.95, contd4Mw: 120,
    phases: [
      { src:'SOLAR', applied:100, ftc:100, ftcDate:'2025-10-15', toc:100, tocDate:'2026-01-20', cod:100, codDate:'2026-01-25', exp:0 },
      { src:'WIND',  applied:55,  ftc:55,  ftcDate:'2025-10-17', toc:55,  tocDate:'2026-01-22', cod:55,  codDate:'2026-01-27', exp:0 },
    ] });
  // Aditya Birla — CONTD-4 pending (not applied for FTC)
  await makeProject({ name: 'Aditya Birla Renewables Subsidiary Ltd (NR)', psId: fatehgarh3, regionId: R.NR, plantTypeId: PT.HWS,
    totalMw: 608, contd4Mw: 608, contd4Status: 'PENDING', appDate: '2025-01-10', capacityMonth: '2026-08',
    phases: [] });

  console.log('\n── NR Coal (1 project) ──');
  await makeProject({ name: 'Ghatampur TPS', psId: PS.GHATAMPUR, regionId: R.NR, plantTypeId: PT.COAL,
    totalMw: 660, contd4Mw: 660,
    phases: [{ src:'COAL', applied:660, ftc:660, ftcDate:'2025-06-01', underToc:660, exp:660 }] });

  console.log('\n── NR PSP (1 project) ──');
  const tehriPs = await pool('Tehri PSP Pooling Station', R.NR);
  await makeProject({ name: 'Tehri Pumped Storage Project', psId: tehriPs, regionId: R.NR, plantTypeId: PT.PSP,
    totalMw: 1000, contd4Mw: 1000,
    phases: [{ src:'PSP', applied:1000, ftc:1000, ftcDate:'2025-04-01', toc:1000, tocDate:'2025-07-01', cod:1000, codDate:'2026-01-15', exp:0 }] });

  // ── WR Wind (14 projects) ──────────────────────────────────────────────────
  console.log('\n── WR Wind (14 projects) ──');
  const pachora    = await pool('400kV Pachora Pooling Station',      R.WR);
  const solapur    = await pool('400kV PSS-1 Solapur Pooling Station', R.WR);
  const bhuj       = PS.BHUJ;
  const bhuj2      = PS.BHUJ2;

  await makeProject({ name: 'ASEJ6PL Khavda PSS8',                psId: PS.KHAVDA1, regionId: R.WR, plantTypeId: PT.WIND, totalMw: 62,  contd4Mw: 62,  phases: [{ src:'WIND', applied:62,  ftc:62,  ftcDate:'2025-06-10', toc:62,  tocDate:'2025-08-20', cod:62,  codDate:'2025-09-15', exp:0 }] });
  await makeProject({ name: 'AGE26AL SRPL Khavda PSS12',           psId: PS.KHAVDA1, regionId: R.WR, plantTypeId: PT.WIND, totalMw: 140, contd4Mw: 138, phases: [{ src:'WIND', applied:140, ftc:140, ftcDate:'2025-07-01', toc:140, tocDate:'2025-10-01', cod:138, codDate:'2025-11-01', exp:0 }] });
  await makeProject({ name: 'Renew Green MHS One Pvt Ltd',          psId: solapur,    regionId: R.WR, plantTypeId: PT.WIND, totalMw: 182, contd4Mw: 182, phases: [{ src:'WIND', applied:182, ftc:182, ftcDate:'2025-08-15', toc:162, tocDate:'2026-01-10', cod:162, codDate:'2026-02-01', exp:20 }] });
  await makeProject({ name: 'Veh Saurya Urja Pvt Ltd',             psId: pachora,    regionId: R.WR, plantTypeId: PT.WIND, totalMw: 163, contd4Mw: 82,  phases: [{ src:'WIND', applied:82,  ftc:82,  ftcDate:'2025-09-10', toc:69,  tocDate:'2025-12-20', cod:69,  codDate:'2026-01-05', exp:0 }] });
  await makeProject({ name: 'Juniper Green Energy Ltd',             psId: PS.JAMKHAMB, regionId: R.WR, plantTypeId: PT.WIND, totalMw: 300, contd4Mw: 100, phases: [{ src:'WIND', applied:0,   ftc:0,   exp:100 }] });
  await makeProject({ name: 'Sprng Akshay Urja Pvt Ltd',           psId: PS.RAJGARH,  regionId: R.WR, plantTypeId: PT.WIND, totalMw: 167, contd4Mw: 165, phases: [{ src:'WIND', applied:165, ftc:165, ftcDate:'2025-08-01', toc:165, tocDate:'2025-11-01', cod:163, codDate:'2025-12-01', exp:3 }] });
  await makeProject({ name: 'NTPC REL Vanki Bhuj',                 psId: bhuj,       regionId: R.WR, plantTypeId: PT.WIND, totalMw: 165, contd4Mw: 158, phases: [{ src:'WIND', applied:132, ftc:50,  ftcDate:'2025-12-01', underFtc:66, toc:50, tocDate:'2026-02-01', cod:50, codDate:'2026-02-15', exp:50 }] });
  await makeProject({ name: 'Serentica Renewables India 4 Pvt Ltd', psId: PS.KALLAM,  regionId: R.WR, plantTypeId: PT.WIND, totalMw: 350, contd4Mw: 250, phases: [{ src:'WIND', applied:96,  ftc:96,  ftcDate:'2025-10-20', toc:59,  tocDate:'2026-02-15', cod:59,  codDate:'2026-03-01', exp:36 }] });
  await makeProject({ name: 'AGE25CL Khavda PSS14',                psId: PS.KHAVDA1, regionId: R.WR, plantTypeId: PT.WIND, totalMw: 68,  contd4Mw: 65,  phases: [{ src:'WIND', applied:68,  ftc:68,  ftcDate:'2025-07-15', toc:68,  tocDate:'2025-10-10', cod:65,  codDate:'2025-11-10', exp:0 }] });
  await makeProject({ name: 'AGE26AL Khavda PSS14',                psId: PS.KHAVDA1, regionId: R.WR, plantTypeId: PT.WIND, totalMw: 208, contd4Mw: 208, phases: [{ src:'WIND', applied:208, ftc:208, ftcDate:'2025-09-01', toc:99,  tocDate:'2026-03-01', cod:99,  codDate:'2026-03-20', exp:104 }] });
  await makeProject({ name: 'NTPC REL at Jamjodhpur',              psId: PS.JAMKHAMB, regionId: R.WR, plantTypeId: PT.WIND, totalMw: 630, contd4Mw: 0,   contd4Status:'PENDING', appDate:'2025-03-01', capacityMonth:'2026-07',
    phases: [{ src:'WIND', applied:54, ftc:0, exp:0 }] });
  await makeProject({ name: 'Continuum Power Trading (TN) Pvt Ltd', psId: bhuj,      regionId: R.WR, plantTypeId: PT.WIND, totalMw: 36,  contd4Mw: 36,  phases: [{ src:'WIND', applied:0,   ftc:0,   exp:36 }] });
  await makeProject({ name: 'Sprng Vayu Vidyut Pvt Ltd',           psId: PS.RAJGARH,  regionId: R.WR, plantTypeId: PT.WIND, totalMw: 198, contd4Mw: 0,   contd4Status:'PENDING', appDate:'2025-04-01', capacityMonth:'2026-07',
    phases: [{ src:'WIND', applied:0,   ftc:0,   exp:105 }] });
  // Oyster Green Hybrid One — Wind component (appears in Wind WR section but is hybrid plant)
  await makeProject({ name: 'Oyster Green Hybrid One Pvt Ltd',     psId: bhuj,       regionId: R.WR, plantTypeId: PT.HWS, totalMw: 99, solarMw: 49.5, windMw: 49.5, contd4Mw: 99,
    phases: [
      { src:'WIND',  applied:0, ftc:0, exp:0 },
      { src:'SOLAR', applied:0, ftc:0, exp:0 },
    ] });

  // ── WR Solar (15 projects) ─────────────────────────────────────────────────
  console.log('\n── WR Solar (15 projects) ──');
  const lakadiya = await pool('400kV Lakadiya Pooling Station',   R.WR);
  const rewa     = await pool('400kV Rewa Pooling Station',        R.WR);

  await makeProject({ name: 'AGE26AL Khavda PSS6',    psId: PS.KHAVDA1, regionId: R.WR, plantTypeId: PT.SOLAR, totalMw: 750,  contd4Mw: 750,  phases: [{ src:'SOLAR', applied:750,  ftc:750,  ftcDate:'2025-06-01', toc:750,  tocDate:'2025-09-01', cod:750,  codDate:'2025-10-01', exp:0 }] });
  await makeProject({ name: 'AGE25CL Khavda PSS8',    psId: PS.KHAVDA1, regionId: R.WR, plantTypeId: PT.SOLAR, totalMw: 500,  contd4Mw: 500,  phases: [{ src:'SOLAR', applied:500,  ftc:500,  ftcDate:'2025-07-01', toc:500,  tocDate:'2025-10-01', cod:350,  codDate:'2026-01-01', exp:150 }] });
  await makeProject({ name: 'AGE24L SRPL Khavda PSS10', psId: PS.KHAVDA1, regionId: R.WR, plantTypeId: PT.SOLAR, totalMw: 150, contd4Mw: 150,  phases: [{ src:'SOLAR', applied:150,  ftc:150,  ftcDate:'2025-05-01', toc:150,  tocDate:'2025-08-01', cod:150,  codDate:'2025-09-01', exp:0 }] });
  await makeProject({ name: 'AGE24L Khavda PSS5',     psId: PS.KHAVDA1, regionId: R.WR, plantTypeId: PT.SOLAR, totalMw: 150,  contd4Mw: 150,  phases: [{ src:'SOLAR', applied:150,  ftc:150,  ftcDate:'2025-05-05', toc:150,  tocDate:'2025-08-05', cod:150,  codDate:'2025-09-05', exp:0 }] });
  await makeProject({ name: 'AGE26BL Khavda PSS10',   psId: PS.KHAVDA1, regionId: R.WR, plantTypeId: PT.SOLAR, totalMw: 150,  contd4Mw: 150,  phases: [{ src:'SOLAR', applied:150,  ftc:150,  ftcDate:'2025-06-05', toc:150,  tocDate:'2025-09-05', cod:150,  codDate:'2025-10-05', exp:0 }] });
  await makeProject({ name: 'Avaada GJ Sustainable Pvt Ltd', psId: lakadiya, regionId: R.WR, plantTypeId: PT.SOLAR, totalMw: 200, contd4Mw: 200, phases: [{ src:'SOLAR', applied:200, ftc:200, ftcDate:'2025-08-01', toc:200, tocDate:'2025-11-01', cod:200, codDate:'2025-12-01', exp:0 }] });
  await makeProject({ name: 'Ayana Power Four Pvt Ltd (Zura)', psId: bhuj, regionId: R.WR, plantTypeId: PT.SOLAR, totalMw: 150, contd4Mw: 150, phases: [{ src:'SOLAR', applied:150, ftc:150, ftcDate:'2025-07-20', toc:150, tocDate:'2025-10-20', cod:150, codDate:'2025-11-20', exp:0 }] });
  await makeProject({ name: 'NTPC REL Khavda PSS2',   psId: PS.KHAVDA1, regionId: R.WR, plantTypeId: PT.SOLAR, totalMw: 1555, contd4Mw: 1555, phases: [{ src:'SOLAR', applied:1555, ftc:1555, ftcDate:'2025-04-01', toc:1555, tocDate:'2025-07-01', cod:1555, codDate:'2025-08-01', exp:0 }] });
  await makeProject({ name: 'NTPC REL Khavda PSS1',   psId: PS.KHAVDA1, regionId: R.WR, plantTypeId: PT.SOLAR, totalMw: 1200, contd4Mw: 1095, phases: [{ src:'SOLAR', applied:1200, ftc:1095, ftcDate:'2025-05-01', toc:1095, tocDate:'2025-08-01', cod:1095, codDate:'2025-09-01', exp:105 }] });
  await makeProject({ name: 'Coal India Ltd at GIPCL', psId: PS.KHAVDA1, regionId: R.WR, plantTypeId: PT.SOLAR, totalMw: 300,  contd4Mw: 0, contd4Status:'PENDING', appDate:'2025-06-01', capacityMonth:'2026-08',
    phases: [{ src:'SOLAR', applied:300, ftc:0, exp:0 }] });
  await makeProject({ name: 'NTPC REL at GSECL',      psId: PS.KHAVDA1, regionId: R.WR, plantTypeId: PT.SOLAR, totalMw: 265,  contd4Mw: 65,  phases: [{ src:'SOLAR', applied:65, ftc:65, ftcDate:'2026-01-10', toc:65, tocDate:'2026-03-10', cod:0, exp:65 }] });
  await makeProject({ name: 'Engie Energy India Pvt Ltd at GSECL', psId: PS.KHAVDA1, regionId: R.WR, plantTypeId: PT.SOLAR, totalMw: 200, contd4Mw: 0, contd4Status:'PENDING', appDate:'2025-07-01', capacityMonth:'2026-07',
    phases: [{ src:'SOLAR', applied:200, ftc:0, underFtc:200, exp:0 }] });
  await makeProject({ name: 'JSW Renew Energy Ten Ltd at GSECL', psId: PS.KHAVDA1, regionId: R.WR, plantTypeId: PT.SOLAR, totalMw: 300, contd4Mw: 0, contd4Status:'PENDING', appDate:'2025-08-01', capacityMonth:'2026-09',
    phases: [{ src:'SOLAR', applied:0, ftc:0, exp:300 }] });
  await makeProject({ name: 'Waree Energies Ltd',     psId: rewa,       regionId: R.WR, plantTypeId: PT.SOLAR, totalMw: 170,  contd4Mw: 170, phases: [{ src:'SOLAR', applied:170, ftc:0, underFtc:170, exp:170 }] });
  await makeProject({ name: 'NTPC REL Khavda PSS4',   psId: PS.KHAVDA1, regionId: R.WR, plantTypeId: PT.SOLAR, totalMw: 795,  contd4Mw: 0, contd4Status:'PENDING', appDate:'2025-09-01', capacityMonth:'2026-09',
    phases: [{ src:'SOLAR', applied:275, ftc:0, underFtc:35, exp:0, remarks:'CAT-2 yet to be received' }] });

  // ── WR BESS (3 projects) ───────────────────────────────────────────────────
  console.log('\n── WR BESS (3 projects) ──');
  await makeProject({ name: 'ARE43L BESS SRPL Khavda PSS10', psId: PS.KHAVDA1, regionId: R.WR, plantTypeId: PT.BESS, totalMw: 475, contd4Mw: 475, phases: [{ src:'BESS', applied:480, ftc:480, ftcDate:'2025-08-01', toc:400, tocDate:'2025-12-01', cod:400, codDate:'2026-01-15', exp:75 }] });
  await makeProject({ name: 'ARE37L BESS AGEL Khavda PSS5',  psId: PS.KHAVDA1, regionId: R.WR, plantTypeId: PT.BESS, totalMw: 475, contd4Mw: 475, phases: [{ src:'BESS', applied:480, ftc:480, ftcDate:'2025-09-01', toc:460, tocDate:'2026-01-10', cod:460, codDate:'2026-02-10', exp:15 }] });
  await makeProject({ name: 'ARE36L BESS AGEL Khavda PSS8',  psId: PS.KHAVDA1, regionId: R.WR, plantTypeId: PT.BESS, totalMw: 284, contd4Mw: 284, phases: [{ src:'BESS', applied:320, ftc:320, ftcDate:'2025-10-01', toc:240, tocDate:'2026-02-01', cod:240, codDate:'2026-03-01', exp:44, underToc:80 }] });

  // ── WR Hybrid (9 projects) ─────────────────────────────────────────────────
  console.log('\n── WR Hybrid (9 projects) ──');
  const devasar = await pool('400kV Devasar Pooling Station', R.WR);

  // AGE26BL KPS10 — Hybrid (Solar+Wind) 298MW
  await makeProject({ name: 'AGE26BL Khavda PSS10 Hybrid', psId: PS.KHAVDA1, regionId: R.WR, plantTypeId: PT.HWS,
    totalMw: 298, solarMw: 149, windMw: 149, contd4Mw: 216,
    phases: [
      { src:'SOLAR', applied:149, ftc:149, ftcDate:'2025-09-15', toc:149, tocDate:'2025-12-15', cod:149, codDate:'2026-01-10', exp:0 },
      { src:'WIND',  applied:149, ftc:149, ftcDate:'2025-09-17', toc:149, tocDate:'2025-12-17', cod:149, codDate:'2026-01-12', exp:0 },
    ] });
  // Oyster Green Hybrid One — already created in Wind section; skip duplicate
  // TEQ Green Power XI — Hybrid (Solar+Wind) 204MW
  await makeProject({ name: 'TEQ Green Power XI Pvt Ltd', psId: PS.KALLAM, regionId: R.WR, plantTypeId: PT.HWS,
    totalMw: 204, solarMw: 102, windMw: 102, contd4Mw: 150,
    phases: [
      { src:'SOLAR', applied:102, ftc:87,  ftcDate:'2025-11-20', toc:80,  tocDate:'2026-02-10', cod:80,  codDate:'2026-02-25', exp:20.5 },
      { src:'WIND',  applied:102, ftc:87,  ftcDate:'2025-11-22', toc:80,  tocDate:'2026-02-12', cod:80,  codDate:'2026-02-27', exp:20.5 },
    ] });
  // Ayana Power Four (Devasar) — Hybrid (Solar+Wind) 130MW
  await makeProject({ name: 'Ayana Power Four Pvt Ltd (Devasar)', psId: devasar, regionId: R.WR, plantTypeId: PT.HWS,
    totalMw: 130, solarMw: 65, windMw: 65, contd4Mw: 100,
    phases: [
      { src:'SOLAR', applied:65, ftc:65, ftcDate:'2025-10-01', toc:65, tocDate:'2026-01-15', cod:65, codDate:'2026-01-20', exp:0 },
      { src:'WIND',  applied:65, ftc:65, ftcDate:'2025-10-03', toc:65, tocDate:'2026-01-17', cod:65, codDate:'2026-01-22', exp:0 },
    ] });
  // Mounting Renewable Power — Hybrid (Solar+Wind) 250MW; partially applied
  await makeProject({ name: 'Mounting Renewable Power Ltd', psId: PS.JAMKHAMB, regionId: R.WR, plantTypeId: PT.HWS,
    totalMw: 250, solarMw: 125, windMw: 125, contd4Mw: 127,
    phases: [
      { src:'SOLAR', applied:64.5, ftc:64.5, ftcDate:'2026-01-10', toc:0, underToc:64.5, exp:64.5 },
      { src:'WIND',  applied:64.5, ftc:64.5, ftcDate:'2026-01-12', toc:0, underToc:64.5, exp:64.5 },
    ] });
  // Airpower Windfarms — Hybrid (Solar+Wind+BESS) 229MW
  await makeProject({ name: 'Airpower Windfarms Pvt Ltd', psId: PS.JAMKHAMB, regionId: R.WR, plantTypeId: PT.HWSB,
    totalMw: 229, solarMw: 100, windMw: 100, bessMw: 29, contd4Mw: 140,
    phases: [
      { src:'SOLAR', applied:40.5, ftc:25, ftcDate:'2026-02-01', underFtc:0, toc:0, underToc:25, exp:25 },
      { src:'WIND',  applied:40.5, ftc:25, ftcDate:'2026-02-03', underFtc:0, toc:0, underToc:25, exp:25 },
    ] });
  // Veh Jayin — Hybrid (Solar+Wind) 196.8MW; CONTD-4 pending
  await makeProject({ name: 'Veh Jayin Renewables Pvt Ltd', psId: PS.RAJGARH, regionId: R.WR, plantTypeId: PT.HWS,
    totalMw: 196.8, solarMw: 100, windMw: 96.8, contd4Mw: 196.8, contd4Status:'PENDING',
    appDate:'2025-02-01', capacityMonth:'2026-08', phases: [] });
  // Aditya Birla Renewable (ABREL) Valsara — Hybrid; CONTD-4 pending
  await makeProject({ name: 'Aditya Birla Renewable Energy Ltd Valsara', psId: bhuj2, regionId: R.WR, plantTypeId: PT.HWS,
    totalMw: 314, solarMw: 157, windMw: 157, contd4Mw: 294, contd4Status:'PENDING',
    appDate:'2025-03-01', capacityMonth:'2026-09', phases: [] });
  // APSEZ Khavda PSS4 — Hybrid (Solar+Wind) 377MW; partially cleared
  await makeProject({ name: 'APSEZ Khavda PSS4', psId: PS.KHAVDA1, regionId: R.WR, plantTypeId: PT.HWS,
    totalMw: 377, solarMw: 188.5, windMw: 188.5, contd4Mw: 325,
    phases: [
      { src:'SOLAR', applied:38.5, ftc:26, ftcDate:'2026-01-20', toc:26, tocDate:'2026-03-20', cod:26, codDate:'2026-04-01', exp:0 },
      { src:'WIND',  applied:38.5, ftc:26, ftcDate:'2026-01-22', toc:26, tocDate:'2026-03-22', cod:26, codDate:'2026-04-03', exp:0 },
    ] });

  // ── SR Wind (2 projects) ───────────────────────────────────────────────────
  console.log('\n── SR Wind (2 projects) ──');
  await makeProject({ name: 'Sembcorp Green Infra Pvt Ltd', psId: PS.GADAG, regionId: R.SR, plantTypeId: PT.WIND,
    totalMw: 300, contd4Mw: 262,
    phases: [{ src:'WIND', applied:109, ftc:109, ftcDate:'2025-10-01', toc:69, tocDate:'2026-01-15', cod:69, codDate:'2026-02-01', exp:40 }] });
  await makeProject({ name: 'JSW Renew Energy Ltd (Karur)', psId: PS.GADAG, regionId: R.SR, plantTypeId: PT.WIND,
    totalMw: 189, contd4Mw: 150,
    phases: [{ src:'WIND', applied:189, ftc:189, ftcDate:'2025-09-15', toc:162, tocDate:'2026-01-20', cod:162, codDate:'2026-02-10', exp:0 }] });

  // ── SR Solar (3 projects) ──────────────────────────────────────────────────
  console.log('\n── SR Solar (3 projects) ──');
  await makeProject({ name: 'SAEL Solar MHP2 Pvt Ltd',  psId: PS.KURNOOL3, regionId: R.SR, plantTypeId: PT.SOLAR,
    totalMw: 360, contd4Mw: 300,
    phases: [{ src:'SOLAR', applied:360, ftc:360, ftcDate:'2025-08-10', toc:360, tocDate:'2025-11-10', cod:300, codDate:'2026-01-10', exp:0 }] });
  await makeProject({ name: 'TP Saurya Ltd (Koppal)',   psId: PS.KOPPAL, regionId: R.SR, plantTypeId: PT.SOLAR,
    totalMw: 352, contd4Mw: 300,
    phases: [{ src:'SOLAR', applied:281.6, ftc:281.6, ftcDate:'2025-09-01', toc:281.6, tocDate:'2025-12-01', cod:238.46, codDate:'2026-01-20', exp:52.8, underToc:155 }] });
  await makeProject({ name: 'NTPC Ramagundam Solar (176MW)', psId: PS.RAMAGUNDAM, regionId: R.SR, plantTypeId: PT.SOLAR,
    totalMw: 204.6, contd4Mw: 176,
    phases: [{ src:'SOLAR', applied:154.8, ftc:154.8, ftcDate:'2026-01-05', underToc:154.8, exp:154.8 }] });

  // ── ER Coal (2 projects: 1 cleared, 1 CONTD-4) ────────────────────────────
  console.log('\n── ER Coal ──');
  const buxar = await pool('400kV Buxar Pooling Station', R.ER);
  await makeProject({ name: 'PVUNL Unit-2 Barh-II', psId: PS.BARH, regionId: R.ER, plantTypeId: PT.COAL,
    totalMw: 2400, contd4Mw: 2400,
    phases: [{ src:'COAL', applied:2400, ftc:1600, ftcDate:'2025-06-01', toc:800, tocDate:'2025-10-01', cod:800, codDate:'2025-12-01', underFtc:800, exp:800 }] });
  await makeProject({ name: 'Buxar Thermal Power Unit-2', psId: buxar, regionId: R.ER, plantTypeId: PT.COAL,
    totalMw: 660, contd4Mw: 0, contd4Status: 'PENDING', appDate:'2025-01-01', capacityMonth:'2026-07', phases: [] });

  // ── NER Hydro ──────────────────────────────────────────────────────────────
  console.log('\n── NER Hydro ──');
  const subansiriPs = await pool('Subansiri Dam Pooling Station', R.NER);
  await makeProject({ name: 'Subansiri Lower Hydro Electric Project', psId: subansiriPs, regionId: R.NER, plantTypeId: PT.HYDRO,
    totalMw: 2000, contd4Mw: 2000,
    phases: [
      { src:'HYDRO', applied:1000, ftc:1000, ftcDate:'2025-03-01', toc:1000, tocDate:'2025-06-01', cod:1000, codDate:'2026-03-15', exp:0 },
      { src:'HYDRO', applied:1000, ftc:0, underFtc:1000, exp:1000 },
    ] });

  // ── Transmission elements ──────────────────────────────────────────────────
  console.log('\n── Transmission Elements ──');
  // NR
  await makeTx({ name:'765kV Fatehgarh-III–Beawar Ckt-1', regionId:R.NR, type:'LINE', isRe:true, voltKv:765, lenKm:452, pendingFtc:false });
  await makeTx({ name:'400kV Bikaner-II–Bikaner-III Ckt-3', regionId:R.NR, type:'LINE', isRe:true, voltKv:400, lenKm:4.2, pendingFtc:false });
  await makeTx({ name:'1500 MVA ICT-1 at Beawar SS', regionId:R.NR, type:'ICT', isRe:true, voltKv:765, mvaMw:1500, pendingFtc:false });
  await makeTx({ name:'500 MVA ICT-1 at Garautha SS', regionId:R.NR, type:'ICT', isRe:false, voltKv:400, mvaMw:500, pendingFtc:true, propFtc:'2026-06-01', mvaApr:500 });
  await makeTx({ name:'400kV Ramgarh–Anta Ckt-1 (Pending)', regionId:R.NR, type:'LINE', isRe:true, voltKv:400, lenKm:98, pendingFtc:true, propFtc:'2026-07-01', lenApr:98 });
  // WR
  await makeTx({ name:'400kV Warora–Akola Line Ckt-1', regionId:R.WR, type:'LINE', isRe:false, voltKv:400, lenKm:176, pendingFtc:false });
  await makeTx({ name:'400kV Bhuj–Jamkhambaliya D/C Line', regionId:R.WR, type:'LINE', isRe:true, voltKv:400, lenKm:204, pendingFtc:false });
  await makeTx({ name:'315 MVA ICT at Warora SS', regionId:R.WR, type:'ICT', isRe:false, voltKv:400, mvaMw:315, pendingFtc:false });
  await makeTx({ name:'500 MVA ICT-2 at Bhuj SS', regionId:R.WR, type:'ICT', isRe:true, voltKv:400, mvaMw:500, pendingFtc:false });
  await makeTx({ name:'1000 MVA ICT at Khavda Pooling Station', regionId:R.WR, type:'ICT', isRe:true, voltKv:765, mvaMw:1000, pendingFtc:true, propFtc:'2026-05-30', mvaApr:1000 });
  await makeTx({ name:'765kV Khavda–Bhuj D/C Line Ckt-2', regionId:R.WR, type:'LINE', isRe:true, voltKv:765, lenKm:85, pendingFtc:true, propFtc:'2026-06-15', lenApr:85 });
  // SR
  await makeTx({ name:'400kV Kurnool-III–Ananthapuram Line', regionId:R.SR, type:'LINE', isRe:true, voltKv:400, lenKm:115, pendingFtc:false });
  await makeTx({ name:'500 MVA ICT at Koppal-II SS', regionId:R.SR, type:'ICT', isRe:true, voltKv:400, mvaMw:500, pendingFtc:true, propFtc:'2026-06-30', mvaApr:500 });
  // ER
  await makeTx({ name:'LILO of 220kV Dumka–Govindpur Circuit', regionId:R.ER, type:'LINE', isRe:false, voltKv:220, lenKm:2.1, pendingFtc:false });
  await makeTx({ name:'400kV Rearrangement at New Bongaigaon', regionId:R.ER, type:'LINE', isRe:false, voltKv:400, lenKm:0.5, pendingFtc:true, propFtc:'2026-07-01', lenApr:0.5 });
  // NER
  await makeTx({ name:'132kV SM Nagar ISTS–SM Nagar Line', regionId:R.NER, type:'LINE', isRe:false, voltKv:132, lenKm:5.4, pendingFtc:false });
  await makeTx({ name:'220kV Sankardevnagar–Lower Kopili Line', regionId:R.NER, type:'LINE', isRe:false, voltKv:220, lenKm:46.6, pendingFtc:true, propFtc:'2026-05-15', lenApr:46.6 });

  // ── Final counts ──────────────────────────────────────────────────────────
  const [projCount, phaseCount, contd4Count, txCount] = await Promise.all([
    prisma.generationProject.count(),
    prisma.commissioningPhase.count(),
    prisma.contd4Application.count(),
    prisma.transmissionElement.count(),
  ]);
  console.log(`\n✅ Seed complete: ${projCount} projects | ${phaseCount} phases | ${contd4Count} CONTD-4 | ${txCount} TX elements`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
