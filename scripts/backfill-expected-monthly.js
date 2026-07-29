// One-time backfill: migrate each CommissioningPhase's legacy single-month
// expected (expectedApr26Mw + expectedMonth) into the new rolling-forecast
// column expectedMonthlyJson = { "<expectedMonth>": <expectedApr26Mw> }.
//
// The read path already falls back to the legacy scalar when expectedMonthlyJson
// is null, so on-screen values are unchanged either way — but materialising the
// value into the map guarantees it survives an edit (a phase whose month sits
// outside the current 3-month editor window would otherwise be dropped on save).
//
// Idempotent: phases that already carry an expectedMonthlyJson are skipped.
// Run once against the (shared) database:  node scripts/backfill-expected-monthly.js
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

(async () => {
  const phases = await db.commissioningPhase.findMany({
    where: { expectedApr26Mw: { gt: 0 } },
    select: { id: true, expectedApr26Mw: true, expectedMonth: true, expectedMonthlyJson: true },
  });
  let filled = 0, skipped = 0;
  for (const ph of phases) {
    if (ph.expectedMonthlyJson) { skipped++; continue; }
    const mw = Number(ph.expectedApr26Mw);
    const month = ph.expectedMonth;
    if (!(mw > 0) || !month || !/^\d{4}-\d{2}$/.test(month)) { skipped++; continue; }
    await db.commissioningPhase.update({
      where: { id: ph.id },
      data: { expectedMonthlyJson: { [month]: Math.round(mw * 100) / 100 } },
    });
    filled++;
  }
  console.log(`expected-monthly backfill: filled ${filled}, skipped ${skipped}, of ${phases.length} phases with expected>0`);
  await db.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
