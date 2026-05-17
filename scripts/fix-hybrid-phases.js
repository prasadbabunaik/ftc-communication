#!/usr/bin/env node
/**
 * Fix hybrid project commissioning phases that were seeded with the wrong
 * source type or with the full hybrid capacity in a single phase instead of
 * one phase per source component.
 *
 * Projects fixed here (all WR):
 *   1. AGE26BL Khavda PSS10       (298 MW Hybrid Wind+Solar)
 *   2. Ayana Power Four at Devasar (129.9 MW Hybrid Wind+Solar)
 *   3. AMPIN ENERGY GREEN TEN      (155 MW Hybrid Wind+Solar)
 *
 * For each project:
 *   - Deletes the existing wrong phase(s) (cascade-deletes all events)
 *   - Creates correct SOLAR and WIND phases with per-event records
 *   - Refreshes summary cache fields on each new phase
 *
 * Safe to re-run — skips projects that already have correctly split phases.
 *
 * Run:  node scripts/fix-hybrid-phases.js [--dry]
 */

require('dotenv').config({ path: '.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry');

// ─── PROJECT FIX DEFINITIONS ────────────────────────────────────────────────────
// Each entry defines the correct per-source phases with their events.

const FIXES = [
  {
    projectId: 'cmp8lsg6m008vfne4rpwd3sgd',
    name: 'AGE26BL Khavda PSS10',
    windCapacityMw: 156,
    solarCapacityMw: 142,
    bessCapacityMw: 0,
    // One phase per source type; events are the ground truth
    phases: [
      {
        sourceType: 'SOLAR',
        capacityAppliedMw: 142,
        ftcEvents: [{ mw: 142, date: '2026-03-09' }],
        tocEvents: [{ mw: 142, date: '2026-03-17' }],
        codEvents: [
          { mw: 50,   date: '2025-09-16' },
          { mw: 50,   date: '2025-11-27' },
          { mw: 25,   date: '2025-12-29' },
          { mw: 17,   date: '2026-03-18' },
        ],
      },
      {
        sourceType: 'WIND',
        capacityAppliedMw: 156,
        ftcEvents: [{ mw: 156, date: '2026-03-09' }],
        tocEvents: [{ mw: 156, date: '2026-03-17' }],
        codEvents: [
          { mw: 52,   date: '2025-06-17' },
          { mw: 67.6, date: '2025-06-30' },
          { mw: 26,   date: '2025-08-01' },
          { mw: 10.4, date: '2026-03-18' },
        ],
      },
    ],
  },
  {
    projectId: 'cmp8lsg7000a3fne4prnu31i8',
    name: 'Ayana Power Four Private Limited at Devasar',
    windCapacityMw: 92.4,
    solarCapacityMw: 37.5,
    bessCapacityMw: 0,
    phases: [
      {
        sourceType: 'WIND',
        capacityAppliedMw: 92.4,
        ftcEvents: [{ mw: 92.4, date: '2025-07-10' }],
        tocEvents: [{ mw: 92.4, date: '2026-03-31' }],
        codEvents: [
          { mw: 52.8, date: '2025-08-19' },
          { mw: 9.9,  date: '2025-09-22' },
          { mw: 9.9,  date: '2025-10-23' },
          { mw: 6.6,  date: '2025-12-09' },
          { mw: 13.2, date: '2026-03-31' },
        ],
      },
      {
        sourceType: 'SOLAR',
        capacityAppliedMw: 37.5,
        ftcEvents: [{ mw: 37.5, date: '2025-07-10' }],
        tocEvents: [{ mw: 37.5, date: '2026-03-31' }],
        codEvents: [
          { mw: 25,   date: '2025-09-25' },
          { mw: 12.5, date: '2025-10-15' },
        ],
      },
    ],
  },
  {
    projectId: 'cmp8lsg69007nfne4c5az3dtu',
    name: 'AMPIN ENERGY GREEN TEN PRIVATE LIMITED (AEG10PL)',
    windCapacityMw: 40.95,
    solarCapacityMw: 114.4,
    bessCapacityMw: 0,
    phases: [
      {
        sourceType: 'SOLAR',
        capacityAppliedMw: 114.4,
        // FTC date was seeded as 2026-12-02 (future) — corrected to 2025-12-02
        ftcEvents: [{ mw: 114.4, date: '2025-12-02' }],
        tocEvents: [{ mw: 114.4, date: '2026-03-27' }],
        codEvents: [{ mw: 114.4, date: '2026-04-04' }],
      },
      {
        sourceType: 'WIND',
        capacityAppliedMw: 40.95,
        ftcEvents: [{ mw: 40.95, date: '2025-12-02' }],
        tocEvents: [{ mw: 40.95, date: '2026-03-27' }],
        // COD from Excel is 40.4 MW (slightly less than applied 40.95 MW)
        codEvents: [{ mw: 40.4, date: '2026-04-04' }],
      },
    ],
  },
];

// ─── HELPERS ────────────────────────────────────────────────────────────────────

function evSum(evs) {
  return evs.reduce((s, e) => s + e.mw, 0);
}

function latestDate(evs) {
  if (!evs.length) return null;
  return evs.map(e => new Date(e.date)).reduce((max, d) => (d > max ? d : max));
}

async function refreshCache(phaseId) {
  const [ftc, toc, cod] = await Promise.all([
    prisma.ftcEvent.findMany({ where: { phaseId }, orderBy: { eventDate: 'asc' } }),
    prisma.tocEvent.findMany({ where: { phaseId }, orderBy: { eventDate: 'asc' } }),
    prisma.codEvent.findMany({ where: { phaseId }, orderBy: { eventDate: 'asc' } }),
  ]);
  const sum = (rows) => rows.reduce((s, r) => s + Number(r.capacityMw || 0), 0);
  const last = (rows) => (rows.length ? rows[rows.length - 1].eventDate : null);
  const ftcT = sum(ftc), tocT = sum(toc), codT = sum(cod);
  await prisma.commissioningPhase.update({
    where: { id: phaseId },
    data: {
      ftcCompletedMw:       ftcT > 0 ? ftcT : null,
      ftcCompletedDate:     last(ftc),
      tocIssuedMw:          tocT > 0 ? tocT : null,
      tocIssuedDate:        last(toc),
      codDeclaredMw:        codT > 0 ? codT : null,
      codDeclaredDate:      last(cod),
      capacityPendingCodMw: Math.max(0, tocT - codT) > 0 ? Math.max(0, tocT - codT) : null,
    },
  });
}

// ─── MAIN ────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Mode: ${DRY ? 'DRY RUN' : 'WRITE'}\n`);

  for (const fix of FIXES) {
    console.log(`\n=== ${fix.name} (${fix.projectId}) ===`);

    const project = await prisma.generationProject.findUnique({
      where: { id: fix.projectId },
      include: { phases: { include: { ftcEvents: true, tocEvents: true, codEvents: true } } },
    });

    if (!project) {
      console.log('  [SKIP] Project not found in DB');
      continue;
    }

    // Already fixed: has one phase per each source type in the fix definition
    const fixSources = new Set(fix.phases.map(p => p.sourceType));
    const existingSources = new Set(project.phases.map(p => p.sourceType));
    const alreadyFixed = [...fixSources].every(s => existingSources.has(s)) && existingSources.size === fixSources.size;

    if (alreadyFixed) {
      console.log('  [SKIP] Already has correct phases:', [...existingSources].join(', '));
      continue;
    }

    console.log(`  Existing phases: ${project.phases.map(p => `${p.sourceType} ${Number(p.capacityAppliedMw)} MW`).join(', ')}`);
    console.log(`  Will create: ${fix.phases.map(p => `${p.sourceType} ${p.capacityAppliedMw} MW`).join(', ')}`);

    if (DRY) {
      console.log('  [DRY] Would delete', project.phases.length, 'phases and recreate', fix.phases.length);
      continue;
    }

    // 1. Update project capacity fields
    await prisma.generationProject.update({
      where: { id: fix.projectId },
      data: {
        windCapacityMw:  fix.windCapacityMw  > 0 ? fix.windCapacityMw  : null,
        solarCapacityMw: fix.solarCapacityMw > 0 ? fix.solarCapacityMw : null,
        bessCapacityMw:  fix.bessCapacityMw  > 0 ? fix.bessCapacityMw  : null,
      },
    });
    console.log(`  Set Wind:${fix.windCapacityMw} Solar:${fix.solarCapacityMw} BESS:${fix.bessCapacityMw} MW on project`);

    // 2. Delete existing phases (cascade-deletes all FTC/TOC/COD events)
    for (const ph of project.phases) {
      await prisma.commissioningPhase.delete({ where: { id: ph.id } });
      console.log(`  Deleted phase: ${ph.sourceType} ${Number(ph.capacityAppliedMw)} MW (id: ${ph.id})`);
    }

    // 3. Create correct phases with events
    for (const phDef of fix.phases) {
      const ftcT = evSum(phDef.ftcEvents);
      const tocT = evSum(phDef.tocEvents);
      const codT = evSum(phDef.codEvents);

      const newPhase = await prisma.commissioningPhase.create({
        data: {
          projectId:         fix.projectId,
          sourceType:        phDef.sourceType,
          capacityAppliedMw: phDef.capacityAppliedMw,
          ftcCompletedMw:    ftcT > 0 ? ftcT : null,
          ftcCompletedDate:  latestDate(phDef.ftcEvents),
          tocIssuedMw:       tocT > 0 ? tocT : null,
          tocIssuedDate:     latestDate(phDef.tocEvents),
          codDeclaredMw:     codT > 0 ? codT : null,
          codDeclaredDate:   latestDate(phDef.codEvents),
          capacityPendingCodMw: Math.max(0, tocT - codT) > 0 ? Math.max(0, tocT - codT) : null,
        },
      });

      // Create events
      if (phDef.ftcEvents.length) {
        await prisma.ftcEvent.createMany({
          data: phDef.ftcEvents.map(e => ({ phaseId: newPhase.id, eventDate: new Date(e.date), capacityMw: e.mw })),
        });
      }
      if (phDef.tocEvents.length) {
        await prisma.tocEvent.createMany({
          data: phDef.tocEvents.map(e => ({ phaseId: newPhase.id, eventDate: new Date(e.date), capacityMw: e.mw })),
        });
      }
      if (phDef.codEvents.length) {
        await prisma.codEvent.createMany({
          data: phDef.codEvents.map(e => ({ phaseId: newPhase.id, eventDate: new Date(e.date), capacityMw: e.mw })),
        });
      }

      console.log(`  Created ${phDef.sourceType} phase ${phDef.capacityAppliedMw} MW — FTC:${ftcT} TOC:${tocT} COD:${codT} MW`);
    }
  }

  console.log('\nDone.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
