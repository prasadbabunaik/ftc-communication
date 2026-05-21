#!/usr/bin/env node
// Seed the May 21, 2026 baseline into the DB.
// Reads scripts/seed-may21.json (produced by extract-may21.py) and writes:
//   • GenerationProject rows
//   • Contd4Application — CLEARED for projects in the FTC table,
//     PENDING for CONTD-4-only projects
//   • CommissioningPhase per FTC project (source from the Excel row)
//   • At-most-one FtcEvent / TocEvent / CodEvent per phase, dated from the
//     Excel's single milestone-date columns
//   • TransmissionElement rows (LINE / ICT only — GT/ST aren't tracked by
//     computeTransmission anyway, mirroring seed-apr30 behaviour)
//   • One GridSnapshot for 2026-05-21
//
// Usage:  node scripts/seed-may21.js
require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const ADMIN_ID = 'cmoco2ex90000yee3g184srfl';
const SNAP_DATE = new Date('2026-05-21T00:00:00Z');

// IDs sourced live from this DB — masters are stable, so they're safe to
// hard-code at the top of the script.
const REGION = {
  SR:  'cmogzdsei0007yeu5un5mm5p0',
  NR:  'cmogzdsem0008yeu5lypatweo',
  WR:  'cmogzdseo0009yeu5zmheo8dy',
  ER:  'cmogzdseq000ayeu576449e4l',
  NER: 'cmogzdses000byeu5pbv3ypdj',
};
const PT = {
  SOLAR:      'cmogzdseu000cyeu513dj90t4',
  WIND:       'cmogzdsf4000dyeu5x8vah7md',
  HYBRID_WS:  'cmogzdsf7000eyeu55txggf6a',
  HYBRID_WSB: 'cmogzdsf9000fyeu5gwxo72yc',
  COAL:       'cmogzdsfa000gyeu55lusaouo',
  HYDRO:      'cmogzdsfc000hyeu50tjn0cz9',
  PSP:        'cmogzdsfh000iyeu5i5600y1p',
  BESS:       'cmogzdsfj000jyeu55ri1unt2',
  HYBRID_SB:  'cmol5vts70000yelpx1nddf81',
  HYBRID_WB:  'cmol5vtse0001yelpv0b3q43i',
  HYBRID_WP:  'cmolbmqty0000yepivwg1x62b',
  HYBRID_HP:  'cmolbmqui0001yepicyxh0g2r',
  HYBRID_SP:  'cmp3qfv9i0000ye0fna9pfc97',
};

const dec  = (v) => (v == null || isNaN(parseFloat(v)) ? null : parseFloat(v));
const date = (v) => (v ? new Date(v + (v.length === 10 ? 'T00:00:00Z' : '')) : null);

