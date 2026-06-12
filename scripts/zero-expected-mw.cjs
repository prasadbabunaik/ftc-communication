/* eslint-disable no-console */
// TARGETED + SAFE: reset the "Expected (MW)" value (expectedApr26Mw) to 0 on
// every CommissioningPhase row. One-off companion to the form change that
// stopped auto-deriving this field (Applied − COD): values written by the old
// auto-calc are wiped so the field reads 0 everywhere until an operator
// deliberately enters a number.
//
// It NEVER touches any other column — applied capacity, FTC/TOC/COD events,
// dates, remarks and expectedMonth are all left exactly as they are.
//
//   node scripts/zero-expected-mw.cjs            # DRY RUN — report only, no writes
//   node scripts/zero-expected-mw.cjs --apply    # set expectedApr26Mw = 0
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

async function main() {
  const phases = await prisma.commissioningPhase.findMany({
    where: { OR: [{ expectedApr26Mw: null }, { expectedApr26Mw: { not: 0 } }] },
    select: {
      id: true,
      sourceType: true,
      expectedApr26Mw: true,
      project: { select: { name: true, region: { select: { code: true } } } },
    },
    orderBy: { id: 'asc' },
  });

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${phases.length} phase(s) with Expected (MW) ≠ 0\n`);
  for (const ph of phases) {
    const cur = ph.expectedApr26Mw == null ? 'null' : Number(ph.expectedApr26Mw).toFixed(2);
    console.log(`  [${ph.project.region.code}] ${ph.project.name} · ${ph.sourceType}: ${cur} -> 0`);
  }

  if (!APPLY) {
    console.log('\nDry run only — re-run with --apply to write.');
    return;
  }

  const res = await prisma.commissioningPhase.updateMany({
    where: { OR: [{ expectedApr26Mw: null }, { expectedApr26Mw: { not: 0 } }] },
    data: { expectedApr26Mw: 0 },
  });
  console.log(`\nDone — ${res.count} row(s) updated.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
