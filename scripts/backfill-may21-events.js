#!/usr/bin/env node
/**
 * Sync FtcEvent / TocEvent / CodEvent rows from seed-may21.json into existing
 * CommissioningPhase rows.
 *
 * The original seed-may21.js seeded only one event per milestone because the
 * extractor collapsed multi-line Excel cells (e.g.
 *   "52: 18-03-2026\n10.4: 28-03-2026")
 * into a single date. The updated extract-may21.py now emits ftcEvents /
 * tocEvents / codEvents arrays in the JSON; this script applies them.
 *
 * Per phase, per event-type:
 *   - if the JSON has events and they don't match the DB (different count or
 *     different totals), wipe and re-create from JSON
 *   - if the JSON has no events for that milestone, leave the DB alone
 *
 * Run:  node scripts/backfill-may21-events.js
 */

require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

const EVENT_MODELS = {
  ftc: { model: 'ftcEvent', dbField: 'ftcEvents', jsonField: 'ftcEvents' },
  toc: { model: 'tocEvent', dbField: 'tocEvents', jsonField: 'tocEvents' },
  cod: { model: 'codEvent', dbField: 'codEvents', jsonField: 'codEvents' },
};

function eventsMatch(dbEvents, jsonEvents) {
  if (dbEvents.length !== jsonEvents.length) return false;
  const sortByDate = (a, b) => String(a.date).localeCompare(String(b.date));
  const a = [...dbEvents].map((e) => ({
    mw: Number(e.capacityMw),
    date: e.eventDate.toISOString().slice(0, 10),
  })).sort(sortByDate);
  const b = [...jsonEvents].map((e) => ({
    mw: Number(e.mw),
    date: String(e.date).slice(0, 10),
  })).sort(sortByDate);
  for (let i = 0; i < a.length; i++) {
    if (a[i].date !== b[i].date) return false;
    if (Math.abs(a[i].mw - b[i].mw) > 0.01) return false;
  }
  return true;
}

async function main() {
  const jsonPath = path.join(__dirname, 'seed-may21.json');
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const ftcRows = data.ftc || [];
  console.log(`Loaded ${ftcRows.length} FTC project rows from ${jsonPath}`);

  let touched = { ftc: 0, toc: 0, cod: 0 };
  let skipped = { ftc: 0, toc: 0, cod: 0 };
  let missing = 0;

  for (const p of ftcRows) {
    const proj = await prisma.generationProject.findFirst({
      where: { name: p.name, activeUntil: null },
      include: { phases: { include: { ftcEvents: true, tocEvents: true, codEvents: true } } },
    });
    if (!proj) {
      missing++;
      console.warn(`  MISS  ${p.name} — not in DB, skipped`);
      continue;
    }

    for (const phJson of (p.phases || [])) {
      // Match by sourceType; that's how seed-may21.js created phases.
      const phDb = proj.phases.find((x) => x.sourceType === phJson.sourceType);
      if (!phDb) {
        console.warn(`  MISS  ${p.name} — no DB phase with sourceType ${phJson.sourceType}`);
        continue;
      }
      for (const [kind, cfg] of Object.entries(EVENT_MODELS)) {
        const jsonEvents = phJson[cfg.jsonField] || [];
        const dbEvents = phDb[cfg.dbField] || [];
        if (jsonEvents.length === 0) { skipped[kind]++; continue; }
        if (eventsMatch(dbEvents, jsonEvents)) { skipped[kind]++; continue; }
        // Replace: wipe existing, write fresh.
        await prisma[cfg.model].deleteMany({ where: { phaseId: phDb.id } });
        await prisma[cfg.model].createMany({
          data: jsonEvents.map((e) => ({
            phaseId: phDb.id,
            capacityMw: Number(e.mw),
            eventDate: new Date(String(e.date) + 'T00:00:00Z'),
          })),
        });
        touched[kind]++;
        console.log(`  SYNC  ${p.name} [${phJson.sourceType}] ${kind.toUpperCase()}  ${dbEvents.length} → ${jsonEvents.length} events`);
      }
    }
  }

  console.log('\nDone.');
  console.log(`  Touched: FTC=${touched.ftc}  TOC=${touched.toc}  COD=${touched.cod}`);
  console.log(`  Already-in-sync or empty in JSON: FTC=${skipped.ftc}  TOC=${skipped.toc}  COD=${skipped.cod}`);
  if (missing) console.log(`  Project misses (not in DB): ${missing}`);

  const counts = {
    ftcEvents: await prisma.ftcEvent.count(),
    tocEvents: await prisma.tocEvent.count(),
    codEvents: await prisma.codEvent.count(),
  };
  console.log('\nGlobal event counts now:', counts);
}

main()
  .catch((e) => { console.error('FAIL:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
