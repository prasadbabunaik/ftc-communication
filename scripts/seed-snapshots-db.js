#!/usr/bin/env node
/**
 * Load pre-computed snapshots from scripts/snapshots-seed.json into the DB.
 * Run AFTER: python3 scripts/seed-snapshots.py
 * Usage:     node scripts/seed-snapshots-db.js
 */
require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  const seedPath = path.join(__dirname, 'snapshots-seed.json');
  if (!fs.existsSync(seedPath)) {
    console.error('snapshots-seed.json not found. Run: python3 scripts/seed-snapshots.py first');
    process.exit(1);
  }

  const snapshots = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  console.log(`Loading ${snapshots.length} snapshots into DB...`);

  for (const snap of snapshots) {
    const snapshotDate = new Date(snap.date + 'T00:00:00Z');
    await prisma.gridSnapshot.upsert({
      where:  { snapshotDate },
      create: {
        snapshotDate,
        label:       snap.label,
        t1Json:      snap.t1,
        t2Json:      snap.t2,
        t3Json:      snap.t3,
        detailsJson: snap.details ?? null,
      },
      update: {
        label:       snap.label,
        t1Json:      snap.t1,
        t2Json:      snap.t2,
        t3Json:      snap.t3,
        detailsJson: snap.details ?? null,
      },
    });
    console.log(`  ✓ ${snap.date}`);
  }

  const count = await prisma.gridSnapshot.count();
  console.log(`\nDone. Total snapshots in DB: ${count}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
