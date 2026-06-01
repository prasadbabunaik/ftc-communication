import { prisma } from './prisma';
import {
  computePipelineMatrix,
  computeContd4Study,
  computeTransmission,
} from './grid-computations';

// Replays ProjectNote status entries to compute each contd4 application's
// status as it stood on `asOf`. Returns Map<projectId, statusString>.
// Mirrors statusAsOf() in app/(protected)/contd4/page.jsx but operates on a
// pre-loaded batch (avoids N+1 queries when rebuilding many snapshots).
async function statusByProjectAsOf(asOf) {
  const notes = await prisma.projectNote.findMany({
    where: { field: 'Status' },
    select: { projectId: true, oldValue: true, newValue: true, createdAt: true, effectiveDate: true },
    orderBy: { createdAt: 'asc' },
  });
  // Group each project's Status transitions chronologically.
  const byProject = new Map();
  for (const n of notes) {
    if (!byProject.has(n.projectId)) byProject.set(n.projectId, []);
    byProject.get(n.projectId).push(n);
  }
  const map = new Map();
  for (const [projectId, list] of byProject) {
    // Latest transition whose effective date is on or before `asOf`.
    let resolved = null;
    for (const n of list) {
      const eff = n.effectiveDate ?? n.createdAt;
      if (eff.getTime() <= asOf.getTime()) resolved = n.newValue;
    }
    // If `asOf` predates every transition, the status was whatever the first
    // transition moved away FROM (its oldValue).
    if (resolved == null) resolved = list[0].oldValue ?? null;
    if (resolved != null) map.set(projectId, resolved);
  }
  // Projects with NO Status notes are intentionally absent from this map —
  // the caller keeps their current contd4.status (e.g. seeded CLEARED rows).
  return map;
}

// Replays TransmissionAuditLog entries to reconstruct each element's full
// state as of `asOf`. Returns Map<elementId, stateObj>. Logic:
//   • For each element, find the latest audit log with
//     effectiveDate ?? createdAt ≤ asOf AND stateJson IS NOT NULL.
//   • That log's stateJson is the element's state at that point.
//   • Elements with no qualifying log keep their current row (default).
// stateJson is written by all create/update actions going forward, so legacy
// elements that haven't been edited since the column was added simply fall
// through to current state — which matches how snapshots already behaved.
async function txStateMapAsOf(asOf, elementIds) {
  if (!elementIds.length) return new Map();
  // Pull the relevant logs in one query, ordered so the first match per
  // element is automatically the latest qualifying entry.
  const logs = await prisma.transmissionAuditLog.findMany({
    where: {
      elementId: { in: elementIds },
      stateJson: { not: null },
      OR: [
        { effectiveDate: { lte: asOf } },
        { AND: [{ effectiveDate: null }, { createdAt: { lte: asOf } }] },
      ],
    },
    select: { elementId: true, stateJson: true, effectiveDate: true, createdAt: true },
    orderBy: [
      { elementId: 'asc' },
      { effectiveDate: 'desc' },
      { createdAt: 'desc' },
    ],
  });
  const map = new Map();
  for (const log of logs) {
    if (!map.has(log.elementId)) map.set(log.elementId, log.stateJson);
  }
  return map;
}

// Loads projects + TX elements as they existed on `asOf` and computes the
// three pipeline/study/transmission matrices. Same shape produced by the
// live takeSnapshot in app/actions/grid.js, so the JSON is interchangeable.
async function computeMatricesAsOf(asOf) {
  const [rawProjects, txElementsRaw, statusOverride] = await Promise.all([
    prisma.generationProject.findMany({
      where: {
        OR: [
          { activeUntil: null },
          { activeUntil: { gt: asOf } },
        ],
      },
      include: {
        region:         { select: { code: true } },
        plantType:      { select: { label: true, isHybrid: true } },
        poolingStation: { select: { name: true } },
        contd4: {
          include: {
            // CONTD-4 phase declarations are date-stamped; honour them.
            phases: { where: { declaredDate: { lte: asOf } } },
          },
        },
        phases: {
          include: {
            ftcEvents: { where: { eventDate: { lte: asOf } } },
            tocEvents: { where: { eventDate: { lte: asOf } } },
            codEvents: { where: { eventDate: { lte: asOf } } },
          },
        },
      },
    }),
    prisma.transmissionElement.findMany({
      where: {
        OR: [
          { activeUntil: null },
          { activeUntil: { gt: asOf } },
        ],
      },
      include: { region: { select: { code: true } } },
    }),
    statusByProjectAsOf(asOf),
  ]);

  // Replay TX state from audit logs so back-dated TX edits reflect at the
  // correct point in history. Elements without any qualifying audit log keep
  // their current row — preserves the legacy "snapshots match current state"
  // behaviour for rows that have never been edited under this feature.
  const txOverride = await txStateMapAsOf(asOf, txElementsRaw.map(e => e.id));
  const txElements = txElementsRaw.map(e => {
    const hist = txOverride.get(e.id);
    if (!hist) return e;
    return {
      ...e,
      ...hist,
      // Stored region is the relation row; the override may carry only a
      // regionId so we keep the original .region.code intact.
      region: e.region,
    };
  });

  // Apply historical status replay so computeContd4Study's CLEARED/REJECTED
  // filter sees the right status for `asOf`. Projects with a Status-note
  // history get their replayed status; projects with NO recorded transition
  // (e.g. seeded directly as CLEARED) keep their CURRENT status — defaulting
  // those to PENDING would wrongly drop them from the FTC pipeline.
  const projects = rawProjects.map(p => {
    if (!p.contd4) return p;
    const hist = statusOverride.get(p.id);
    if (hist == null) return p;
    return { ...p, contd4: { ...p.contd4, status: hist } };
  });

  const t2 = computePipelineMatrix(projects, asOf);
  const { rows: contd4Rows, allMonths } = computeContd4Study(projects);
  const t3 = computeTransmission(txElements);
  return { t1: { rows: contd4Rows, allMonths }, t2, t3 };
}

function startOfUTCDay(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function endOfUTCDay(d) {
  const x = new Date(d);
  x.setUTCHours(23, 59, 59, 999);
  return x;
}

// Public API. Recomputes and upserts a GridSnapshot for every day from
// `fromDate` (inclusive) through today (inclusive). Use after any back-dated
// mutation so historical diffs stay accurate.
//   fromDate: Date | "YYYY-MM-DD" string
// Returns: { rebuilt: number, days: ["YYYY-MM-DD", ...] }
export async function rebuildSnapshotsFrom(fromDate) {
  const start  = startOfUTCDay(typeof fromDate === 'string' ? new Date(fromDate + 'T00:00:00Z') : fromDate);
  const today  = startOfUTCDay(new Date());
  if (start.getTime() > today.getTime()) return { rebuilt: 0, days: [] };

  const days = [];
  for (let d = new Date(start); d.getTime() <= today.getTime(); d = new Date(d.getTime() + 86_400_000)) {
    days.push(new Date(d));
  }

  for (const day of days) {
    const { t1, t2, t3 } = await computeMatricesAsOf(endOfUTCDay(day));
    await prisma.gridSnapshot.upsert({
      where:  { snapshotDate: day },
      create: { snapshotDate: day, label: null, t1Json: t1, t2Json: t2, t3Json: t3 },
      update: {                                  t1Json: t1, t2Json: t2, t3Json: t3 },
    });
  }

  return { rebuilt: days.length, days: days.map(d => d.toISOString().slice(0, 10)) };
}
