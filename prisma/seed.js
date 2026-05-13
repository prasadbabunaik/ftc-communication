const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function seedUsers() {
  const users = [
    { name: 'Admin User',   email: 'admin@ftc.gov.in',   role: 'ADMIN',   password: 'Admin@123' },
    { name: 'SRLDC User',   email: 'srldc@ftc.gov.in',   role: 'SRLDC',   password: 'Srldc@123' },
    { name: 'NRLDC User',   email: 'nrldc@ftc.gov.in',   role: 'NRLDC',   password: 'Nrldc@123' },
    { name: 'ERLDC User',   email: 'erldc@ftc.gov.in',   role: 'ERLDC',   password: 'Erldc@123' },
    { name: 'WRLDC User',   email: 'wrldc@ftc.gov.in',   role: 'WRLDC',   password: 'Wrldc@123' },
    { name: 'NERLDC User',  email: 'nerldc@ftc.gov.in',  role: 'NERLDC',  password: 'Nerldc@123' },
    { name: 'NLDC User',    email: 'nldc@ftc.gov.in',    role: 'NLDC',    password: 'Nldc@123' },
  ];

  for (const user of users) {
    const hashedPassword = await bcrypt.hash(user.password, 12);
    await prisma.user.upsert({
      where: { email: user.email },
      update: {},
      create: { name: user.name, email: user.email, password: hashedPassword, role: user.role },
    });
    console.log(`  User: ${user.email}`);
  }
}

async function seedGridMasterData() {
  // ── Regions ────────────────────────────────────────────────────────────────
  const regionData = [
    { code: 'SR',  name: 'Southern Region' },
    { code: 'NR',  name: 'Northern Region' },
    { code: 'WR',  name: 'Western Region' },
    { code: 'ER',  name: 'Eastern Region' },
    { code: 'NER', name: 'North-Eastern Region' },
  ];

  for (const r of regionData) {
    await prisma.gridRegion.upsert({
      where: { code: r.code },
      update: { name: r.name },
      create: r,
    });
  }
  console.log(`  Regions: ${regionData.length} upserted`);

  // ── Plant Types ────────────────────────────────────────────────────────────
  const plantTypeData = [
    { code: 'SOLAR',      label: 'Solar',                          category: 'RENEWABLE',    isHybrid: false },
    { code: 'WIND',       label: 'Wind',                           category: 'RENEWABLE',    isHybrid: false },
    { code: 'HYBRID_WS',  label: 'Hybrid (Wind+Solar)',            category: 'RENEWABLE',    isHybrid: true  },
    { code: 'HYBRID_WSB', label: 'Hybrid (Wind+Solar+BESS)',       category: 'RENEWABLE',    isHybrid: true  },
    { code: 'COAL',       label: 'Coal',                           category: 'CONVENTIONAL', isHybrid: false },
    { code: 'HYDRO',      label: 'Hydro',                          category: 'CONVENTIONAL', isHybrid: false },
    { code: 'PSP',        label: 'Pumped Storage Plant (PSP)',     category: 'STORAGE',      isHybrid: false },
    { code: 'BESS',       label: 'Battery Energy Storage (BESS)',  category: 'STORAGE',      isHybrid: false },
    { code: 'HYBRID_SB',  label: 'Hybrid (Solar+BESS)',            category: 'RENEWABLE',    isHybrid: true  },
    { code: 'HYBRID_WB',  label: 'Hybrid (Wind+BESS)',             category: 'RENEWABLE',    isHybrid: true  },
    { code: 'HYBRID_WP',  label: 'Hybrid (Wind+PSP)',              category: 'STORAGE',      isHybrid: true  },
    { code: 'HYBRID_HP',  label: 'Hybrid (Hydro+PSP)',             category: 'CONVENTIONAL', isHybrid: true  },
  ];

  for (const pt of plantTypeData) {
    await prisma.plantType.upsert({
      where: { code: pt.code },
      update: { label: pt.label, category: pt.category, isHybrid: pt.isHybrid },
      create: pt,
    });
  }
  console.log(`  Plant types: ${plantTypeData.length} upserted`);

  // ── Pooling Stations ───────────────────────────────────────────────────────
  const regionMap = {};
  const regions = await prisma.gridRegion.findMany();
  for (const r of regions) regionMap[r.code] = r.id;

  const poolingStationData = [
    // Southern Region
    { name: '400/220kV Hiriyur Pooling Station',       voltageKv: 400, regionCode: 'SR' },
    { name: '400/220kV NP Kunta Pooling Station',      voltageKv: 400, regionCode: 'SR' },
    { name: '400/220kV Pavagada Pooling Station',      voltageKv: 400, regionCode: 'SR' },
    { name: '765/400/220kV Kurnool-III SS',            voltageKv: 765, regionCode: 'SR' },
    { name: '765/400/220kV Koppal-II SS',              voltageKv: 765, regionCode: 'SR' },
    { name: '400/230kV Karur Pooling Station',         voltageKv: 400, regionCode: 'SR' },
    { name: '400/220kV Ramagundam PS',                 voltageKv: 400, regionCode: 'SR' },
    { name: '400/220kV Ananthapuram PS',               voltageKv: 400, regionCode: 'SR' },
    { name: '400/220kV Gadag Pooling Station',         voltageKv: 400, regionCode: 'SR' },
    { name: '400/220kV Gadag-II Pooling Station',      voltageKv: 400, regionCode: 'SR' },
    { name: '400/220kV Tumkur Pooling Station',        voltageKv: 400, regionCode: 'SR' },
    // Northern Region
    { name: '400kV Fatehgarh Pooling Station',         voltageKv: 400, regionCode: 'NR' },
    { name: '400kV Bikaner Pooling Station',           voltageKv: 400, regionCode: 'NR' },
    { name: '400kV Ramgarh Pooling Station',           voltageKv: 400, regionCode: 'NR' },
    { name: '765kV Bhuj Pooling Station',              voltageKv: 765, regionCode: 'NR' },
    { name: '400kV Jaisalmer Pooling Station',         voltageKv: 400, regionCode: 'NR' },
    // Western Region
    { name: '400/220kV Ratlam Pooling Station',        voltageKv: 400, regionCode: 'WR' },
    { name: '400kV Dhule Pooling Station',             voltageKv: 400, regionCode: 'WR' },
    { name: '400kV Warora Pooling Station',            voltageKv: 400, regionCode: 'WR' },
    { name: '400kV Raj West Pooling Station',          voltageKv: 400, regionCode: 'WR' },
    // Eastern Region
    { name: '400kV Purulia Pooling Station',           voltageKv: 400, regionCode: 'ER' },
    { name: '400kV Gazuwaka Pooling Station',          voltageKv: 400, regionCode: 'ER' },
    { name: '400kV Durgapur Pooling Station',          voltageKv: 400, regionCode: 'ER' },
    // North-Eastern Region
    { name: '400kV Arunachal Pooling Station',         voltageKv: 400, regionCode: 'NER' },
    { name: '220kV Palatana Pooling Station',          voltageKv: 220, regionCode: 'NER' },
    { name: '400kV Assam Pooling Station',             voltageKv: 400, regionCode: 'NER' },
  ];

  let psCount = 0;
  for (const ps of poolingStationData) {
    const regionId = regionMap[ps.regionCode];
    if (!regionId) continue;
    await prisma.poolingStation.upsert({
      where: { name_regionId: { name: ps.name, regionId } },
      update: { voltageKv: ps.voltageKv },
      create: { name: ps.name, voltageKv: ps.voltageKv, regionId },
    });
    psCount++;
  }
  console.log(`  Pooling stations: ${psCount} upserted`);
}

