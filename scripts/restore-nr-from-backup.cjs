/* eslint-disable no-console */
// One-time targeted restore of the NR region (generation projects + CONTD-4 +
// transmission) from the Jun-4 pg_dump backup — used to undo an accidental
// global re-seed that overwrote the carefully hand-built NR data.
//   node scripts/restore-nr-from-backup.cjs            # dry-run (no writes)
//   node scripts/restore-nr-from-backup.cjs --execute  # delete current NR + restore
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BACKUP = process.env.BK || '/tmp/ftc-backups/ftc_1780554288.sql';
const EXECUTE = process.argv.includes('--execute');
const sql = fs.readFileSync(BACKUP, 'utf8');

// ── pg_dump COPY-block parser ────────────────────────────────────────────────
function unesc(v) {
  if (v === '\\N') return null;
  return v.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r').replace(/\\\\/g, '\\');
}
function copyBlock(table) {
  const marker = 'COPY public.' + table + ' (';
  let idx = sql.indexOf(marker);
  if (idx < 0) { const q = 'COPY public."' + table + '" ('; idx = sql.indexOf(q); if (idx < 0) return null; }
  const open = sql.indexOf('(', idx), close = sql.indexOf(')', open);
  const cols = sql.slice(open + 1, close).split(',').map((s) => s.trim().replace(/"/g, ''));
  const stdin = sql.indexOf('FROM stdin;\n', close) + 'FROM stdin;\n'.length;
  const end = sql.indexOf('\n\\.\n', stdin);
  const rows = sql.slice(stdin, end).split('\n').filter(Boolean).map((line) => {
    const parts = line.split('\t').map(unesc);
    const o = {}; cols.forEach((c, i) => { o[c] = parts[i]; });
    return o;
  });
  return rows;
}
const dec = (v) => (v == null ? null : v);            // Decimal as string is fine for Prisma
const dt = (v) => (v == null ? null : new Date(v));
const bool = (v) => v === 't' || v === 'true';
const json = (v) => { if (v == null) return null; try { return JSON.parse(v); } catch { return null; } };
const mapStatus = (s) => (s === 'PENDING' || s === 'RECEIVED') ? 'UNDER_PROCESS' : s;

(async () => {
  // ── backup tables ──
  const bRegions = copyBlock('grid_regions');
  const bPlant   = copyBlock('plant_types');
  const bPool    = copyBlock('pooling_stations');
  const bProj    = copyBlock('generation_projects');
  const bContd4  = copyBlock('contd4_applications');
  const bC4Ph    = copyBlock('contd4_phases');
  const bPhase   = copyBlock('commissioning_phases');
  const bFtc     = copyBlock('ftc_events');
  const bToc     = copyBlock('toc_events');
  const bCod     = copyBlock('cod_events');
  const bTx      = copyBlock('transmission_elements');

  const nrBackupId = bRegions.find((r) => r.code === 'NR').id;
  const plantById  = Object.fromEntries(bPlant.map((p) => [p.id, p]));   // backup plantTypeId → {code,label,...}
  const poolById   = Object.fromEntries(bPool.map((p) => [p.id, p]));    // backup poolingId → {name,voltageKv,regionId}

  const nrProjects = bProj.filter((p) => p.regionId === nrBackupId);
  const nrProjIds  = new Set(nrProjects.map((p) => p.id));
  const nrContd4   = bContd4.filter((c) => nrProjIds.has(c.projectId));
  const c4Ids      = new Set(nrContd4.map((c) => c.id));
  const nrC4Ph     = bC4Ph.filter((p) => c4Ids.has(p.contd4Id));
  const nrPhases   = bPhase.filter((p) => nrProjIds.has(p.projectId));
  const phIds      = new Set(nrPhases.map((p) => p.id));
  const nrFtc = bFtc.filter((e) => phIds.has(e.phaseId));
  const nrToc = bToc.filter((e) => phIds.has(e.phaseId));
  const nrCod = bCod.filter((e) => phIds.has(e.phaseId));
  const nrTx  = bTx.filter((t) => t.regionId === nrBackupId);

  console.log('── Backup NR contents ──');
  console.log(`  projects=${nrProjects.length} (FTC=${nrProjects.filter((p) => p.inFtcPipeline === 't').length}), contd4=${nrContd4.length}, contd4Phases=${nrC4Ph.length}`);
  console.log(`  commissioningPhases=${nrPhases.length}, ftcEv=${nrFtc.length}, tocEv=${nrToc.length}, codEv=${nrCod.length}, transmission=${nrTx.length}`);

  // ── current DB mapping targets ──
  const nrRegion = await prisma.gridRegion.findFirst({ where: { code: 'NR' } });
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (!nrRegion || !admin) throw new Error('NR region or admin not found in current DB');

  // plant type: backup id → current id (match by code, create if missing)
  const curPlant = await prisma.plantType.findMany();
  const plantCodeToId = Object.fromEntries(curPlant.map((p) => [p.code, p.id]));
  async function plantId(backupPlantTypeId) {
    const bp = plantById[backupPlantTypeId];
    if (!bp) return null;
    if (plantCodeToId[bp.code]) return plantCodeToId[bp.code];
    if (!EXECUTE) return '(would-create:' + bp.code + ')';
    const created = await prisma.plantType.create({ data: { code: bp.code, label: bp.label, category: bp.category, isHybrid: bool(bp.isHybrid) } });
    plantCodeToId[bp.code] = created.id; return created.id;
  }
  // pooling: backup id → current id (match by name within NR, create if missing)
  const curPool = await prisma.poolingStation.findMany({ where: { regionId: nrRegion.id } });
  const poolNameToId = Object.fromEntries(curPool.map((p) => [p.name.toUpperCase(), p.id]));
  async function poolId(backupPoolId) {
    if (!backupPoolId) return null;
    const bp = poolById[backupPoolId]; if (!bp || !bp.name) return null;
    const k = bp.name.toUpperCase();
    if (poolNameToId[k]) return poolNameToId[k];
    if (!EXECUTE) return '(would-create:' + bp.name + ')';
    const created = await prisma.poolingStation.create({ data: { name: bp.name, voltageKv: bp.voltageKv ? Number(bp.voltageKv) : null, regionId: nrRegion.id } });
    poolNameToId[k] = created.id; return created.id;
  }

  if (!EXECUTE) {
    console.log('\n(DRY-RUN) Would: delete current NR transactional data, then insert the above from backup.');
    console.log('Re-run with --execute to apply. A safety backup of the CURRENT state already exists in /tmp/ftc-backups/.');
    await prisma.$disconnect();
    return;
  }

  // ── delete current NR transactional data ──
  const curNrProjects = await prisma.generationProject.findMany({ where: { regionId: nrRegion.id }, select: { id: true } });
  const curIds = curNrProjects.map((p) => p.id);
  await prisma.ftcEvent.deleteMany({ where: { phase: { projectId: { in: curIds } } } });
  await prisma.tocEvent.deleteMany({ where: { phase: { projectId: { in: curIds } } } });
  await prisma.codEvent.deleteMany({ where: { phase: { projectId: { in: curIds } } } });
  await prisma.commissioningPhase.deleteMany({ where: { projectId: { in: curIds } } });
  await prisma.contd4Phase.deleteMany({ where: { contd4: { projectId: { in: curIds } } } });
  await prisma.contd4Application.deleteMany({ where: { projectId: { in: curIds } } });
  await prisma.projectNote.deleteMany({ where: { projectId: { in: curIds } } });
  await prisma.generationProject.deleteMany({ where: { id: { in: curIds } } });
  await prisma.transmissionAuditLog.deleteMany({ where: { element: { regionId: nrRegion.id } } });
  await prisma.transmissionElement.deleteMany({ where: { regionId: nrRegion.id } });
  console.log(`  deleted ${curIds.length} current NR projects + their phases/events/contd4/transmission`);

  // ── insert backup NR (reuse backup row ids; remap region/plant/pool/admin/status) ──
  let pc = 0, phc = 0, ec = 0, c4c = 0, txc = 0;
  for (const p of nrProjects) {
    await prisma.generationProject.create({ data: {
      id: p.id, name: p.name, regionId: nrRegion.id,
      plantTypeId: await plantId(p.plantTypeId), poolingStationId: await poolId(p.poolingStationId),
      totalCapacityMw: dec(p.totalCapacityMw), windCapacityMw: dec(p.windCapacityMw),
      solarCapacityMw: dec(p.solarCapacityMw), bessCapacityMw: dec(p.bessCapacityMw),
      hybridComponentsJson: json(p.hybridComponentsJson), inFtcPipeline: bool(p.inFtcPipeline),
      createdById: admin.id, activeFrom: dt(p.activeFrom) || new Date(), activeUntil: dt(p.activeUntil),
    } });
    pc++;
  }
  for (const c of nrContd4) {
    await prisma.contd4Application.create({ data: {
      id: c.id, projectId: c.projectId, applicationDate: dt(c.applicationDate), proposedFtcDate: dt(c.proposedFtcDate),
      capacityApr26Mw: dec(c.capacityApr26Mw), status: mapStatus(c.status), remarks: c.remarks,
      capacityMonth: c.capacityMonth, remarksUpdatedAt: dt(c.remarksUpdatedAt),
    } });
    c4c++;
  }
  for (const p of nrC4Ph) {
    await prisma.contd4Phase.create({ data: {
      id: p.id, contd4Id: p.contd4Id, declaredDate: dt(p.declaredDate), capacityMw: dec(p.capacityMw),
      capacityMonth: p.capacityMonth, remarks: p.remarks,
    } });
  }
  for (const ph of nrPhases) {
    await prisma.commissioningPhase.create({ data: {
      id: ph.id, projectId: ph.projectId, sourceType: ph.sourceType, capacityAppliedMw: dec(ph.capacityAppliedMw),
      ftcCompletedMw: dec(ph.ftcCompletedMw), ftcCompletedDate: dt(ph.ftcCompletedDate), proposedFtcDate: dt(ph.proposedFtcDate),
      capacityUnderFtcMw: dec(ph.capacityUnderFtcMw), tocIssuedMw: dec(ph.tocIssuedMw), tocIssuedDate: dt(ph.tocIssuedDate),
      capacityUnderTocMw: dec(ph.capacityUnderTocMw), codDeclaredMw: dec(ph.codDeclaredMw), codDeclaredDate: dt(ph.codDeclaredDate),
      expectedApr26Mw: dec(ph.expectedApr26Mw), delayRemarks: ph.delayRemarks, otherRemarks: ph.otherRemarks,
      delayCategory: ph.delayCategory, capacityPendingCodMw: dec(ph.capacityPendingCodMw), expectedMonth: ph.expectedMonth,
    } });
    phc++;
  }
  for (const [block, model] of [[nrFtc, 'ftcEvent'], [nrToc, 'tocEvent'], [nrCod, 'codEvent']]) {
    for (const e of block) { await prisma[model].create({ data: { id: e.id, phaseId: e.phaseId, eventDate: dt(e.eventDate), capacityMw: dec(e.capacityMw), remarks: e.remarks } }); ec++; }
  }
  for (const t of nrTx) {
    await prisma.transmissionElement.create({ data: {
      id: t.id, regionId: nrRegion.id, agencyOwner: t.agencyOwner, elementName: t.elementName, elementType: t.elementType,
      isRe: bool(t.isRe), voltageRatingKv: t.voltageRatingKv ? Number(t.voltageRatingKv) : null, capacityMva: dec(t.capacityMva),
      lineLengthKm: dec(t.lineLengthKm), firstEnergyDate: dt(t.firstEnergyDate), pendingFtc: bool(t.pendingFtc),
      proposedFtcDate: dt(t.proposedFtcDate), capacityApr26Mva: dec(t.capacityApr26Mva), lineLengthApr26Km: dec(t.lineLengthApr26Km),
      remarks: t.remarks, activeFrom: dt(t.activeFrom) || new Date(), activeUntil: dt(t.activeUntil),
    } });
    txc++;
  }
  console.log(`\n✓ Restored NR: ${pc} projects, ${phc} phases, ${ec} events, ${c4c} CONTD-4, ${txc} transmission`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
