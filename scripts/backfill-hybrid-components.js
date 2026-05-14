// Backfill windCapacityMw, solarCapacityMw, bessCapacityMw for hybrid projects.
// Sources:
//   1. Plant type label text (e.g. "Hybrid_(285MW Solar, 250MW Wind, 180MW BESS)")
//   2. Excel regional sheet section 2 (where component-level FTC applications are listed)
//
// Run:  node scripts/backfill-hybrid-components.js [--dry]

require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const XLSX = require('xlsx');
const path = require('path');

const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry');
const EXCEL_FILE = path.join(__dirname, '..', 'public', 'data', 'excel', 'CONTD and FTC details 130526.xlsx');

// Known component breakdowns. Either parsed from the regional sheets or from plant type labels.
// Key: project name (matched case-insensitive, contains-style).
const KNOWN_COMPONENTS = {
  // NR — parsed from plant type label text on regional sheet
  'Juniper Green Stellar':       { solar: 285,   wind: 250,   bess: 180 },
  'AMPIN ENERGY GREEN TEN':      { solar: 114.4, wind: 40.95, bess: 0   },
  // Aditya Birla NR has total = 0 ("not applied"). Components left at 0 to match Excel summary.

  // WR — derived from section 2 component-level FTC entries (totals match project totalCapacityMw)
  'AGE26BL Khavda PSS10':        { solar: 142,   wind: 156,   bess: 0 },
  'Oyster Green Hybrid One':     { solar: 100,   wind: 81,    bess: 0 },
  'TEQ Green Power XI':          { solar: 55.6,  wind: 148.5, bess: 0 },
  'Ayana Power Four Private Limited at Devasar': { solar: 37.5, wind: 92.4, bess: 0 },
  'Mounting Renewable Power':    { solar: 88.3,  wind: 161.7, bess: 0 },
  'Airpower Windfarms':          { solar: 50,    wind: 175,   bess: 4 },
  'Veh Jayin Renewables':        { solar: 45,    wind: 151.8, bess: 0 },
  'Aditya Birla Renewable Energy Limited (ABREL) Valsara': { solar: 130, wind: 184, bess: 0 },
  'APSEZ Khavda PSS4':           { solar: 325,   wind: 52,    bess: 0 },

  // SR — Excel doesn't explicitly list components in section 2; use totalCapacityMw as Wind/Solar
  // based on applied phase source type (only the applied component is documented)
  'Serentica Renewables India 1': { solar: 0, wind: 204, bess: 0 },
  'Serentica Renewables India 3': { solar: 0, wind: 270, bess: 0 },
  'Greenko AP01 IREP':            { solar: 1500, wind: 0,  bess: 0 },  // HYBRID_SP — PSP component tracked separately
  'Zenataris Renewable Energy':   { solar: 0, wind: 165, bess: 0 },
};

function findComponentEntry(projectName) {
  const lower = projectName.toLowerCase();
  for (const [key, vals] of Object.entries(KNOWN_COMPONENTS)) {
    if (lower.includes(key.toLowerCase())) return { key, vals };
  }
  return null;
}

async function main() {
  const hybrids = await prisma.generationProject.findMany({
    where: { plantType: { isHybrid: true } },
    include: { region: true, plantType: true },
  });

  console.log(`Found ${hybrids.length} hybrid projects (mode: ${DRY ? 'DRY RUN' : 'WRITE'})\n`);

  let updated = 0, skipped = 0, missing = 0;

  for (const p of hybrids) {
    const match = findComponentEntry(p.name);
    if (!match) {
      missing++;
      console.log(`  [SKIP no-match] [${p.region.code}] ${p.name}`);
      continue;
    }

    const { vals } = match;
    const hasExisting =
      p.windCapacityMw  != null && Number(p.windCapacityMw)  > 0 ||
      p.solarCapacityMw != null && Number(p.solarCapacityMw) > 0 ||
      p.bessCapacityMw  != null && Number(p.bessCapacityMw)  > 0;

    if (hasExisting) {
      skipped++;
      console.log(`  [SKIP has-data] [${p.region.code}] ${p.name}`);
      continue;
    }

    console.log(`  [UPDATE] [${p.region.code}] ${p.name.substring(0, 50).padEnd(50)} → Solar:${vals.solar}, Wind:${vals.wind}, BESS:${vals.bess}`);

    if (!DRY) {
      await prisma.generationProject.update({
        where: { id: p.id },
        data: {
          windCapacityMw:  vals.wind,
          solarCapacityMw: vals.solar,
          bessCapacityMw:  vals.bess,
        },
      });
    }
    updated++;
  }

  console.log(`\nDone. Updated: ${updated} | Skipped (has data): ${skipped} | No match: ${missing}`);
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
