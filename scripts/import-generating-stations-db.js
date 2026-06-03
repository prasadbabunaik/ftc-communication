#!/usr/bin/env node
// Load scripts/generating-stations.json into the generating_stations master
// table. Upsert by name so re-running is idempotent.
//   Run after:  python3 scripts/import-generating-stations.py
//   Usage:      node scripts/import-generating-stations-db.js
require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  const file = path.join(__dirname, 'generating-stations.json');
  if (!fs.existsSync(file)) {
    console.error('generating-stations.json not found — run import-generating-stations.py first');
    process.exit(1);
  }
  const stations = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`Loading ${stations.length} stations...`);

  let created = 0, updated = 0;
  for (const s of stations) {
    const existing = await prisma.generatingStation.findUnique({ where: { name: s.name } });
    if (existing) {
      await prisma.generatingStation.update({
        where: { name: s.name },
        data: { poolingStationName: s.poolingStationName, regionCode: s.regionCode },
      });
      updated++;
    } else {
      await prisma.generatingStation.create({ data: s });
      created++;
    }
  }
  const total = await prisma.generatingStation.count();
  console.log(`Done. Created ${created}, updated ${updated}. Total in DB: ${total}`);
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); }).finally(() => prisma.$disconnect());
