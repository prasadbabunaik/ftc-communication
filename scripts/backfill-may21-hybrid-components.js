#!/usr/bin/env node
/**
 * Backfill GenerationProject.hybridComponentsJson from seed-may21.json's
 * hybridComponents array. The Excel's "Source wise Segregation of hybrid
 * Generation Capacity Under Process of FTC" section gives per-component
 * (Solar / Wind / BESS / PSP) totals for each hybrid project — this is
 * what the Hybrid Breakdown tab needs to mirror the Google Sheet.
 *
 * Project matching: by name. If multiple DB rows share a name (the
 * extractor inserts both an aggregate row and per-component shadow rows),
 * we update each one with the same components array so the Hybrid
 * Breakdown query sees the breakdown regardless of which row is fetched.
 *
 * Run:  node scripts/backfill-may21-hybrid-components.js
 */
require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  const jsonPath = path.join(__dirname, 'seed-may21.json');
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const hcRows = data.hybridComponents || [];
  console.log(`Loaded ${hcRows.length} hybrid projects with component breakdown.`);

  // Index ALL DB projects by lowercased name (collect every row per name —
  // duplicates exist because the Excel has both aggregate + per-component
  // listings). Case-insensitive match handles "POWER" vs "Power"
  // discrepancies between the Source-wise sheet and the main FTC table.
  const projects = await prisma.generationProject.findMany({
    where: { activeUntil: null },
    select: { id: true, name: true, region: { select: { code: true } }, plantType: { select: { isHybrid: true } } },
  });
  const byName = new Map();
  for (const p of projects) {
    const k = p.name.toLowerCase().trim();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(p);
  }

  let updated = 0, missing = 0;
  for (const hp of hcRows) {
    const rows = byName.get(hp.name.toLowerCase().trim());
    if (!rows || rows.length === 0) { missing++; console.warn(`  MISS  ${hp.name}`); continue; }
    const payload = {
      hybridType: hp.hybridType,
      components: hp.components.map((c) => ({
        sourceType: c.sourceType,
        totalMw:    c.totalMw    ?? 0,
        contd4Mw:   c.contd4Mw   ?? 0,
        appliedMw:  c.appliedMw  ?? 0,
        ftcMw:      c.ftcMw      ?? 0,
        ftcDate:    c.ftcDate    ?? null,
        tocMw:      c.tocMw      ?? 0,
        tocDate:    c.tocDate    ?? null,
        codMw:      c.codMw      ?? 0,
        codDate:    c.codDate    ?? null,
        expectedMw: c.expectedMw ?? 0,
      })),
    };
    for (const r of rows) {
      await prisma.generationProject.update({
        where: { id: r.id },
        data:  { hybridComponentsJson: payload },
      });
      updated++;
    }
    console.log(`  SET   ${hp.name}  (${rows.length} DB row${rows.length>1?'s':''})  components=${payload.components.length}`);
  }

  console.log('\nDone.');
  console.log(`  Project entries updated: ${updated}`);
  if (missing) console.log(`  Project entries missing in DB: ${missing}`);

  const populated = await prisma.generationProject.count({
    where: { hybridComponentsJson: { not: null } },
  });
  const totalHybrids = await prisma.generationProject.count({
    where: { plantType: { isHybrid: true } },
  });
  console.log(`\n  Hybrid projects with components now: ${populated} / ${totalHybrids}`);
}

main()
  .catch((e) => { console.error('FAIL:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
