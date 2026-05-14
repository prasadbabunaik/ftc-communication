#!/usr/bin/env node
/**
 * Seed April 30 data into FTC Communication DB.
 * Run:  node scripts/seed-apr30.js
 */
require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const ADMIN_ID = 'cmp45icgu0000fnulalj6uymo';

// ── Seeded lookup IDs ──────────────────────────────────────────────────────────
const REGION = {
  NR:  'cmp45idho0008fnulx05edi99',
  WR:  'cmp45idhp0009fnulee9whg95',
  ER:  'cmp45idhp000afnulxrkrc91x',
  NER: 'cmp45idhq000bfnul6oe8alk7',
  SR:  'cmp45idhm0007fnulmgnnkgox',
};

const PT = {
  SOLAR:      'cmp45idhr000cfnulzn36mrr9',
  WIND:       'cmp45idhs000dfnul2lguyuz0',
  HYBRID_WS:  'cmp45idht000efnuloscph0ne',
  HYBRID_WSB: 'cmp45idht000ffnul86qx8jvu',
  COAL:       'cmp45idhu000gfnultfo0rklv',
  HYDRO:      'cmp45idhu000hfnuldour0kz8',
  PSP:        'cmp45idhv000ifnuljibxm4bp',
  BESS:       'cmp45idhv000jfnulbhhqlmrz',
  HYBRID_SB:  'cmp45idhw000kfnula4u8g5ai',
  HYBRID_WB:  'cmp45idhw000lfnulsj2kkmiw',
  HYBRID_WP:  'cmp45idhx000mfnulea9sqbxs',
  HYBRID_HP:  'cmp45idhx000nfnulsyrbkosn',
  HYBRID_SP:  'cmp47avoy0000fnfxgphqpj6y',
};

// ── helpers ────────────────────────────────────────────────────────────────────
const d = (v) => v != null ? new Date(v + (v.length === 10 ? 'T00:00:00Z' : '')) : null;
const dec = (v) => v != null ? parseFloat(v) : null;

async function getOrCreatePoolingStation(name, regionCode) {
  if (!name) return null;
  const regionId = REGION[regionCode];
  const existing = await prisma.poolingStation.findFirst({
    where: { name, regionId },
  });
  if (existing) return existing.id;
  const created = await prisma.poolingStation.create({
    data: { name, regionId },
  });
  return created.id;
}