async function seedSampleProjects() {
  const srRegion   = await prisma.gridRegion.findUnique({ where: { code: 'SR' } });
  const srldc      = await prisma.user.findUnique({ where: { email: 'srldc@ftc.gov.in' } });
  if (!srRegion || !srldc) { console.log('  Sample projects: skipped (SR region or SRLDC user not found)'); return; }

  const pt = {};
  const types = await prisma.plantType.findMany();
  for (const t of types) pt[t.code] = t.id;

  const ps = {};
  const stations = await prisma.poolingStation.findMany({ where: { regionId: srRegion.id } });
  for (const s of stations) ps[s.name] = s.id;

  function findPs(keyword) {
    const key = Object.keys(ps).find((k) => k.toLowerCase().includes(keyword.toLowerCase()));
    return key ? ps[key] : null;
  }

  const projects = [
    {
      name: 'NHPC',
      plantTypeCode: 'SOLAR', capacityMw: 100,
      pooling: 'NP Kunta',
      contd4: { applicationDate: new Date('2025-02-21'), proposedFtcDate: new Date('2026-06-01'), status: 'PENDING', remarks: 'PSCAD dynamic model & PSSE not complied. Revised models received on 06.04.2026 from CTUIL.' },
    },
    {
      name: 'Zenataris',
      plantTypeCode: 'HYBRID_WS', capacityMw: 200,
      pooling: 'Hiriyur',
      contd4: { applicationDate: new Date('2025-03-27'), proposedFtcDate: new Date('2026-03-01'), capacityApr26Mw: 134, status: 'CLEARED', remarks: 'Models complied and compliance sheet sent to CTUIL. CONNTD-4 issued for 200MW on 31.03.2026 for installed capacity of 300.3MW.' },
    },
    {
      name: 'AMPIN (Hybrid)',
      plantTypeCode: 'HYBRID_WS', capacityMw: 150,
      pooling: 'Kurnool-III',
      contd4: { applicationDate: new Date('2026-02-26'), proposedFtcDate: new Date('2026-05-01'), status: 'PENDING', remarks: 'Reapplied after exhausting 3 revisions. Revised models received on 09.03.2026, Model check is in progress.' },
    },
    {
      name: 'AMPIN (Solar)',
      plantTypeCode: 'SOLAR', capacityMw: 100,
      pooling: 'Kurnool-III',
      contd4: { applicationDate: new Date('2025-08-27'), proposedFtcDate: new Date('2026-05-01'), status: 'PENDING', remarks: 'PSCAD & PSSE not complied.' },
    },
    {
      name: 'KSPDCL',
      plantTypeCode: 'SOLAR', capacityMw: 300,
      pooling: 'Pavagada',
      contd4: { applicationDate: new Date('2025-09-08'), proposedFtcDate: new Date('2026-03-01'), status: 'PENDING', remarks: 'Revised models received on 20.03.2026 and model check is in progress.' },
    },
    {
      name: 'TPREL',
      plantTypeCode: 'SOLAR', capacityMw: 170,
      pooling: 'Koppal-II',
      contd4: { applicationDate: new Date('2025-09-09'), proposedFtcDate: new Date('2026-09-01'), status: 'PENDING', remarks: 'Compliance sheet sent to CTUIL.' },
    },
    {
      name: 'ReNew Vikram Shakti Pvt Ltd',
      plantTypeCode: 'HYBRID_WSB', capacityMw: 684,
      pooling: 'Ananthapuram',
      contd4: { applicationDate: new Date('2025-11-21'), proposedFtcDate: new Date('2026-04-01'), status: 'PENDING', remarks: 'PSCAD dynamic model & PSSE not complied. Revised models received on 31.03.2026.' },
    },
    {
      name: 'IRCON',
      plantTypeCode: 'SOLAR', capacityMw: 100,
      pooling: 'Pavagada',
      contd4: { applicationDate: new Date('2023-08-17'), proposedFtcDate: new Date('2026-03-01'), capacityApr26Mw: 100, status: 'PENDING', remarks: 'Applied for connectivity enhancement. PSCAD dynamic model not complied. Revised models received and observations sent to CTUIL on 01.04.2026.' },
    },
    {
      name: 'M/s SolarXL Beta Energy Pvt Ltd (HEXA)',
      plantTypeCode: 'HYBRID_WS', capacityMw: 207,
      pooling: 'Gadag-II',
      contd4: { applicationDate: new Date('2025-12-07'), proposedFtcDate: new Date('2026-06-01'), status: 'PENDING', remarks: 'PSCAD dynamic model & PSSE not complied. Revised models received on 01.04.2026.' },
    },
    {
      name: 'JINDAL GREEN WIND 1 PRIVATE LIMITED',
      plantTypeCode: 'WIND', capacityMw: 700,
      pooling: 'Koppal-II',
      contd4: { applicationDate: new Date('2025-12-31'), proposedFtcDate: new Date('2026-03-01'), status: 'PENDING', remarks: 'PSCAD Harmonic, dynamic model & PSSE models not complied. Revised models awaited from developer.' },
    },
  ];

  let created = 0;
  for (const p of projects) {
    const exists = await prisma.generationProject.findFirst({
      where: { name: p.name, regionId: srRegion.id },
    });
    if (exists) continue;

    await prisma.generationProject.create({
      data: {
        name:            p.name,
        regionId:        srRegion.id,
        plantTypeId:     pt[p.plantTypeCode],
        poolingStationId: findPs(p.pooling),
        totalCapacityMw: p.capacityMw,
        createdById:     srldc.id,
        contd4: { create: {
          applicationDate: p.contd4.applicationDate,
          proposedFtcDate: p.contd4.proposedFtcDate ?? null,
          capacityApr26Mw: p.contd4.capacityApr26Mw ?? null,
          status:          p.contd4.status,
          remarks:         p.contd4.remarks ?? null,
        }},
      },
    });
    created++;
  }
  console.log(`  Sample projects: ${created} created (${projects.length - created} already existed)`);
}

async function main() {
  console.log('Seeding users...');
  await seedUsers();

  console.log('Seeding grid master data...');
  await seedGridMasterData();

  console.log('Seeding sample projects...');
  await seedSampleProjects();

  console.log('Seeding complete.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
