#!/usr/bin/env node
// One-time cleanup after the milestoneAsOf date-gating fix.
//
//   1. Resync each CommissioningPhase's cached summary fields
//      (ftcCompletedMw/tocIssuedMw/codDeclaredMw + dates + pending) to the
//      SUM / latest-date of its actual events — same logic as
//      refreshCommissioningCache() in app/actions/grid.js. Only phases that
//      HAVE events are touched; event-less phases keep their cached MW (the
//      milestoneAsOf fallback still counts those).
//   2. Recompute every stored GridSnapshot in place using the fixed
//      event-gated logic, so the day-wise comparison no longer diffs a stale
//      "today" snapshot against event-replayed history.
//
// Usage:  node scripts/resync-and-rebaseline.js
require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const {
  computePipelineMatrix,
  computeContd4Study,
  computeTransmission,
} = require('../lib/grid-computations');

const prisma = new PrismaClient();

async function resyncCachedFields() {
  const phases = await prisma.commissioningPhase.findMany({
    include: { ftcEvents: true, tocEvents: true, codEvents: true },
  });
  const sum = (rows) => rows.reduce((s, r) => s + Number(r.capacityMw || 0), 0);
  const latest = (rows) => {
    if (!rows.length) return null;
    return rows.reduce((m, r) => (r.eventDate > m ? r.eventDate : m), rows[0].eventDate);
  };

  let touched = 0;
  for (const ph of phases) {
    const nEvents = ph.ftcEvents.length + ph.tocEvents.length + ph.codEvents.length;
    if (nEvents === 0) continue;  // preserve event-less cached MW

    const ftcTotal = sum(ph.ftcEvents);
    const tocTotal = sum(ph.tocEvents);
    const codTotal = sum(ph.codEvents);

    await prisma.commissioningPhase.update({
      where: { id: ph.id },
      data: {
        ftcCompletedMw:       ftcTotal > 0 ? ftcTotal : null,
        ftcCompletedDate:     latest(ph.ftcEvents),
        tocIssuedMw:          tocTotal > 0 ? tocTotal : null,
        tocIssuedDate:        latest(ph.tocEvents),
        codDeclaredMw:        codTotal > 0 ? codTotal : null,
        codDeclaredDate:      latest(ph.codEvents),
        capacityPendingCodMw: Math.max(0, tocTotal - codTotal) > 0 ? Math.max(0, tocTotal - codTotal) : null,
      },
    });
    touched++;
  }
  console.log(`  ✓ Resynced ${touched} phase(s) with events (of ${phases.length} total)`);
}

// Replays projects + TX as of `asOf` (events gated by eventDate ≤ asOf) and
// computes the three matrices — mirrors computeMatricesAsOf in
// lib/snapshot-rebuild.js, inlined here so the script stays CJS-requireable.
async function computeMatricesAsOf(asOf) {
  const [rawProjects, txElements, statusNotes] = await Promise.all([
    prisma.generationProject.findMany({
      where: { OR: [{ activeUntil: null }, { activeUntil: { gt: asOf } }] },
      include: {
        region:         { select: { code: true } },
        plantType:      { select: { label: true, isHybrid: true } },
        poolingStation: { select: { name: true } },
        contd4: { include: { phases: { where: { declaredDate: { lte: asOf } } } } },
        phases: {
          include: {
            ftcEvents: { where: { eventDate: { lte: asOf } } },
            tocEvents: { where: { eventDate: { lte: asOf } } },
            codEvents: { where: { eventDate: { lte: asOf } } },
          },
        },
      },
    }),
    prisma.transmissionElement.findMany({
      where: { OR: [{ activeUntil: null }, { activeUntil: { gt: asOf } }] },
      include: { region: { select: { code: true } } },
    }),
    prisma.projectNote.findMany({
      where: { field: 'Status' },
      select: { projectId: true, oldValue: true, newValue: true, createdAt: true, effectiveDate: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  // Replay CONTD-4 status. Projects with Status-note history get the latest
  // transition effective ≤ asOf (or the first note's oldValue if asOf
  // predates all). Projects with NO notes keep their current status.
  const byProject = new Map();
  for (const note of statusNotes) {
    if (!byProject.has(note.projectId)) byProject.set(note.projectId, []);
    byProject.get(note.projectId).push(note);
  }
  const statusByProject = new Map();
  for (const [pid, list] of byProject) {
    let resolved = null;
    for (const n of list) {
      const eff = n.effectiveDate ?? n.createdAt;
      if (eff.getTime() <= asOf.getTime()) resolved = n.newValue;
    }
    if (resolved == null) resolved = list[0].oldValue ?? null;
    if (resolved != null) statusByProject.set(pid, resolved);
  }
  const projects = rawProjects.map((p) => {
    if (!p.contd4) return p;
    const hist = statusByProject.get(p.id);
    if (hist == null) return p;
    return { ...p, contd4: { ...p.contd4, status: hist } };
  });

  const t2 = computePipelineMatrix(projects, asOf);
  const { rows, allMonths } = computeContd4Study(projects);
  const t3 = computeTransmission(txElements);
  return { t1: { rows, allMonths }, t2, t3 };
}

async function rebuildSnapshots() {
  // Recompute every existing snapshot date in place with the fixed logic.
  const snaps = await prisma.gridSnapshot.findMany({
    select: { snapshotDate: true },
    orderBy: { snapshotDate: 'asc' },
  });
  if (!snaps.length) { console.log('  ✓ No snapshots to rebuild'); return; }

  for (const s of snaps) {
    const day = s.snapshotDate;
    const endOfDay = new Date(day); endOfDay.setUTCHours(23, 59, 59, 999);
    const { t1, t2, t3 } = await computeMatricesAsOf(endOfDay);
    await prisma.gridSnapshot.update({
      where: { snapshotDate: day },
      data: { t1Json: t1, t2Json: t2, t3Json: t3 },
    });
  }
  console.log(`  ✓ Rebuilt ${snaps.length} snapshot(s) with fixed event-gating`);
}

async function main() {
  console.log('Resyncing cached summary fields...');
  await resyncCachedFields();
  console.log('Rebuilding snapshots with fixed event-gating...');
  await rebuildSnapshots();
  console.log('Done.');
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); }).finally(() => prisma.$disconnect());