// ── main ───────────────────────────────────────────────────────────────────────
async function main() {
  const seedData = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'seed-data.json'), 'utf8')
  );

  // ── Step 0: Add HYBRID_SP plant type if missing ──────────────────────────
  const hybridSp = await prisma.plantType.findUnique({ where: { code: 'HYBRID_SP' } });
  let HYBRID_SP_ID = hybridSp?.id;
  if (!hybridSp) {
    const created = await prisma.plantType.create({
      data: {
        code:     'HYBRID_SP',
        label:    'Hybrid (Solar+PSP)',
        category: 'STORAGE',
        isHybrid: true,
      },
    });
    HYBRID_SP_ID = created.id;
    console.log('Created plant type HYBRID_SP:', HYBRID_SP_ID);
  }
  PT.HYBRID_SP = HYBRID_SP_ID;

  // ── Step 1: Delete all existing transactional data ───────────────────────
  console.log('\nDeleting existing data...');
  await prisma.$transaction([
    prisma.transmissionAuditLog.deleteMany(),
    prisma.projectNote.deleteMany(),
    prisma.commissioningPhase.deleteMany(),
    prisma.contd4Application.deleteMany(),
    prisma.generationProject.deleteMany(),
    prisma.poolingStation.deleteMany(),
    prisma.transmissionElement.deleteMany(),
  ]);
  console.log('  ✓ All existing data deleted');

  // ── Step 2: Insert CONTD-4 projects ─────────────────────────────────────
  console.log('\nInserting CONTD-4 projects...');
  let c4Count = 0;
  for (const p of seedData.contd4Projects) {
    const ptId = PT[p.plantTypeCode] || PT.SOLAR;
    const regionId = REGION[p.region];
    if (!regionId) { console.warn('  ⚠ Unknown region:', p.region, p.name); continue; }

    const psId = await getOrCreatePoolingStation(p.poolingStation, p.region);

    await prisma.generationProject.create({
      data: {
        name:              p.name,
        regionId,
        plantTypeId:       ptId,
        poolingStationId:  psId,
        totalCapacityMw:   p.totalCapacityMw,
        createdById:       ADMIN_ID,
        contd4: {
          create: {
            applicationDate:  d(p.applicationDate) ?? new Date('2025-01-01T00:00:00Z'),
            proposedFtcDate:  d(p.proposedFtcDate),
            capacityApr26Mw:  dec(p.capacityApr26Mw),
            capacityMonth:    p.capacityMonth,
            status:           'PENDING',
            remarks:          p.remarks,
          },
        },
      },
    });
    c4Count++;
  }
  console.log(`  ✓ ${c4Count} CONTD-4 projects inserted`);

  // ── Step 3: Insert FTC projects (CLEARED CONTD-4 + phases) ───────────────
  console.log('\nInserting FTC projects...');
  let ftcCount = 0, phaseCount = 0;
  for (const p of seedData.ftcProjects) {
    const ptId = PT[p.plantTypeCode] || PT.SOLAR;
    const regionId = REGION[p.region];
    if (!regionId) { console.warn('  ⚠ Unknown region:', p.region, p.name); continue; }

    const psId = await getOrCreatePoolingStation(p.poolingStation, p.region);

    await prisma.generationProject.create({
      data: {
        name:              p.name,
        regionId,
        plantTypeId:       ptId,
        poolingStationId:  psId,
        totalCapacityMw:   p.totalCapacityMw ?? 0,
        createdById:       ADMIN_ID,
        contd4: {
          create: {
            applicationDate:  new Date('2025-01-01T00:00:00Z'),
            capacityApr26Mw:  dec(p.contd4CapacityMw),
            capacityMonth:    '2026-04',
            status:           'CLEARED',
          },
        },
        phases: {
          create: p.phases.map(ph => ({
            sourceType:         ph.sourceType,
            capacityAppliedMw:  ph.capacityAppliedMw ?? 0,
            ftcCompletedMw:     dec(ph.ftcCompletedMw),
            ftcCompletedDate:   d(ph.ftcCompletedDate),
            proposedFtcDate:    d(ph.proposedFtcDate),
            capacityUnderFtcMw: dec(ph.capacityUnderFtcMw),
            tocIssuedMw:        dec(ph.tocIssuedMw),
            tocIssuedDate:      d(ph.tocIssuedDate),
            capacityUnderTocMw: dec(ph.capacityUnderTocMw),
            codDeclaredMw:      dec(ph.codDeclaredMw),
            codDeclaredDate:    d(ph.codDeclaredDate),
            expectedApr26Mw:    dec(ph.expectedApr26Mw),
            delayRemarks:       ph.delayRemarks,
            otherRemarks:       ph.otherRemarks,
          })),
        },
      },
    });
    ftcCount++;
    phaseCount += p.phases.length;
  }
  console.log(`  ✓ ${ftcCount} FTC projects inserted (${phaseCount} phases)`);

  // ── Step 4: Insert Transmission Elements ────────────────────────────────
  console.log('\nInserting transmission elements...');
  let txCount = 0;
  for (const t of seedData.transElements) {
    const regionId = REGION[t.region];
    if (!regionId) { console.warn('  ⚠ Unknown region:', t.region); continue; }

    await prisma.transmissionElement.create({
      data: {
        regionId,
        agencyOwner:       t.agencyOwner,
        elementName:       t.elementName,
        elementType:       t.elementType,
        isRe:              t.isRe,
        voltageRatingKv:   t.voltageRatingKv,
        capacityMva:       dec(t.capacityMva),
        lineLengthKm:      dec(t.lineLengthKm),
        firstEnergyDate:   d(t.firstEnergyDate),
        pendingFtc:        t.pendingFtc,
        proposedFtcDate:   d(t.proposedFtcDate),
        capacityApr26Mva:  dec(t.capacityApr26Mva),
        lineLengthApr26Km: dec(t.lineLengthApr26Km),
        remarks:           t.remarks,
      },
    });
    txCount++;
  }
  console.log(`  ✓ ${txCount} transmission elements inserted`);

  // ── Summary ──────────────────────────────────────────────────────────────
  const [gp, c4, cp, tx, ps] = await Promise.all([
    prisma.generationProject.count(),
    prisma.contd4Application.count(),
    prisma.commissioningPhase.count(),
    prisma.transmissionElement.count(),
    prisma.poolingStation.count(),
  ]);
  console.log('\n=== Database Summary ===');
  console.log(`  GenerationProject:    ${gp}`);
  console.log(`  Contd4Application:    ${c4}`);
  console.log(`  CommissioningPhase:   ${cp}`);
  console.log(`  TransmissionElement:  ${tx}`);
  console.log(`  PoolingStation:       ${ps}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
