#!/usr/bin/env node
/**
 * Rebuild every stored GridSnapshot using a single, consistent computation:
 *
 *   - Historical dates (Apr 23 → May 13): take the Excel-parsed project data
 *     from scripts/snapshots-seed.json and run it through the SAME
 *     `computePipelineMatrix` / `computeContd4Study` / `computeTransmission`
 *     functions used by the live dashboard.
 *
 *   - Today: take a fresh snapshot from the current DB using the same compute
 *     functions.
 *
 * Result: a stable time-series. If no new data is added, snapshots don't
 * drift. A diff between any two snapshots reflects only real differences in
 * the underlying data (Excel content + DB state), not computation drift.
 *
 * Pre-requisite: scripts/snapshots-seed.json must exist (produced by
 * `python3 scripts/seed-snapshots.py`). Re-run that script if you've added
 * new Excels.
 *
 * Usage:  node scripts/rebuild-snapshots.js [--dry]
 */

require('dotenv').config({ path: '.env' });
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const {
  computePipelineMatrix,
  computeContd4Study,
  computeTransmission,
} = require('../lib/grid-computations');

const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry');

// ─── Adapt Excel-parsed records to the shape grid-computations.js expects ───

function buildProject(excelProj, excelContd4ByName, liveContd4ByName) {
  // Prefer the live DB's CONTD-4 capacity (it's the canonical value carried
  // forward when the application was CLEARED) — Excels don't carry this
  // column for the FTC section, so without this we'd see phantom 0→X diffs.
  const live = liveContd4ByName.get(excelProj.name);
  const c4   = excelContd4ByName.get(excelProj.name);
  return {
    name:             excelProj.name,
    region:           { code: excelProj.region },
    plantType:        { isHybrid: (excelProj.plantTypeCode ?? '').startsWith('HYBRID'), label: excelProj.plantTypeCode },
    totalCapacityMw:  excelProj.totalCapacityMw,
    contd4:           { capacityApr26Mw: live?.capacityApr26Mw ?? c4?.capacityApr26Mw ?? 0, capacityMonth: live?.capacityMonth ?? c4?.capacityMonth ?? null, status: 'CLEARED' },
    phases: (excelProj.phases ?? []).map(ph => ({
      sourceType:           ph.sourceType,
      capacityAppliedMw:    ph.capacityAppliedMw,
      ftcCompletedMw:       ph.ftcCompletedMw,
      ftcCompletedDate:     ph.ftcCompletedDate,
      tocIssuedMw:          ph.tocIssuedMw,
      tocIssuedDate:        ph.tocIssuedDate,
      codDeclaredMw:        ph.codDeclaredMw,
      codDeclaredDate:      ph.codDeclaredDate,
      capacityUnderFtcMw:   ph.capacityUnderFtcMw,
      capacityUnderTocMw:   ph.capacityUnderTocMw,
      expectedApr26Mw:      ph.expectedApr26Mw,
      // No per-event detail in the Excel — pass empty arrays. computePipelineMatrix
      // will fall back to the cached summary fields when no asOf is passed.
      ftcEvents: [], tocEvents: [], codEvents: [],
    })),
  };
}

function buildContd4Project(c4) {
  return {
    name:            c4.name,
    region:          { code: c4.region },
    plantType:       { isHybrid: (c4.plantTypeCode ?? '').startsWith('HYBRID'), label: c4.plantTypeCode },
    totalCapacityMw: c4.totalCapacityMw,
    contd4: {
      capacityApr26Mw: c4.capacityApr26Mw,
      capacityMonth:   c4.capacityMonth,
      status:          'PENDING',
    },
    phases: [],
  };
}

function buildTxElement(tx) {
  return {
    region:            { code: tx.region },
    elementName:       tx.elementName,
    elementType:       tx.elementType,
    isRe:              tx.isRe,
    capacityMva:       tx.capacityMva,
    lineLengthKm:      tx.lineLengthKm,
    pendingFtc:        tx.pendingFtc,
    capacityApr26Mva:  tx.capacityApr26Mva,
    lineLengthApr26Km: tx.lineLengthApr26Km,
  };
}

// ─── Compute t1/t2/t3 from Excel-parsed records using the shared lib ────────

