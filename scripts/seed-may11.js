#!/usr/bin/env node
/**
 * Wipe ops data and seed FTC Communication DB from May 11 Excel snapshot.
 *
 * Inputs (produced by Python extractors):
 *   scripts/seed-may11.json    — projects, phases, transmission
 *   scripts/events-may11.json  — per-date FTC/TOC/COD events
 *
 * Run:  node scripts/seed-may11.js
 *
 * Semantics for events:
 *   - Events are inserted on the project's first phase. Hybrid splits across
 *     source types are NOT auto-resolved — the user can re-assign in the UI.
 *   - Legacy `ftcCompletedMw / tocIssuedMw / codDeclaredMw` keep the Excel
 *     totals (col 10/12/14) so dashboards match the source spreadsheet from
 *     day one. Future edits via server actions will realign legacy = SUM(events).
 */

require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

const SEED_FILE   = path.join(__dirname, 'seed-may11.json');
const EVENTS_FILE = path.join(__dirname, 'events-may11.json');

// ── Helpers ──────────────────────────────────────────────────────────────────
const d = (v) => {
  if (v == null) return null;
  if (v instanceof Date) return v;
  const s = String(v);
  return new Date(s + (s.length === 10 ? 'T00:00:00Z' : ''));
};
const dec = (v) => (v != null ? parseFloat(v) : null);

