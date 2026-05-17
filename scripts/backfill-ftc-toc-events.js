#!/usr/bin/env node
/**
 * Backfill FtcEvent and TocEvent rows for phases that have ftcCompletedMw /
 * tocIssuedMw + a date on the phase but no individual event records yet.
 *
 * This happens because the Excel source only had a single completion date
 * (no per-date MW breakdown) for FTC/TOC, so the Python parser skipped them.
 * We now create one event per phase using the aggregate total + that date.
 *
 * Safe to re-run — skips phases that already have events.
 *
 * Run:  node scripts/backfill-ftc-toc-events.js
 */

require('dotenv').config({ path: '.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // ── FTC backfill ────────────────────────────────────────────────────────────
  const ftcPhases = await prisma.commissioningPhase.findMany({
    where: {
      ftcCompletedMw:   { not: null, gt: 0 },
      ftcCompletedDate: { not: null },
      ftcEvents:        { none: {} },
    },
    select: {
      id: true,
      ftcCompletedMw: true,
      ftcCompletedDate: true,
      project: { select: { name: true } },
    },
  });

  console.log(`FTC phases to backfill: ${ftcPhases.length}`);
  let ftcCreated = 0;
  for (const ph of ftcPhases) {
    await prisma.ftcEvent.create({
      data: {
        phaseId:    ph.id,
        eventDate:  ph.ftcCompletedDate,
        capacityMw: ph.ftcCompletedMw,
        remarks:    null,
      },
    });
    ftcCreated++;
    console.log(`  FTC  ${ph.project.name}  ${Number(ph.ftcCompletedMw).toFixed(2)} MW  ${ph.ftcCompletedDate.toISOString().slice(0,10)}`);
  }

  // ── TOC backfill ────────────────────────────────────────────────────────────
  const tocPhases = await prisma.commissioningPhase.findMany({
    where: {
      tocIssuedMw:   { not: null, gt: 0 },
      tocIssuedDate: { not: null },
      tocEvents:     { none: {} },
    },
    select: {
      id: true,
      tocIssuedMw: true,
      tocIssuedDate: true,
      project: { select: { name: true } },
    },
  });

  console.log(`\nTOC phases to backfill: ${tocPhases.length}`);
  let tocCreated = 0;
  for (const ph of tocPhases) {
    await prisma.tocEvent.create({
      data: {
        phaseId:    ph.id,
        eventDate:  ph.tocIssuedDate,
        capacityMw: ph.tocIssuedMw,
        remarks:    null,
      },
    });
    tocCreated++;
    console.log(`  TOC  ${ph.project.name}  ${Number(ph.tocIssuedMw).toFixed(2)} MW  ${ph.tocIssuedDate.toISOString().slice(0,10)}`);
  }

  console.log(`\nDone — created ${ftcCreated} FtcEvent + ${tocCreated} TocEvent rows.`);

  // Report phases with MW but no date (can't backfill)
  const noDateFtc = await prisma.commissioningPhase.count({
    where: {
      ftcCompletedMw:   { not: null, gt: 0 },
      ftcCompletedDate: null,
      ftcEvents:        { none: {} },
    },
  });
  const noDateToc = await prisma.commissioningPhase.count({
    where: {
      tocIssuedMw:   { not: null, gt: 0 },
      tocIssuedDate: null,
      tocEvents:     { none: {} },
    },
  });
  if (noDateFtc > 0 || noDateToc > 0) {
    console.log(`\nSkipped (no date recorded): ${noDateFtc} FTC, ${noDateToc} TOC phases.`);
    console.log('These need dates entered manually via the portal.');
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
