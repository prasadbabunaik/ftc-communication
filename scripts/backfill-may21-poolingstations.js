#!/usr/bin/env node
/**
 * Backfill PoolingStation links on existing GenerationProject rows from
 * seed-may21.json. The original extractor skipped the pooling-station
 * column, so every project ended up with poolingStationId = NULL; the
 * extractor now captures it (row[2]) and this script applies it.
 *
 * - Creates a PoolingStation row (scoped to the project's region) if no
 *   matching one exists yet.
 * - Skips projects that already have a poolingStationId.
 * - Non-destructive: re-runnable.
 *
 * Run:  node scripts/backfill-may21-poolingstations.js
 */
require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function getOrCreatePoolingStation(name, regionId, cache) {
  const key = `${regionId}|${name}`;
  if (cache.has(key)) return cache.get(key);
  let row = await prisma.poolingStation.findFirst({ where: { name, regionId } });
  if (!row) row = await prisma.poolingStation.create({ data: { name, regionId } });
  cache.set(key, row.id);
  return row.id;
}

async function main() {
  const jsonPath = path.join(__dirname, 'seed-may21.json');
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const ftcRows = data.ftc || [];
  console.log(`Loaded ${ftcRows.length} FTC project rows from ${jsonPath}`);

  // Index existing projects by name → row.
  const projects = await prisma.generationProject.findMany({
    where: { activeUntil: null },
    select: { id: true, name: true, regionId: true, poolingStationId: true, region: { select: { code: true } } },
  });
  const byName = new Map(projects.map((p) => [p.name, p]));
  const psCache = new Map();

  let linked = 0, alreadyLinked = 0, missing = 0;
  for (const p of ftcRows) {
    if (!p.poolingStation) continue;
    const proj = byName.get(p.name);
    if (!proj) { missing++; continue; }
    if (proj.poolingStationId) { alreadyLinked++; continue; }
    const psId = await getOrCreatePoolingStation(p.poolingStation, proj.regionId, psCache);
    await prisma.generationProject.update({
      where: { id: proj.id },
      data: { poolingStationId: psId },
    });
    linked++;
    console.log(`  LINK  ${p.name}  →  ${p.poolingStation} (${proj.region.code})`);
  }

  console.log(`\nDone.`);
  console.log(`  Linked:        ${linked}`);
  console.log(`  Already linked: ${alreadyLinked}`);
  console.log(`  Not in DB:     ${missing}`);

  const finalCount = await prisma.generationProject.count({ where: { poolingStationId: { not: null } } });
  const totalCount = await prisma.generationProject.count();
  console.log(`\n  Projects with poolingStationId now: ${finalCount} / ${totalCount}`);
}

main()
  .catch((e) => { console.error('FAIL:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