function normalizeName(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/[\s.,()\-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getOrCreatePoolingStation(name, regionId, cache) {
  if (!name) return null;
  const key = `${regionId}::${name}`;
  if (cache.has(key)) return cache.get(key);
  let row = await prisma.poolingStation.findFirst({ where: { name, regionId } });
  if (!row) row = await prisma.poolingStation.create({ data: { name, regionId } });
  cache.set(key, row.id);
  return row.id;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Reading seed inputs…');
  const seed   = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  const events = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));

  console.log(`  CONTD-4 projects: ${seed.contd4Projects.length}`);
  console.log(`  FTC projects:     ${seed.ftcProjects.length}`);
  console.log(`  Transmission:     ${seed.transElements.length}`);
  console.log(`  Event rows:       ${events.rows.length}`);

  // Admin user — required for createdById on projects
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (!admin) throw new Error('No ADMIN user — seed users first.');
  const ADMIN_ID = admin.id;

  // Resolve region + plant-type IDs by code
  const regions = await prisma.gridRegion.findMany();
  const REGION = Object.fromEntries(regions.map((r) => [r.code, r.id]));
  const plantTypes = await prisma.plantType.findMany();
  const PT = Object.fromEntries(plantTypes.map((p) => [p.code, p.id]));
  if (!PT.SOLAR || !REGION.NR) throw new Error('Master data missing.');

  // ── Wipe operational data ──────────────────────────────────────────────────
  console.log('\nWiping operational data…');
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
    prisma.gridSnapshot.deleteMany(),
  ]);
  console.log('  ✓ All ops tables emptied');

  // ── Insert CONTD-4 projects ────────────────────────────────────────────────
  const psCache = new Map();
  console.log('\nInserting CONTD-4 projects…');
  let c4Count = 0;
  for (const p of seed.contd4Projects) {
    const regionId = REGION[p.region];
    if (!regionId) { console.warn('  ⚠ Unknown region', p.region, p.name); continue; }
    const plantId = PT[p.plantTypeCode] || PT.SOLAR;
    const psId = await getOrCreatePoolingStation(p.poolingStation, regionId, psCache);
    await prisma.generationProject.create({
      data: {
        name:             p.name,
        regionId,
        plantTypeId:      plantId,
        poolingStationId: psId,
        totalCapacityMw:  p.totalCapacityMw ?? 0,
        createdById:      ADMIN_ID,
        contd4: {
          create: {
            applicationDate: d(p.applicationDate) ?? new Date('2025-01-01T00:00:00Z'),
            proposedFtcDate: d(p.proposedFtcDate),
            capacityApr26Mw: dec(p.capacityApr26Mw),
            capacityMonth:   p.capacityMonth || null,
            status:          'PENDING',
            remarks:         p.remarks || null,
            remarksUpdatedAt: p.remarks ? new Date() : null,
          },
        },
      },
    });
    c4Count++;
  }
  console.log(`  ✓ ${c4Count} CONTD-4 projects inserted`);

  // ── Insert FTC projects with phases ────────────────────────────────────────
  console.log('\nInserting FTC projects + phases…');
  let ftcCount = 0, phaseCount = 0;
  for (const p of seed.ftcProjects) {
    const regionId = REGION[p.region];
    if (!regionId) { console.warn('  ⚠ Unknown region', p.region, p.name); continue; }
    const plantId = PT[p.plantTypeCode] || PT.SOLAR;
    const psId = await getOrCreatePoolingStation(p.poolingStation, regionId, psCache);
    await prisma.generationProject.create({
      data: {
        name:             p.name,
        regionId,
        plantTypeId:      plantId,
        poolingStationId: psId,
        totalCapacityMw:  p.totalCapacityMw ?? 0,
        createdById:      ADMIN_ID,
        contd4: {
          create: {
            applicationDate: new Date('2025-01-01T00:00:00Z'),
            capacityApr26Mw: dec(p.contd4CapacityMw),
            capacityMonth:   '2026-04',
            status:          'CLEARED',
          },
        },
        phases: {
          create: p.phases.map((ph) => ({
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
            delayRemarks:       ph.delayRemarks || null,
            otherRemarks:       ph.otherRemarks || null,
          })),
        },
      },
    });
    ftcCount++;
    phaseCount += p.phases.length;
  }
  console.log(`  ✓ ${ftcCount} FTC projects inserted (${phaseCount} phases)`);

  // ── Insert transmission elements ───────────────────────────────────────────
  console.log('\nInserting transmission elements…');
  let txCount = 0;
  for (const t of seed.transElements) {
    const regionId = REGION[t.region];
    if (!regionId) { console.warn('  ⚠ Unknown region', t.region); continue; }
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
        remarks:           t.remarks || null,
      },
    });
    txCount++;
  }
  console.log(`  ✓ ${txCount} transmission elements inserted`);

  // ── Insert per-date FTC/TOC/COD events ─────────────────────────────────────
  console.log('\nInserting per-date events on first phase of each matched project…');
  // Index DB phases by (region, normalized name)
  const phases = await prisma.commissioningPhase.findMany({
    include: { project: { include: { region: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const phaseByKey = new Map();
  for (const ph of phases) {
    const key = `${ph.project.region.code}::${normalizeName(ph.project.name)}`;
    if (!phaseByKey.has(key)) phaseByKey.set(key, ph);  // first phase wins (asc order)
  }

  let evFtc = 0, evToc = 0, evCod = 0, evUnmatched = 0;
  for (const row of events.rows) {
    const key = `${row.region}::${normalizeName(row.name)}`;
    const phase = phaseByKey.get(key);
    if (!phase) { evUnmatched++; continue; }

    const ins = async (model, kind, rows) => {
      for (const e of rows) {
        await prisma[model].create({
          data: {
            phaseId:    phase.id,
            eventDate:  new Date(e.date + 'T00:00:00Z'),
            capacityMw: e.mw,
            remarks:    `Seeded from Excel cell · ${e.fragment.slice(0, 90)}`,
          },
        });
        if (kind === 'ftc') evFtc++;
        else if (kind === 'toc') evToc++;
        else if (kind === 'cod') evCod++;
      }
    };
    await ins('ftcEvent', 'ftc', row.ftc_events);
    await ins('tocEvent', 'toc', row.toc_events);
    await ins('codEvent', 'cod', row.cod_events);
  }
  console.log(`  ✓ Events inserted: FTC=${evFtc}  TOC=${evToc}  COD=${evCod}`);
  if (evUnmatched > 0) console.log(`  ⚠ ${evUnmatched} event rows had no matching DB phase (name/region lookup miss)`);

  // ── Summary ────────────────────────────────────────────────────────────────
  const [gp, c4, cp, tx, ps, fe, te, ce] = await Promise.all([
    prisma.generationProject.count(),
    prisma.contd4Application.count(),
    prisma.commissioningPhase.count(),
    prisma.transmissionElement.count(),
    prisma.poolingStation.count(),
    prisma.ftcEvent.count(),
    prisma.tocEvent.count(),
    prisma.codEvent.count(),
  ]);
  console.log('\n══ Database Summary ══');
  console.log(`  GenerationProject:    ${gp}`);
  console.log(`  Contd4Application:    ${c4}`);
  console.log(`  CommissioningPhase:   ${cp}`);
  console.log(`  TransmissionElement:  ${tx}`);
  console.log(`  PoolingStation:       ${ps}`);
  console.log(`  FtcEvent / TocEvent / CodEvent:  ${fe} / ${te} / ${ce}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
