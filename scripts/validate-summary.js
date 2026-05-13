require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── replicate grid-computations.js exactly ────────────────────────────────────
const REGION_ORDER = ['NR', 'WR', 'SR', 'ER', 'NER'];
const SOURCE_ORDER = ['WIND', 'SOLAR', 'BESS', 'HYBRID', 'COAL', 'HYDRO', 'PSP'];

function n(v) { return v != null ? Number(v) : 0; }

function getProjectSource(project) {
  if (project.plantType.isHybrid) {
    const pt = project.plantType.code;
    if ((pt === 'HYBRID_SP' || pt === 'HYBRID_WP' || pt === 'HYBRID_HP') && project.phases.length > 0) {
      return project.phases[0].sourceType;
    }
    if (project.phases.length > 0 && project.phases.every(ph => ph.sourceType === 'WIND')) {
      return 'WIND';
    }
    return 'HYBRID';
  }
  if (project.phases.length > 0) return project.phases[0].sourceType;
  const label = project.plantType.label.toUpperCase();
  if (label.includes('WIND'))   return 'WIND';
  if (label.includes('SOLAR'))  return 'SOLAR';
  if (label.includes('BESS') || label.includes('BATTERY')) return 'BESS';
  if (label.includes('COAL') || label.includes('THERMAL')) return 'COAL';
  if (label.includes('HYDRO')) return 'HYDRO';
  if (label.includes('PSP')  || label.includes('PUMP'))   return 'PSP';
  return 'OTHER';
}

async function main() {
  // Query all projects with full relations
  const projects = await prisma.generationProject.findMany({
    include: {
      region:        { select: { code: true } },
      plantType:     { select: { code: true, label: true, isHybrid: true } },
      poolingStation:{ select: { name: true } },
      contd4:        true,
      phases:        true,
    }
  });

  const txElements = await prisma.transmissionElement.findMany({
    include: { region: { select: { code: true } } }
  });

  // ── TABLE 1: CONTD-4 Study ─────────────────────────────────────────────────
  const active = projects.filter(p => p.contd4 && p.contd4.status !== 'CLEARED' && p.contd4.status !== 'REJECTED');
  const t1 = {};
  for (const proj of active) {
    const region = proj.region.code;
    const source = getProjectSource(proj);
    const key = `${region}|${source}`;
    if (!t1[key]) t1[key] = { region, source, totalMw: 0, months: {} };
    t1[key].totalMw += n(proj.totalCapacityMw);
    const month = proj.contd4.capacityMonth;
    const mw    = n(proj.contd4.capacityApr26Mw);
    if (month && mw) {
      t1[key].months[month] = (t1[key].months[month] ?? 0) + mw;
    }
  }

  // ── TABLE 2: FTC Pipeline (region-wise) ───────────────────────────────────
  const cleared = projects.filter(p => p.contd4?.status === 'CLEARED');
  const t2 = {};
  for (const proj of cleared) {
    const region = proj.region.code;
    const source = getProjectSource(proj);
    const key    = `${region}|${source}`;
    if (!t2[key]) t2[key] = { region, source, totalMw: 0, contd4Mw: 0, appliedMw: 0, ftcMw: 0, ftcPendingMw: 0, tocMw: 0, tocPendingMw: 0, codMw: 0, codPendingMw: 0, expectedMw: 0 };
    const row = t2[key];
    row.totalMw  += n(proj.totalCapacityMw);
    row.contd4Mw += n(proj.contd4?.capacityApr26Mw);
    for (const ph of proj.phases) {
      row.appliedMw    += n(ph.capacityAppliedMw);
      row.ftcMw        += n(ph.ftcCompletedMw);
      row.ftcPendingMw += n(ph.capacityUnderFtcMw);
      row.tocMw        += n(ph.tocIssuedMw);
      row.tocPendingMw += n(ph.capacityUnderTocMw);
      const codVal      = n(ph.codDeclaredMw);
      const tocVal      = n(ph.tocIssuedMw);
      row.codMw        += codVal;
      row.codPendingMw += Math.max(0, tocVal - codVal);
      row.expectedMw   += n(ph.expectedApr26Mw);
    }
  }

  // ── TABLE 3: Transmission ──────────────────────────────────────────────────
  const CAT_MAP = {};
  for (const el of txElements) {
    const region = el.region.code;
    const isRe   = el.isRe;
    let cat = el.elementType === 'LINE' ? (isRe ? 'LINE_RE' : 'LINE_NONRE') :
              el.elementType === 'ICT'  ? (isRe ? 'ICT_RE'  : 'ICT_NONRE') : el.elementType;
    const key = `${region}|${cat}`;
    if (!CAT_MAP[key]) CAT_MAP[key] = { region, cat, completedNo: 0, completedKmMva: 0, pendingNo: 0, pendingKmMva: 0 };
    const row = CAT_MAP[key];
    const isLine = el.elementType === 'LINE';
    if (!el.pendingFtc) {
      row.completedNo++;
      row.completedKmMva += isLine ? n(el.lineLengthKm) : n(el.capacityMva);
    } else {
      row.pendingNo++;
      row.pendingKmMva += isLine
        ? (n(el.lineLengthApr26Km) || n(el.lineLengthKm))
        : (n(el.capacityApr26Mva)  || n(el.capacityMva));
    }
  }

  // ── Output for comparison ──────────────────────────────────────────────────
  console.log(JSON.stringify({ t1, t2, tx: CAT_MAP, stats: {
    clearedCount: cleared.length,
    activeContd4: active.length,
    txCount: txElements.length,
    totalProjects: projects.length,
  }}, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
