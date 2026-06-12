/* eslint-disable no-console */
// TARGETED + SAFE: insert the four INTRA-STATE BESS projects from the source
// sheet's "BESS data" table (yellow rows). Intra-state storage records COD
// only — each project is created with isIntrastate=true, its state, a
// BESS commissioning phase carrying the declared COD capacity, and stays out
// of the FTC pipeline (inFtcPipeline=false, no CONTD-4).
//
// It NEVER touches existing (inter-state) projects. Idempotent: a project
// whose name already exists is skipped.
//
//   node scripts/seed-bess-intrastate.cjs            # DRY RUN — report only
//   node scripts/seed-bess-intrastate.cjs --apply    # create the projects
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

// From the sheet's Intra-state section. Total Capacity is blank there, so the
// declared COD capacity doubles as the best-known total capacity.
const ROWS = [
  { name: 'Rajnandgaon/ SECI',                       pooling: 'Thelkadih 132 kV',     plantType: 'HYBRID_SB', region: 'WR', state: 'Chhattisgarh', codMw: 40 },
  { name: 'Kilokari Battery Energy Storage System',  pooling: 'Kilokari/33kV',        plantType: 'BESS',      region: 'NR', state: 'Delhi',        codMw: 20 },
  { name: 'Kajra BESS',                              pooling: 'Kajra/132kV',          plantType: 'BESS',      region: 'ER', state: 'Bihar',        codMw: 45 },
  { name: 'Gujarat BESS Pvt Ltd',                    pooling: 'Charal - intra state', plantType: 'BESS',      region: 'WR', state: 'Gujarat',      codMw: 180 },
];

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (!admin) throw new Error('No ADMIN user found to own the seeded projects.');

  const regions = await prisma.gridRegion.findMany();
  const regionByCode = Object.fromEntries(regions.map((r) => [r.code, r]));
  const plantTypes = await prisma.plantType.findMany();
  const ptByCode = Object.fromEntries(plantTypes.map((t) => [t.code, t]));

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — intra-state BESS rows\n`);

  for (const row of ROWS) {
    const existing = await prisma.generationProject.findFirst({ where: { name: row.name } });
    if (existing) {
      console.log(`  SKIP (exists): ${row.name}`);
      continue;
    }
    const region = regionByCode[row.region];
    const pt = ptByCode[row.plantType];
    if (!region || !pt) {
      console.log(`  ERROR: missing region/plantType for ${row.name} (${row.region}/${row.plantType})`);
      continue;
    }
    console.log(`  CREATE: [${row.region}] ${row.name} · ${pt.label} · ${row.state} · COD ${row.codMw} MW · pooling "${row.pooling}"`);
    if (!APPLY) continue;

    let ps = await prisma.poolingStation.findFirst({ where: { name: row.pooling, regionId: region.id } });
    if (!ps) ps = await prisma.poolingStation.create({ data: { name: row.pooling, regionId: region.id } });

    await prisma.generationProject.create({
      data: {
        name: row.name,
        regionId: region.id,
        plantTypeId: pt.id,
        poolingStationId: ps.id,
        totalCapacityMw: row.codMw,
        isIntrastate: true,
        stateName: row.state,
        inFtcPipeline: false,
        createdById: admin.id,
        phases: {
          create: {
            sourceType: 'BESS',
            capacityAppliedMw: row.codMw,
            codDeclaredMw: row.codMw,
          },
        },
      },
    });
  }

  console.log(APPLY ? '\nDone.' : '\nDry run only — re-run with --apply to insert.');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