function computeFromExcel(snap, liveContd4ByName) {
  const c4ByName = new Map((snap.details?.contd4 ?? []).map(c => [c.name, c]));

  // For pipeline (FTC) compute: use the FTC projects + attach contd4 if same name
  const ftcProjects = (snap.details?.projects ?? []).map(p => buildProject(p, c4ByName, liveContd4ByName));

  // For CONTD-4 study, include projects that ONLY appear in the contd4 list (no FTC entry)
  const seenInFtc = new Set(ftcProjects.map(p => p.name));
  const extraContd4 = (snap.details?.contd4 ?? [])
    .filter(c => !seenInFtc.has(c.name))
    .map(buildContd4Project);
  const c4Projects = [...ftcProjects, ...extraContd4];

  const txElements = (snap.details?.tx ?? []).map(buildTxElement);

  // No asOf — the Excel already represents the point-in-time view for `snap.date`,
  // so the cached summary fields (ftcCompletedMw, etc.) are the source of truth.
  const t2 = computePipelineMatrix(ftcProjects, null);
  const { rows: c1Rows, allMonths } = computeContd4Study(c4Projects);
  const t3 = computeTransmission(txElements);
  return { t1: { rows: c1Rows, allMonths }, t2, t3 };
}

// ─── Today's snapshot — from current DB ─────────────────────────────────────

async function computeFromCurrentDb() {
  const [projects, txElements] = await Promise.all([
    prisma.generationProject.findMany({
      where: { activeUntil: null },
      include: {
        region:    { select: { code: true } },
        plantType: { select: { label: true, isHybrid: true } },
        contd4:    true,
        phases:    { include: { ftcEvents: true, tocEvents: true, codEvents: true } },
      },
    }),
    prisma.transmissionElement.findMany({
      where: { activeUntil: null },
      include: { region: { select: { code: true } } },
    }),
  ]);

  const t2 = computePipelineMatrix(projects, null);
  const { rows: c1Rows, allMonths } = computeContd4Study(projects);
  const t3 = computeTransmission(txElements);
  return { t1: { rows: c1Rows, allMonths }, t2, t3 };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Mode: ${DRY ? 'DRY RUN' : 'WRITE'}\n`);

  const seedPath = path.join(__dirname, 'snapshots-seed.json');
  if (!fs.existsSync(seedPath)) {
    console.error(`Missing ${seedPath}. Run: python3 scripts/seed-snapshots.py first`);
    process.exit(1);
  }
  const excelSnaps = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  console.log(`Excel-derived snapshots: ${excelSnaps.length}`);

  // Live DB CONTD-4 capacities keyed by project name — used to fill in the
  // contd4CapacityMw column for Excel snapshots (which don't carry it).
  const liveProjects = await prisma.generationProject.findMany({
    select: { name: true, contd4: { select: { capacityApr26Mw: true, capacityMonth: true } } },
  });
  const liveContd4ByName = new Map(
    liveProjects
      .filter(p => p.contd4)
      .map(p => [p.name, { capacityApr26Mw: Number(p.contd4.capacityApr26Mw ?? 0), capacityMonth: p.contd4.capacityMonth }])
  );

  // 1. Rebuild each Excel-derived snapshot
  for (const snap of excelSnaps) {
    const { t1, t2, t3 } = computeFromExcel(snap, liveContd4ByName);
    const cells = Object.keys(t2).length;
    const txCells = Object.keys(t3).length;
    console.log(`  ${snap.date} → t1 rows: ${t1.rows.length}, t2 cells: ${cells}, t3 cells: ${txCells}`);

    if (DRY) continue;

    const snapshotDate = new Date(snap.date + 'T00:00:00Z');
    await prisma.gridSnapshot.upsert({
      where: { snapshotDate },
      create: { snapshotDate, label: snap.label, t1Json: t1, t2Json: t2, t3Json: t3 },
      update: {                  label: snap.label, t1Json: t1, t2Json: t2, t3Json: t3 },
    });
  }

  // 2. Refresh today's snapshot from current DB
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  console.log(`\nRefreshing today's snapshot (${todayStr}) from current DB...`);

  const { t1, t2, t3 } = await computeFromCurrentDb();
  console.log(`  t1 rows: ${t1.rows.length}, t2 cells: ${Object.keys(t2).length}, t3 cells: ${Object.keys(t3).length}`);

  if (!DRY) {
    await prisma.gridSnapshot.upsert({
      where: { snapshotDate: today },
      create: { snapshotDate: today, label: null, t1Json: t1, t2Json: t2, t3Json: t3 },
      update: {                       label: null, t1Json: t1, t2Json: t2, t3Json: t3 },
    });
  }

  console.log('\nDone.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
