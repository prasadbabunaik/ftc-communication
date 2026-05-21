#!/usr/bin/env node
/**
 * Backfill from seed-may21.json:
 *   1. Set Contd4Application.capacityApr26Mw on FTC projects (from the
 *      "Total Capacity (MW) for which CONTD4 issued" column of the Excel,
 *      previously skipped by the extractor — every CLEARED row had NULL).
 *   2. Fix GenerationProject.plantTypeId where the extractor's pt_code
 *      now classifies the project differently (e.g. Tehri "Pump Storage"
 *      was misclassified as SOLAR; pt_code now returns PSP).
 *
 * Non-destructive — only updates rows that actually need a change.
 *
 * Run:  node scripts/backfill-may21-contd4-cap.js
 */
require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  const jsonPath = path.join(__dirname, 'seed-may21.json');
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const ftcRows = data.ftc || [];
  console.log(`Loaded ${ftcRows.length} FTC project rows from ${jsonPath}`);

  // Pre-load plant-type masters keyed by code.
  const pts = await prisma.plantType.findMany();
  const ptByCode = new Map(pts.map((p) => [p.code, p.id]));

  // Pre-load all active projects by name.
  const projects = await prisma.generationProject.findMany({
    where: { activeUntil: null },
    select: {
      id: true, name: true, plantTypeId: true,
      contd4: { select: { id: true, capacityApr26Mw: true } },
      plantType: { select: { code: true } },
    },
  });
  const byName = new Map(projects.map((p) => [p.name, p]));

  let capUpdated = 0, capUnchanged = 0;
  let ptUpdated = 0, ptUnchanged = 0;
  let missingProj = 0, missingContd4 = 0;

  for (const p of ftcRows) {
    const dbProj = byName.get(p.name);
    if (!dbProj) { missingProj++; console.warn(`  MISS  ${p.name} — not in DB`); continue; }

    // 1) Reclassify plant type if needed.
    const wantPtId = ptByCode.get(p.plantTypeCode);
    if (!wantPtId) {
      console.warn(`  PT?   ${p.name} — no PlantType row for code ${p.plantTypeCode}`);
    } else if (wantPtId !== dbProj.plantTypeId) {
      await prisma.generationProject.update({
        where: { id: dbProj.id },
        data:  { plantTypeId: wantPtId },
      });
      console.log(`  PT    ${p.name}  ${dbProj.plantType.code} → ${p.plantTypeCode}`);
      ptUpdated++;
    } else {
      ptUnchanged++;
    }

    // 2) Set Contd4Application.capacityApr26Mw if missing or differs.
    if (!dbProj.contd4) { missingContd4++; continue; }
    const want = p.contd4CapacityMw != null ? Number(p.contd4CapacityMw) : null;
    const cur  = dbProj.contd4.capacityApr26Mw != null ? Number(dbProj.contd4.capacityApr26Mw) : null;
    const diffs = (cur == null && want != null) || (cur != null && want != null && Math.abs(cur - want) > 0.01) || (cur != null && want == null);
    if (!diffs) { capUnchanged++; continue; }
    await prisma.contd4Application.update({
      where: { id: dbProj.contd4.id },
      data:  { capacityApr26Mw: want },
    });
    capUpdated++;
    console.log(`  CAP   ${p.name}  ${cur ?? 'NULL'} → ${want}`);
  }

  console.log('\nDone.');
  console.log(`  Plant-type:  updated=${ptUpdated}  unchanged=${ptUnchanged}`);
  console.log(`  CONTD-4 cap: updated=${capUpdated}  unchanged=${capUnchanged}`);
  if (missingProj)   console.log(`  Missing projects in DB: ${missingProj}`);
  if (missingContd4) console.log(`  Projects with no Contd4Application row: ${missingContd4}`);

  const filled = await prisma.contd4Application.count({ where: { capacityApr26Mw: { not: null } } });
  const total  = await prisma.contd4Application.count();
  console.log(`\n  Contd4Application with capacityApr26Mw now: ${filled} / ${total}`);
}

main()
  .catch((e) => { console.error('FAIL:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