async function getOrCreatePoolingStation(name, regionCode) {
  if (!name) return null;
  const regionId = REGION[regionCode];
  if (!regionId) return null;
  const found = await prisma.poolingStation.findFirst({ where: { name, regionId } });
  if (found) return found.id;
  const made = await prisma.poolingStation.create({ data: { name, regionId } });
  return made.id;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed-may21.json'), 'utf8'));
  const { contd4: contd4Rows, ftc: ftcRows, tx: txRows } = data;
  console.log(`Loaded: ${contd4Rows.length} CONTD-4, ${ftcRows.length} FTC, ${txRows.length} TX`);

  // Index CONTD-4 entries by trimmed name for matching against FTC rows
  // (so projects that appear in both tables get the CONTD-4 capacity
  // attached to their CLEARED contd4 record).
  const contd4ByName = new Map();
  for (const c of contd4Rows) contd4ByName.set(c.name.trim().toUpperCase(), c);

  // ── Step 1: FTC-stage projects (CLEARED CONTD-4 + phase + events) ────────
  let ftcCreated = 0;
  for (const p of ftcRows) {
    const regionId = REGION[p.region];
    const plantTypeId = PT[p.plantTypeCode] ?? PT.SOLAR;
    if (!regionId) { console.warn(`  skip ${p.name}: unknown region ${p.region}`); continue; }
    const poolingStationId = await getOrCreatePoolingStation(p.poolingStation, p.region);

    const c4Match = contd4ByName.get(p.name.trim().toUpperCase());
    const proj = await prisma.generationProject.create({
      data: {
        name: p.name,
        regionId,
        plantTypeId,
        poolingStationId,
        totalCapacityMw: dec(p.totalCapacityMw) ?? 0,
        createdById: ADMIN_ID,
        contd4: {
          create: {
            // CLEARED with a placeholder application date — original date is
            // unknown for legacy projects (matches the earlier IBVSSPL flow).
            applicationDate: null,
            capacityApr26Mw: c4Match ? dec(c4Match.capacityApr26Mw) : null,
            capacityMonth:   c4Match?.capacityMonth ?? null,
            status:          'CLEARED',
            remarks:         'Seeded from 21 May 2026 baseline',
          },
        },
      },
    });

    for (const ph of (p.phases ?? [])) {
      const ftcMw = dec(ph.ftcCompletedMw) || 0;
      const tocMw = dec(ph.tocIssuedMw)    || 0;
      const codMw = dec(ph.codDeclaredMw)  || 0;
      const phase = await prisma.commissioningPhase.create({
        data: {
          projectId:         proj.id,
          sourceType:        ph.sourceType,
          capacityAppliedMw: dec(ph.capacityAppliedMw) ?? 0,
          ftcCompletedMw:    ftcMw > 0 ? ftcMw : null,
          ftcCompletedDate:  date(ph.ftcCompletedDate),
          proposedFtcDate:   date(ph.proposedFtcDate),
          capacityUnderFtcMw: dec(ph.capacityUnderFtcMw),
          tocIssuedMw:       tocMw > 0 ? tocMw : null,
          tocIssuedDate:     date(ph.tocIssuedDate),
          capacityUnderTocMw: dec(ph.capacityUnderTocMw),
          codDeclaredMw:     codMw > 0 ? codMw : null,
          codDeclaredDate:   date(ph.codDeclaredDate),
          expectedApr26Mw:   dec(ph.expectedApr26Mw),
          expectedMonth:     '2026-05',
        },
      });
      // Single-event approximation: the Excel collapses partial commissioning
      // into one MW + one date per milestone. Per-date breakdowns can be
      // added later via the project edit modal.
      if (ftcMw > 0 && ph.ftcCompletedDate) {
        await prisma.ftcEvent.create({ data: { phaseId: phase.id, capacityMw: ftcMw, eventDate: date(ph.ftcCompletedDate) } });
      }
      if (tocMw > 0 && ph.tocIssuedDate) {
        await prisma.tocEvent.create({ data: { phaseId: phase.id, capacityMw: tocMw, eventDate: date(ph.tocIssuedDate) } });
      }
      if (codMw > 0 && ph.codDeclaredDate) {
        await prisma.codEvent.create({ data: { phaseId: phase.id, capacityMw: codMw, eventDate: date(ph.codDeclaredDate) } });
      }
    }
    ftcCreated++;
  }
  console.log(`  ✓ FTC projects created: ${ftcCreated}`);

  // ── Step 2: CONTD-4-only projects (PENDING, no phase) ────────────────────
  // Skip any whose name matched an FTC row (already created with CLEARED).
  const ftcNames = new Set(ftcRows.map((p) => p.name.trim().toUpperCase()));
  let contd4OnlyCreated = 0;
  for (const c of contd4Rows) {
    if (ftcNames.has(c.name.trim().toUpperCase())) continue;
    const regionId = REGION[c.region];
    const plantTypeId = PT[c.plantTypeCode] ?? PT.SOLAR;
    if (!regionId) continue;
    const poolingStationId = await getOrCreatePoolingStation(c.poolingStation, c.region);
    await prisma.generationProject.create({
      data: {
        name: c.name,
        regionId,
        plantTypeId,
        poolingStationId,
        totalCapacityMw: dec(c.totalCapacityMw) ?? 0,
        createdById: ADMIN_ID,
        contd4: {
          create: {
            applicationDate: null,
            capacityApr26Mw: dec(c.capacityApr26Mw),
            capacityMonth:   c.capacityMonth ?? null,
            status:          'PENDING',
            remarks:         'Seeded from 21 May 2026 baseline (CONTD-4 under study)',
          },
        },
      },
    });
    contd4OnlyCreated++;
  }
  console.log(`  ✓ CONTD-4-only projects created: ${contd4OnlyCreated}`);

  // ── Step 3: Transmission elements ────────────────────────────────────────
  let txCreated = 0;
  for (const t of txRows) {
    const regionId = REGION[t.region];
    if (!regionId) continue;
    await prisma.transmissionElement.create({
      data: {
        regionId,
        agencyOwner:        'Unknown',          // not present in extractor
        elementName:        t.elementName,
        elementType:        t.elementType,
        isRe:               !!t.isRe,
        capacityMva:        dec(t.capacityMva),
        lineLengthKm:       dec(t.lineLengthKm),
        firstEnergyDate:    null,
        pendingFtc:         !!t.pendingFtc,
        proposedFtcDate:    null,
        capacityApr26Mva:   dec(t.capacityApr26Mva),
        lineLengthApr26Km:  dec(t.lineLengthApr26Km),
      },
    });
    txCreated++;
  }
  console.log(`  ✓ TX elements created: ${txCreated}`);

  // ── Step 4: Snapshot — handled separately via the Python/JS snapshot
  // pipeline (see CALLER NOTE at bottom).
  console.log('  ✓ Data seeded. Snapshot to be produced separately.');

  // ── Summary ──────────────────────────────────────────────────────────────
  const counts = {
    projects:           await prisma.generationProject.count(),
    contd4Applications: await prisma.contd4Application.count(),
    phases:             await prisma.commissioningPhase.count(),
    ftcEvents:          await prisma.ftcEvent.count(),
    tocEvents:          await prisma.tocEvent.count(),
    codEvents:          await prisma.codEvent.count(),
    tx:                 await prisma.transmissionElement.count(),
    snapshots:          await prisma.gridSnapshot.count(),
  };
  console.log('\nFinal counts:', counts);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); }).finally(() => prisma.$disconnect());
