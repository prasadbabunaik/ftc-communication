'use server';

import { revalidatePath } from 'next/cache';
import { requireServerUser, buildRegionScope, canEditGridData, isAdmin } from '@/lib/server-auth';
import { prisma } from '@/lib/prisma';
import {
  createProjectSchema,
  createPhasesSchema,
  createTransmissionSchema,
  contd4Schema,
} from '@/lib/validations/grid';
import {
  computePipelineMatrix,
  computeContd4Study,
  computeTransmission,
} from '@/lib/grid-computations';
import {
  notifyProjectCreated,
  notifyContd4StatusChanged,
  notifyMilestoneEvent,
  notifyTransmissionUpdated,
} from '@/lib/notifications';
import { rebuildSnapshotsFrom } from '@/lib/snapshot-rebuild';

// Returns true for roles authorised to record a back-dated change. All other
// roles silently get effectiveDate ignored (the change applies as of "now").
function canBackdate(role) {
  return role === 'ADMIN' || role === 'NLDC';
}

// Resolves a user-supplied effective date string against the caller's role.
// Returns Date|null. Falls back to null (= treat as now) when:
//   • the user can't back-date,
//   • no string was supplied,
//   • the string can't be parsed.
function resolveEffectiveDate(role, raw) {
  if (!canBackdate(role)) return null;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

// Captures the fields needed by computeTransmission so audit-log replay can
// reconstruct historical state with one query. Decimals are serialised as
// plain numbers — JSON has no Decimal type and downstream consumers cast back.
function txStateSnapshot(el) {
  return {
    regionId:          el.regionId,
    agencyOwner:       el.agencyOwner,
    elementName:       el.elementName,
    elementType:       el.elementType,
    isRe:              el.isRe,
    voltageRatingKv:   el.voltageRatingKv,
    capacityMva:       el.capacityMva       != null ? Number(el.capacityMva)       : null,
    lineLengthKm:      el.lineLengthKm      != null ? Number(el.lineLengthKm)      : null,
    firstEnergyDate:   el.firstEnergyDate,
    pendingFtc:        el.pendingFtc,
    proposedFtcDate:   el.proposedFtcDate,
    capacityApr26Mva:  el.capacityApr26Mva  != null ? Number(el.capacityApr26Mva)  : null,
    lineLengthApr26Km: el.lineLengthApr26Km != null ? Number(el.lineLengthApr26Km) : null,
    remarks:           el.remarks,
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function authedUser() {
  try { return await requireServerUser(); }
  catch { return null; }
}

function parseDecimal(val) {
  if (!val || val === '') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function parseDate(val) {
  if (!val || val === '') return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtMw   = (v) => (v != null && v !== '' ? `${Number(v).toFixed(2)} MW` : '—');
const fmtStr  = (v) => (v != null && v !== '' ? String(v) : '—');

// Revalidate every page whose data could be affected by a generation-project mutation.
// Dashboard, FTC tracker, hybrid view, CONTD-4 list, generation list — they all read project data.
function revalidateGridPages(projectId = null) {
  revalidatePath('/dashboard');
  revalidatePath('/ftc');
  revalidatePath('/hybrid-ftc');
  revalidatePath('/contd4');
  revalidatePath('/generation');
  if (projectId) revalidatePath(`/generation/${projectId}`);
}

function revalidateTransmissionPages() {
  revalidatePath('/dashboard');
  revalidatePath('/transmission');
}

// Silently upsert a GridSnapshot for today so day-wise history stays current.
// Called after every mutation; errors are swallowed so they never break the action.
// Snapshot semantics: a snapshot for date D = point-in-time grid state for D,
// computed from the *current* DB. Events with eventDate > D are excluded. This
// keeps the snapshot series stable — if no new events are added, snapshots
// don't drift, and a diff between two snapshots reflects exactly the events
// whose eventDate falls in that interval.
async function takeSnapshot() {
  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const endOfToday = new Date(today);
    endOfToday.setUTCHours(23, 59, 59, 999);

    const [projects, txElements] = await Promise.all([
      prisma.generationProject.findMany({
        include: {
          region:         { select: { code: true } },
          plantType:      { select: { label: true, isHybrid: true } },
          poolingStation: { select: { name: true } },
          contd4:         true,
          phases:         { include: { ftcEvents: true, tocEvents: true, codEvents: true } },
        },
      }),
      prisma.transmissionElement.findMany({
        include: { region: { select: { code: true } } },
      }),
    ]);

    const pipelineMatrix = computePipelineMatrix(projects, endOfToday);
    const { rows: contd4Rows, allMonths } = computeContd4Study(projects);
    const txMatrix = computeTransmission(txElements);

    await prisma.gridSnapshot.upsert({
      where:  { snapshotDate: today },
      create: { snapshotDate: today, label: null, t1Json: { rows: contd4Rows, allMonths }, t2Json: pipelineMatrix, t3Json: txMatrix },
      update: {                                    t1Json: { rows: contd4Rows, allMonths }, t2Json: pipelineMatrix, t3Json: txMatrix },
    });
  } catch (e) {
    console.error('[takeSnapshot] failed silently:', e?.message ?? e);
  }
}

function diffFields(tracked, projectId, userId, phaseId = null) {
  return tracked
    .filter((t) => t.old !== t.new)
    .map((t) => ({
      projectId,
      phaseId: phaseId ?? null,
      userId,
      text:     `${t.field}: ${t.old} → ${t.new}`,
      source:   'SYSTEM',
      field:    t.field,
      oldValue: t.old,
      newValue: t.new,
    }));
}

// Validates that new phases for a given sourceType don't exceed the project's
// per-source capacity cap (only applies to hybrid projects).
// ── Hybrid component-source guard ────────────────────────────────────────────
// A hybrid's phases must use ONLY the source types the hybrid is declared to
// consist of (its PlantType code, e.g. HYBRID_SB → Solar + BESS). Otherwise a
// stray phase (say WIND on a Solar+BESS hybrid) would surface a component in
// the dashboard's Hybrid Breakdown that the plant doesn't have. Unknown /
// novel hybrid codes skip the check (can't infer their components).
const HYBRID_CODE_SOURCES = {
  HYBRID_WS:  ['WIND', 'SOLAR'],
  HYBRID_SB:  ['SOLAR', 'BESS'],
  HYBRID_WSB: ['WIND', 'SOLAR', 'BESS'],
  HYBRID_WB:  ['WIND', 'BESS'],
  HYBRID_WP:  ['WIND', 'PSP'],
  HYBRID_HP:  ['HYDRO', 'PSP'],
  HYBRID_SP:  ['SOLAR', 'PSP'],
};
function validateHybridPhaseSources(project, newPhases) {
  if (!project.plantType?.isHybrid) return;
  const allowed = HYBRID_CODE_SOURCES[project.plantType.code];
  if (!allowed) return;
  const bad = (newPhases ?? []).find((ph) => !allowed.includes(ph.sourceType));
  if (bad) {
    throw new Error(
      `${bad.sourceType} is not a component of this hybrid (${project.plantType.label}). Allowed sources: ${allowed.join(', ')}.`
    );
  }
}

function validateSourceCap(project, newPhases) {
  const capMap = {
    WIND:  'windCapacityMw',
    SOLAR: 'solarCapacityMw',
    BESS:  'bessCapacityMw',
  };

  for (const phase of newPhases) {
    const capField = capMap[phase.sourceType];
    if (!capField || !project[capField]) continue;

    const existingSum = project.phases
      .filter((p) => p.sourceType === phase.sourceType)
      .reduce((s, p) => s + Number(p.capacityAppliedMw), 0);

    const newCapacity = parseFloat(phase.capacityAppliedMw);
    if (existingSum + newCapacity > Number(project[capField])) {
      throw new Error(
        `${phase.sourceType} capacity (${existingSum + newCapacity} MW) would exceed the project's ${phase.sourceType} limit of ${project[capField]} MW`
      );
    }
  }
}

// ── Duplicate-name guard ─────────────────────────────────────────────────────
// One generating station = one row. A double-submitted form (or a re-entry of
// an existing station) used to create silent duplicate projects that then
// showed twice in pickers and double-counted once data was added. Reject any
// create/rename that collides (case-insensitive, whitespace-trimmed) with an
// ACTIVE project in the same region.
async function duplicateNameError(name, regionId, excludeId = null) {
  const clean = (name ?? '').trim();
  if (!clean) return null;
  const dupe = await prisma.generationProject.findFirst({
    where: {
      name: { equals: clean, mode: 'insensitive' },
      regionId,
      activeUntil: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { name: true },
  });
  if (!dupe) return null;
  return `A project named “${dupe.name}” already exists in this region. Open the existing project instead of creating a duplicate — or, if this really is a different plant, add a distinguishing suffix (e.g. “… Phase-II”).`;
}

// ── Hybrid source-split guard ────────────────────────────────────────────────
// The Including-Hybrid dashboard views must be able to attribute every pipeline
// hybrid to its component sources. A hybrid is splittable when it has a
// component segregation (hybridComponentsJson), OR source-wise commissioning
// phases, OR per-source capacity columns. Enforced wherever a hybrid could
// otherwise enter (or remain in) the FTC pipeline unsplittable — so the
// "unattributable HYBRID residual" problem cannot recur.
function hybridSplitError(project, phaseCount) {
  if (!project.plantType?.isHybrid) return null;
  if ((project.hybridComponentsJson?.components ?? []).length > 0) return null;
  if (phaseCount > 0) return null;
  if (Number(project.windCapacityMw ?? 0) > 0 || Number(project.solarCapacityMw ?? 0) > 0 || Number(project.bessCapacityMw ?? 0) > 0) return null;
  return 'This hybrid project has no source-wise data. Record its component capacities (Wind / Solar / BESS) or add a source-wise phase first, so its capacity can be attributed per source on the dashboard.';
}

function validateSourcePipeline(existingPhases, newPhases) {
  const evSumPhase = (evs) => (evs ?? []).reduce((s, e) => s + (parseFloat(e.mw) || 0), 0);

  const acc = {};
  for (const ph of existingPhases) {
    const s = ph.sourceType;
    if (!acc[s]) acc[s] = { ftc: 0, toc: 0, cod: 0 };
    acc[s].ftc += Number(ph.ftcCompletedMw ?? 0);
    acc[s].toc += Number(ph.tocIssuedMw    ?? 0);
    acc[s].cod += Number(ph.codDeclaredMw  ?? 0);
  }
  for (const ph of newPhases) {
    const s = ph.sourceType;
    if (!acc[s]) acc[s] = { ftc: 0, toc: 0, cod: 0 };
    // New form submissions use event arrays; fall back to summary fields for legacy data
    acc[s].ftc += ph.ftcEvents != null ? evSumPhase(ph.ftcEvents) : (parseFloat(ph.ftcCompletedMw || '0') || 0);
    acc[s].toc += ph.tocEvents != null ? evSumPhase(ph.tocEvents) : (parseFloat(ph.tocIssuedMw    || '0') || 0);
    acc[s].cod += ph.codEvents != null ? evSumPhase(ph.codEvents) : (parseFloat(ph.codDeclaredMw  || '0') || 0);
    const { ftc, toc, cod } = acc[s];
    if (toc > ftc + 0.001)
      throw new Error(`${s}: TOC total (${toc.toFixed(1)} MW) would exceed FTC completed (${ftc.toFixed(1)} MW). FTC must be completed before TOC can be issued for ${s}.`);
    if (cod > toc + 0.001)
      throw new Error(`${s}: COD total (${cod.toFixed(1)} MW) would exceed TOC issued (${toc.toFixed(1)} MW). TOC must be issued before COD can be declared for ${s}.`);
  }
}

// ─── GENERATION PROJECTS ──────────────────────────────────────────────────────

export async function createGenerationProject(formData) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };
  if (!canEditGridData(user.role)) return { error: 'Your role is read-only. Editing requires an RLDC or Administrator account.' };
  const parsed = createProjectSchema.safeParse(formData);
  if (!parsed.success) return { error: parsed.error.flatten() };

  const data = parsed.data;

  // RLDC users can only create projects in their own region
  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== data.regionId) {
    return { error: 'You can only create projects in your assigned region.' };
  }

  // Resolve effective date FIRST so contd4.remarksUpdatedAt and any project
  // notes carry the right historical timestamp.
  const effectiveDate = resolveEffectiveDate(user.role, data.effectiveDate);
  const remarkStamp   = effectiveDate ?? new Date();

  // CONTD-4 status at creation: anyone gets UNDER_PROCESS; ADMIN/NLDC may pick any
  // status (UNDER_PROCESS / CLEARED / REJECTED) — this is how a project
  // that's already past CONTD-4 is onboarded. The client form gates the
  // dropdown to ADMIN/NLDC; this is the server-side defence.
  const requestedStatus = data.contd4?.status ?? 'UNDER_PROCESS';
  const contd4Status = canBackdate(user.role) ? requestedStatus : 'UNDER_PROCESS';

  // Strict duplicate guard — one station, one row (also absorbs double-submits).
  const dupErr = await duplicateNameError(data.name, data.regionId);
  if (dupErr) return { error: { fieldErrors: { name: [dupErr] } } };

  // Resolve pooling station: prefer the explicit id; otherwise, when a master
  // station auto-filled a pooling-station NAME, find-or-create that
  // PoolingStation in the project's region (the row may not exist yet).
  let poolingStationId = data.poolingStationId || null;
  // Treat a blank or placeholder ("-", "—") pooling-station name as "none" so
  // junk rows never get created in the master list.
  const psNameRaw = (data.poolingStationName ?? '').trim();
  const psNameValid = psNameRaw && !/^[-–—\s]+$/.test(psNameRaw);
  if (!poolingStationId && psNameValid) {
    const psName = psNameRaw;
    const foundPs = await prisma.poolingStation.findFirst({ where: { name: psName, regionId: data.regionId } });
    poolingStationId = foundPs
      ? foundPs.id
      : (await prisma.poolingStation.create({ data: { name: psName, regionId: data.regionId } })).id;
  }
  // Pooling station is mandatory (defense-in-depth — the schema also enforces it).
  if (!poolingStationId) {
    return { error: { fieldErrors: { poolingStationId: ['Pooling station is required'] } } };
  }

  // Resolve plant type: prefer an explicit master id; otherwise resolve by the
  // derived source-combination code, find-or-creating the PlantType so novel
  // valid combinations (e.g. Coal+BESS) work without a manual master entry.
  let plantTypeId = data.plantTypeId || null;
  if (!plantTypeId && data.plantTypeCode) {
    const code = data.plantTypeCode;
    let pt = await prisma.plantType.findFirst({ where: { code } });
    if (!pt) {
      pt = await prisma.plantType.create({
        data: {
          code, label: data.plantTypeLabel || code,
          isHybrid: !!data.plantTypeIsHybrid,
          category: data.plantTypeCategory || 'RENEWABLE',
        },
      });
    }
    plantTypeId = pt.id;
  }
  if (!plantTypeId) return { error: 'Plant type is required' };

  // A hybrid created straight into the FTC pipeline (CONTD-4 CLEARED at
  // creation) must carry its per-source capacity split — same guard as the
  // clear/edit actions, so an unattributable hybrid can never enter.
  if (data.createContd4 && contd4Status === 'CLEARED') {
    const pt = await prisma.plantType.findUnique({ where: { id: plantTypeId } });
    const capProbe = {
      plantType: pt,
      hybridComponentsJson: null,
      windCapacityMw:  parseDecimal(data.windCapacityMw),
      solarCapacityMw: parseDecimal(data.solarCapacityMw),
      bessCapacityMw:  parseDecimal(data.bessCapacityMw),
    };
    const splitErr = hybridSplitError(capProbe, 0);
    if (splitErr) return { error: splitErr };
  }

  let project;
  try {
    project = await prisma.generationProject.create({
      include: { region: { select: { code: true } }, plantType: { select: { label: true } } },
      data: {
        name: data.name.trim(),
        regionId: data.regionId,
        plantTypeId,
        poolingStationId,
        totalCapacityMw: parseFloat(data.totalCapacityMw),
        windCapacityMw:  parseDecimal(data.windCapacityMw),
        solarCapacityMw: parseDecimal(data.solarCapacityMw),
        bessCapacityMw:  parseDecimal(data.bessCapacityMw),
        // Intra-state BESS only — the client gates the checkbox to the BESS
        // plant type; mirror that here so other types can't carry the flag.
        isIntrastate: !!data.isIntrastate && data.plantTypeCode === 'BESS',
        createdById: user.id,
        // Legacy onboarding ("Already CONTD-4 cleared") enters the project
        // straight into the FTC pipeline. A plain new CONTD-4 application
        // (PENDING) does not — it's only under study until cleared or until
        // FTC data is recorded.
        inFtcPipeline: !!(data.createContd4 && contd4Status === 'CLEARED'),
        ...(data.createContd4 && data.contd4
          ? {
              contd4: {
                create: {
                  // applicationDate is now nullable — blank stays as null so
                  // the UI can honestly render "—" for legacy projects where
                  // the original date is unknown. The schema already enforces
                  // that PENDING/RECEIVED submissions supply a date.
                  applicationDate: data.contd4.applicationDate
                    ? new Date(data.contd4.applicationDate)
                    : null,
                  proposedFtcDate: parseDate(data.contd4.proposedFtcDate),
                  capacityApr26Mw: parseDecimal(data.contd4.capacityApr26Mw),
                  capacityMonth:   data.contd4.capacityMonth || null,
                  status:          contd4Status,
                  remarks:         data.contd4.remarks || null,
                  // Time-stamp the remark on the effective date so the list
                  // view shows "28 Apr 26" instead of today when ADMIN/NLDC
                  // back-dated the creation.
                  remarksUpdatedAt: data.contd4.remarks?.trim() ? remarkStamp : null,
                },
              },
            }
          : {}),
      },
    });
  } catch (e) {
    console.error('createGenerationProject Prisma error:', e);
    return { error: 'Failed to save project. Please check your inputs and try again.' };
  }

  // Back-dated creation: log a CREATE note carrying the effectiveDate so the
  // historical replay (statusAsOf etc.) anchors the project at that date,
  // then rebuild every snapshot from then to today. (effectiveDate was
  // resolved at the top of the action so contd4.remarksUpdatedAt also got it.)
  // Always record creation in the audit trail (positioned at createdAt, or the
  // back-dated effectiveDate for ADMIN/NLDC historical onboarding).
  await prisma.projectNote.create({
    data: {
      projectId:   project.id,
      projectName: project.name,
      userId:      user.id,
      text:        effectiveDate
        ? `Project created (back-dated to ${effectiveDate.toISOString().slice(0, 10)}).`
        : 'Project created.',
      source:      'SYSTEM',
      effectiveDate: effectiveDate ?? null,
    },
  });

  revalidateGridPages(project.id);
  if (effectiveDate) await rebuildSnapshotsFrom(effectiveDate);
  else void takeSnapshot();
  void notifyProjectCreated({
    project,
    regionCode: project.region?.code,
    actorUserId: user.id,
  });
  return { success: true, id: project.id };
}

export async function updateGenerationProject(projectId, formData) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };
  if (!canEditGridData(user.role)) return { error: 'Your role is read-only. Editing requires an RLDC or Administrator account.' };
  const project = await prisma.generationProject.findUniqueOrThrow({ where: { id: projectId } });

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== project.regionId) {
    return { error: 'You cannot edit projects outside your assigned region.' };
  }

  // Strict duplicate guard — renaming must not collide with another project.
  const dupErr = await duplicateNameError(formData.name, project.regionId, projectId);
  if (dupErr) return { error: dupErr };

  await prisma.generationProject.update({
    where: { id: projectId },
    data: {
      name:             formData.name.trim(),
      poolingStationId: formData.poolingStationId || null,
      totalCapacityMw:  parseFloat(formData.totalCapacityMw),
      windCapacityMw:   parseDecimal(formData.windCapacityMw),
      solarCapacityMw:  parseDecimal(formData.solarCapacityMw),
      bessCapacityMw:   parseDecimal(formData.bessCapacityMw),
    },
  });

  const logs = diffFields([
    { field: 'Name',               old: fmtStr(project.name),            new: fmtStr(formData.name) },
    { field: 'Total Capacity',     old: fmtMw(project.totalCapacityMw),  new: fmtMw(formData.totalCapacityMw) },
    { field: 'Wind Capacity',      old: fmtMw(project.windCapacityMw),   new: fmtMw(formData.windCapacityMw) },
    { field: 'Solar Capacity',     old: fmtMw(project.solarCapacityMw),  new: fmtMw(formData.solarCapacityMw) },
    { field: 'BESS Capacity',      old: fmtMw(project.bessCapacityMw),   new: fmtMw(formData.bessCapacityMw) },
    { field: 'Pooling Station ID', old: fmtStr(project.poolingStationId), new: fmtStr(formData.poolingStationId || null) },
  ], projectId, user.id);
  if (logs.length) await prisma.projectNote.createMany({ data: logs });

  revalidateGridPages(projectId);
  void takeSnapshot();
  return { success: true };
}

// Manual commissioning override (FTC tracker). Normally a project reads as
// "Commissioned" once declared COD MW reaches its total capacity. This lets an
// authorised operator force that status — or reopen it — when the derived rule
// doesn't fit (capacity revised down, last units cleared off-system, etc.).
// The flag is purely a status marker: it does NOT create COD events or alter
// any capacity figures.
export async function setProjectCommissioned(projectId, commissioned) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };
  if (!canEditGridData(user.role)) return { error: 'Your role is read-only. Editing requires an RLDC or Administrator account.' };
  const project = await prisma.generationProject.findUnique({ where: { id: projectId } });
  if (!project) return { error: 'Project not found.' };

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== project.regionId) {
    return { error: 'You cannot edit projects outside your assigned region.' };
  }

  const next = !!commissioned;
  if (project.manuallyCommissioned === next) return { success: true };

  await prisma.generationProject.update({
    where: { id: projectId },
    data: {
      manuallyCommissioned: next,
      commissionedAt:       next ? new Date() : null,
    },
  });

  await prisma.projectNote.create({
    data: {
      projectId,
      projectName: project.name,
      userId:      user.id,
      text:        next
        ? 'Manually marked Commissioned'
        : 'Commissioned status reopened (manual override cleared)',
      source:   'SYSTEM',
      field:    'Commissioning status',
      oldValue: next ? 'Under Process' : 'Commissioned (manual)',
      newValue: next ? 'Commissioned (manual)' : 'Under Process',
    },
  });

  revalidateGridPages(projectId);
  void takeSnapshot();
  return { success: true };
}

// Lightweight capacity-only edit used by the "Edit Sources / Components" modal
// so an operator can correct the plant's Total Capacity (and, for hybrids, each
// component capacity) inline while fixing an "Applied exceeds capacity"
// violation — without leaving the phase editor. Unlike updateGenerationProject
// this NEVER touches name / poolingStation, so the modal doesn't need (and
// can't accidentally clear) those fields. Only the capacity keys actually
// present in `caps` are written.
export async function updateProjectCapacities(projectId, caps) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };
  if (!canEditGridData(user.role)) return { error: 'Your role is read-only. Editing requires an RLDC or Administrator account.' };
  const project = await prisma.generationProject.findUniqueOrThrow({ where: { id: projectId } });

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== project.regionId) {
    return { error: 'You cannot edit projects outside your assigned region.' };
  }

  const data = {};
  if (caps.totalCapacityMw != null && caps.totalCapacityMw !== '') {
    const t = parseFloat(caps.totalCapacityMw);
    if (isNaN(t) || t <= 0) return { error: 'Total Capacity must be a positive number.' };
    data.totalCapacityMw = t;
  }
  if ('windCapacityMw'  in caps) data.windCapacityMw  = parseDecimal(caps.windCapacityMw);
  if ('solarCapacityMw' in caps) data.solarCapacityMw = parseDecimal(caps.solarCapacityMw);
  if ('bessCapacityMw'  in caps) data.bessCapacityMw  = parseDecimal(caps.bessCapacityMw);

  if (Object.keys(data).length === 0) return { success: true };

  await prisma.generationProject.update({ where: { id: projectId }, data });

  const tracked = [];
  if ('totalCapacityMw' in data) tracked.push({ field: 'Total Capacity', old: fmtMw(project.totalCapacityMw), new: fmtMw(data.totalCapacityMw) });
  if ('windCapacityMw'  in data) tracked.push({ field: 'Wind Capacity',  old: fmtMw(project.windCapacityMw),  new: fmtMw(data.windCapacityMw) });
  if ('solarCapacityMw' in data) tracked.push({ field: 'Solar Capacity', old: fmtMw(project.solarCapacityMw), new: fmtMw(data.solarCapacityMw) });
  if ('bessCapacityMw'  in data) tracked.push({ field: 'BESS Capacity',  old: fmtMw(project.bessCapacityMw),  new: fmtMw(data.bessCapacityMw) });
  const logs = diffFields(tracked, projectId, user.id);
  if (logs.length) await prisma.projectNote.createMany({ data: logs });

  revalidateGridPages(projectId);
  void takeSnapshot();
  return { success: true };
}

// BESS Data tab — inline edit of the two columns that are NOT sourced from the
// FTC pipeline / CONTD-4 and so have no other edit surface in the app:
//   • State (situated)         → stateName
//   • Energy Commissioned (MWh)→ energyCommissionedMwh
// Everything else on that table (COD capacity / dates / ref-month) is derived
// from CommissioningPhase + COD events and stays read-only. Passing only the
// changed key(s) lets a single cell save touch just that column.
export async function updateBessRowFields(projectId, fields) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };
  if (!canEditGridData(user.role)) return { error: 'Your role is read-only. Editing requires an RLDC or Administrator account.' };
  const project = await prisma.generationProject.findUnique({ where: { id: projectId } });
  if (!project) return { error: 'Project not found.' };

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== project.regionId) {
    return { error: 'You cannot edit projects outside your assigned region.' };
  }

  const data = {};
  if ('stateName' in fields) {
    const s = typeof fields.stateName === 'string' ? fields.stateName.trim() : '';
    data.stateName = s === '' ? null : s;
  }
  if ('energyCommissionedMwh' in fields) {
    const raw = fields.energyCommissionedMwh;
    if (raw == null || String(raw).trim() === '') {
      data.energyCommissionedMwh = null;
    } else {
      const e = parseFloat(raw);
      if (isNaN(e) || e < 0) return { error: 'Energy Commissioned must be a non-negative number.' };
      data.energyCommissionedMwh = e;
    }
  }

  if (Object.keys(data).length === 0) return { success: true };

  await prisma.generationProject.update({ where: { id: projectId }, data });

  const tracked = [];
  if ('stateName' in data) {
    tracked.push({ field: 'State (situated)', old: fmtStr(project.stateName), new: fmtStr(data.stateName) });
  }
  if ('energyCommissionedMwh' in data) {
    tracked.push({
      field: 'Energy Commissioned (MWh)',
      old: fmtStr(project.energyCommissionedMwh != null ? Number(project.energyCommissionedMwh) : null),
      new: fmtStr(data.energyCommissionedMwh),
    });
  }
  const logs = diffFields(tracked, projectId, user.id);
  if (logs.length) await prisma.projectNote.createMany({ data: logs });

  revalidatePath('/bess-data');
  revalidatePath('/dashboard');
  return { success: true };
}

// "Delete" is actually a soft-delete (deactivation) — the project stays in
// the DB so historical / as-of-date dashboards keep showing it for the period
// it was live. Pass { hard: true } to wipe the row entirely (admin-only).
export async function deleteGenerationProject(projectId, opts = {}) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };
  if (!canEditGridData(user.role)) return { error: 'Your role is read-only. Editing requires an RLDC or Administrator account.' };
  const project = await prisma.generationProject.findUnique({ where: { id: projectId } });
  if (!project) return { error: 'Project not found.' };

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== project.regionId) {
    return { error: 'Access denied.' };
  }

  const isHard = opts.hard && user.role === 'ADMIN';
  // Log BEFORE the mutation so the audit row is valid; on a hard delete the FK
  // SetNull then orphans it (projectId → null) while projectName preserves the
  // label, keeping the audit trail intact.
  await prisma.projectNote.create({
    data: {
      projectId:   project.id,
      projectName: project.name,
      userId:      user.id,
      text:        isHard ? 'Project permanently deleted.'
        : project.activeUntil ? 'Project reactivated.'
        : 'Project deactivated (soft-deleted).',
      source:      'SYSTEM',
    },
  });

  if (isHard) {
    await prisma.generationProject.delete({ where: { id: projectId } });
  } else {
    // If already inactive, reactivate; otherwise deactivate as of now.
    const data = project.activeUntil
      ? { activeUntil: null }                     // reactivate
      : { activeUntil: new Date() };              // deactivate
    await prisma.generationProject.update({ where: { id: projectId }, data });
  }
  revalidateGridPages();
  void takeSnapshot();
  return { success: true, deactivated: !opts.hard };
}

// ─── CONTD-4 ──────────────────────────────────────────────────────────────────

export async function upsertContd4(projectId, formData) {
  let user;
  try { user = await requireServerUser(); }
  catch { return { error: 'Session expired. Please refresh the page and log in again.' }; }
  if (!canEditGridData(user.role)) return { error: 'Your role is read-only. Editing requires an RLDC or Administrator account.' };
  const project = await prisma.generationProject.findUniqueOrThrow({ where: { id: projectId } });

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== project.regionId) {
    return { error: 'Access denied.' };
  }

  const parsed = contd4Schema.safeParse(formData);
  if (!parsed.success) return { error: parsed.error.flatten() };

  const data = parsed.data;
  const effectiveDate = resolveEffectiveDate(user.role, data.effectiveDate);

  // Fetch existing for change tracking diff
  const existing = await prisma.contd4Application.findUnique({ where: { projectId } });

  // Capacity is now tracked via Contd4Phase rows — the legacy single-value
  // capacityApr26Mw / capacityMonth fields here are managed by
  // refreshContd4Cache() after every phase add/delete. Don't touch them
  // from the application-level upsert.
  //
  // New CONTD-4 applications always start in UNDER_PROCESS — status transitions
  // (RECEIVED / REJECTED / CLEARED) only happen via subsequent edits or the
  // dedicated "Mark as Cleared" action.
  //
  // Application-level remarks are only valid for "single-shot" declarations
  // (no phases). Once phases exist, remarks belong on phase rows. Strip the
  // incoming value if phases are present so the field can't be filled via
  // an out-of-date or scripted submission.
  const phaseCount = await prisma.contd4Phase.count({
    where: { contd4: { projectId } },
  });

  // Editing the status to CLEARED puts the project into the FTC pipeline — a
  // hybrid must be source-splittable before that happens (same guard as the
  // dedicated "Mark as Cleared" action).
  if (existing && data.status === 'CLEARED' && existing.status !== 'CLEARED') {
    const [plantType, commPhaseCount] = await Promise.all([
      prisma.plantType.findUnique({ where: { id: project.plantTypeId } }),
      prisma.commissioningPhase.count({ where: { projectId } }),
    ]);
    const splitErr = hybridSplitError({ ...project, plantType }, commPhaseCount);
    if (splitErr) return { error: splitErr };
  }

  const newRemarks = phaseCount > 0 ? null : (data.remarks?.trim() || null);
  const remarksChanged = (existing?.remarks ?? null) !== newRemarks;

  // CONTD-4 Issued capacity. Editable only for single-shot declarations (no
  // phases); when phases exist the value is their cached sum (managed by
  // refreshContd4Cache) and any incoming value is ignored. Enforce that it
  // never exceeds the plant's total capacity.
  let issuedUpdate = {};
  if (phaseCount === 0 && data.capacityApr26Mw != null && data.capacityApr26Mw !== '') {
    const issued = parseFloat(data.capacityApr26Mw);
    if (isNaN(issued) || issued < 0) return { error: 'CONTD-4 Issued capacity must be a non-negative number.' };
    if (issued > Number(project.totalCapacityMw) + 0.01) {
      return { error: `CONTD-4 Issued (${issued.toFixed(1)} MW) cannot exceed the total capacity (${Number(project.totalCapacityMw).toFixed(1)} MW).` };
    }
    // Single-shot entry: the capacity and its target month are captured together
    // (the "to be completed in <month>" pairing). When dated declarations exist
    // both are managed by refreshContd4Cache, so this branch is skipped.
    issuedUpdate = {
      capacityApr26Mw: issued,
      capacityMonth:   data.capacityMonth && data.capacityMonth !== '' ? data.capacityMonth : null,
    };
  }
  // remarksUpdatedAt drives the date shown beside the remark in the list
  // view. Two cases bump it:
  //   1. Remark text changed → stamp to "now" (or effectiveDate if supplied).
  //   2. Remark text unchanged BUT an effectiveDate was supplied — anchor
  //      the existing remark to the back-dated date so the list reflects
  //      the user's intent (without this branch the row keeps showing
  //      today even though they back-dated to April).
  const remarkStamp = effectiveDate ?? new Date();
  const shouldStampRemark = remarksChanged || (!!effectiveDate && !!newRemarks);
  const newValues = {
    applicationDate: data.applicationDate ? new Date(data.applicationDate) : null,
    proposedFtcDate: parseDate(data.proposedFtcDate),
    status:          existing ? data.status : 'UNDER_PROCESS',
    remarks:         newRemarks,
    ...(shouldStampRemark ? { remarksUpdatedAt: newRemarks ? remarkStamp : null } : {}),
    ...issuedUpdate,
  };

  await prisma.contd4Application.upsert({
    where: { projectId },
    update: newValues,
    create: { projectId, ...newValues },
  });

  // Auto-log field changes
  const changeLogs = [];
  if (existing) {
    const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
    const fmtMw   = (v) => (v != null ? `${Number(v).toFixed(1)} MW` : '—');
    const fmtStr  = (v) => v ?? '—';

    const tracked = [
      { field: 'Application Date', old: fmtDate(existing.applicationDate), new: fmtDate(newValues.applicationDate) },
      { field: 'Proposed FTC Date', old: fmtDate(existing.proposedFtcDate), new: fmtDate(newValues.proposedFtcDate) },
      { field: 'Status', old: fmtStr(existing.status), new: fmtStr(newValues.status) },
      { field: 'Remarks', old: fmtStr(existing.remarks), new: fmtStr(newValues.remarks) },
      ...('capacityApr26Mw' in issuedUpdate
        ? [{ field: 'CONTD-4 Issued', old: fmtMw(existing.capacityApr26Mw), new: fmtMw(issuedUpdate.capacityApr26Mw) }]
        : []),
      ...('capacityMonth' in issuedUpdate && (existing.capacityMonth ?? null) !== (issuedUpdate.capacityMonth ?? null)
        ? [{ field: 'Target Month', old: fmtStr(existing.capacityMonth), new: fmtStr(issuedUpdate.capacityMonth) }]
        : []),
    ];

    for (const t of tracked) {
      if (t.old !== t.new) {
        changeLogs.push({
          projectId,
          userId:   user.id,
          text:     `${t.field}: ${t.old} → ${t.new}`,
          source:   'SYSTEM',
          field:    t.field,
          oldValue: t.old,
          newValue: t.new,
          effectiveDate,
        });
      }
    }
  } else {
    // First-time creation — log a single creation entry
    changeLogs.push({
      projectId,
      userId:  user.id,
      text:    'CONTD-4 application created.',
      source:  'SYSTEM',
      field:   null,
      oldValue: null,
      newValue: null,
      effectiveDate,
    });
  }

  if (changeLogs.length > 0) {
    await prisma.projectNote.createMany({ data: changeLogs });
  }

  revalidateGridPages(projectId);
  // Back-dated edits invalidate every snapshot from the effective date to
  // today — rebuild that range so the Day-wise Changes diff stays accurate.
  // For "as-of-now" edits, the cheaper takeSnapshot() (today only) is enough.
  if (effectiveDate) await rebuildSnapshotsFrom(effectiveDate);
  else void takeSnapshot();
  return { success: true };
}

// ─── CONTD-4 CAPACITY PHASES ──────────────────────────────────────────────────
// Append-only timeline of capacity declarations against an application.
// "Latest declaration" mirror fields on Contd4Application (capacityApr26Mw,
// capacityMonth) are kept in sync with the SUM / most recent phase so the rest
// of the dashboard (which reads those fields directly) stays correct.

async function refreshContd4Cache(contd4Id) {
  const phases = await prisma.contd4Phase.findMany({
    where:   { contd4Id },
    orderBy: { declaredDate: 'asc' },
  });
  const total = phases.reduce((s, p) => s + Number(p.capacityMw || 0), 0);
  const latest = phases[phases.length - 1];
  await prisma.contd4Application.update({
    where: { id: contd4Id },
    data: {
      capacityApr26Mw: total > 0 ? total : null,
      // Keep the legacy single-month field pointing at the most recent phase's month.
      capacityMonth:   latest?.capacityMonth ?? null,
    },
  });
}

export async function addContd4Phase(projectId, formData) {
  let user;
  try { user = await requireServerUser(); }
  catch { return { error: 'Session expired. Please log in again.' }; }
  if (!canEditGridData(user.role)) return { error: 'Your role is read-only. Editing requires an RLDC or Administrator account.' };

  const project = await prisma.generationProject.findUnique({
    where: { id: projectId },
    include: { contd4: true },
  });
  if (!project)        return { error: 'Project not found.' };
  if (!project.contd4) return { error: 'Add a CONTD-4 application before recording phases.' };

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== project.regionId) {
    return { error: 'Access denied.' };
  }

  const declaredDate = parseDate(formData.declaredDate);
  const capacityMw   = parseDecimal(formData.capacityMw);
  const capacityMonth = (formData.capacityMonth || '').match(/^\d{4}-\d{2}$/) ? formData.capacityMonth : null;
  const remarks = formData.remarks?.trim() || null;

  if (!declaredDate)           return { error: 'Declared date is required.' };
  if (!capacityMw || capacityMw <= 0) return { error: 'Capacity (MW) must be greater than zero.' };

  // Capacity cap: sum of all phases for this project must not exceed the
  // project's total installed capacity. Prevents accidentally declaring more
  // CONTD-4 capacity than the plant actually has.
  const existingPhases = await prisma.contd4Phase.findMany({
    where: { contd4Id: project.contd4.id },
    select: { capacityMw: true },
  });
  const existingTotal = existingPhases.reduce((s, p) => s + Number(p.capacityMw || 0), 0);
  const projectTotal  = Number(project.totalCapacityMw || 0);
  const newTotal      = existingTotal + capacityMw;
  // Tiny tolerance for float rounding (0.01 MW).
  if (projectTotal > 0 && newTotal > projectTotal + 0.01) {
    const headroom = Math.max(0, projectTotal - existingTotal);
    return {
      error: `Capacity exceeds plant total. Plant capacity is ${projectTotal.toFixed(1)} MW, `
           + `already declared ${existingTotal.toFixed(1)} MW — only ${headroom.toFixed(1)} MW headroom left.`,
    };
  }

  const phase = await prisma.contd4Phase.create({
    data: {
      contd4Id: project.contd4.id,
      declaredDate,
      capacityMw,
      capacityMonth,
      remarks,
    },
  });

  await refreshContd4Cache(project.contd4.id);

  // Audit log entry — include any phase-level remarks so they're searchable
  // from the Activity & Notes feed.
  const monthLabel = capacityMonth ? ` for ${capacityMonth}` : '';
  const noteSuffix = remarks ? `\nRemarks: ${remarks}` : '';
  await prisma.projectNote.create({
    data: {
      projectId,
      userId:   user.id,
      text:     `Recorded CONTD-4 capacity phase: ${Number(capacityMw).toFixed(1)} MW${monthLabel} declared on ${declaredDate.toISOString().slice(0, 10)}.${noteSuffix}`,
      source:   'SYSTEM',
      field:    'Contd4Phase',
      oldValue: null,
      newValue: `${Number(capacityMw).toFixed(1)} MW${monthLabel}${remarks ? ' — ' + remarks : ''}`,
    },
  });

  revalidateGridPages(projectId);
  // Phase declaredDate IS the effective date for CONTD-4 capacity reporting,
  // so any phase added with a past declaredDate is implicitly a back-dated
  // change — rebuild from that date forward. Today-dated declarations fall
  // through to the cheap "today only" snapshot.
  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
  if (declaredDate.getTime() < todayStart.getTime()) {
    await rebuildSnapshotsFrom(declaredDate);
  } else {
    void takeSnapshot();
  }
  return { success: true, phaseId: phase.id };
}

export async function deleteContd4Phase(phaseId) {
  let user;
  try { user = await requireServerUser(); }
  catch { return { error: 'Session expired. Please log in again.' }; }
  if (!canEditGridData(user.role)) return { error: 'Your role is read-only. Editing requires an RLDC or Administrator account.' };

  const phase = await prisma.contd4Phase.findUnique({
    where: { id: phaseId },
    include: { contd4: { include: { project: true } } },
  });
  if (!phase) return { error: 'Phase not found.' };

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== phase.contd4.project.regionId) {
    return { error: 'Access denied.' };
  }

  await prisma.contd4Phase.delete({ where: { id: phaseId } });
  await refreshContd4Cache(phase.contd4Id);

  await prisma.projectNote.create({
    data: {
      projectId: phase.contd4.projectId,
      userId:    user.id,
      text:      `Removed CONTD-4 capacity phase: ${Number(phase.capacityMw).toFixed(1)} MW (declared ${phase.declaredDate.toISOString().slice(0, 10)}).`,
      source:    'SYSTEM',
      field:     'Contd4Phase',
      oldValue:  `${Number(phase.capacityMw).toFixed(1)} MW`,
      newValue:  null,
    },
  });

  revalidateGridPages(phase.contd4.projectId);
  void takeSnapshot();
  return { success: true };
}

// ─── COMMISSIONING EVENTS (per-date FTC / TOC / COD increments) ──────────────
// Each milestone — FTC completed, TOC issued, COD declared — is recorded
// step-by-step in the Excel as multiple (mw, date) entries. We model that
// with three append-only event tables. The legacy single-quantum fields on
// CommissioningPhase (ftcCompletedMw, ftcCompletedDate, tocIssuedMw, ...) are
// kept as a denormalised cache so existing readers (FtcTable, summary
// aggregations, exports) stay untouched. `refreshCommissioningCache` rebuilds
// those fields from the event rows after every add/delete.
//
// Pipeline invariants (TOC ≤ FTC, COD ≤ TOC) are enforced here, not in the DB.

const MODEL_BY_KIND = {
  ftc: 'ftcEvent',
  toc: 'tocEvent',
  cod: 'codEvent',
};

const LABEL_BY_KIND = { ftc: 'FTC', toc: 'TOC', cod: 'COD' };

async function refreshCommissioningCache(phaseId) {
  const [ftc, toc, cod] = await Promise.all([
    prisma.ftcEvent.findMany({ where: { phaseId }, orderBy: { eventDate: 'asc' } }),
    prisma.tocEvent.findMany({ where: { phaseId }, orderBy: { eventDate: 'asc' } }),
    prisma.codEvent.findMany({ where: { phaseId }, orderBy: { eventDate: 'asc' } }),
  ]);
  const sum = (rows) => rows.reduce((s, r) => s + Number(r.capacityMw || 0), 0);
  const latestDate = (rows) => (rows.length ? rows[rows.length - 1].eventDate : null);

  const ftcTotal = sum(ftc);
  const tocTotal = sum(toc);
  const codTotal = sum(cod);

  await prisma.commissioningPhase.update({
    where: { id: phaseId },
    data: {
      ftcCompletedMw:       ftcTotal > 0 ? ftcTotal : null,
      ftcCompletedDate:     latestDate(ftc),
      tocIssuedMw:          tocTotal > 0 ? tocTotal : null,
      tocIssuedDate:        latestDate(toc),
      codDeclaredMw:        codTotal > 0 ? codTotal : null,
      codDeclaredDate:      latestDate(cod),
      capacityPendingCodMw: Math.max(0, tocTotal - codTotal) > 0 ? Math.max(0, tocTotal - codTotal) : null,
    },
  });
}

async function loadPhaseWithGuards(phaseId) {
  return prisma.commissioningPhase.findUnique({
    where: { id: phaseId },
    include: {
      project:    { include: { region: { select: { code: true } } } },
      ftcEvents:  true,
      tocEvents:  true,
      codEvents:  true,
    },
  });
}

export async function addCommissioningEvent(kind, phaseId, formData) {
  let user;
  try { user = await requireServerUser(); }
  catch { return { error: 'Session expired. Please log in again.' }; }
  if (!canEditGridData(user.role)) return { error: 'Your role is read-only. Editing requires an RLDC or Administrator account.' };
  if (!MODEL_BY_KIND[kind]) return { error: 'Invalid event kind.' };

  const phase = await loadPhaseWithGuards(phaseId);
  if (!phase) return { error: 'Phase not found.' };

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== phase.project.regionId) {
    return { error: 'Access denied.' };
  }

  const eventDate = parseDate(formData.eventDate);
  const capacityMw = parseDecimal(formData.capacityMw);
  const remarks   = formData.remarks?.trim() || null;
  if (!eventDate)              return { error: 'Date is required.' };
  if (!capacityMw || capacityMw <= 0) return { error: 'Capacity (MW) must be greater than zero.' };

  // Sum existing capacities per kind for invariant checks.
  const sum = (rows) => rows.reduce((s, r) => s + Number(r.capacityMw || 0), 0);
  const ftcSum = sum(phase.ftcEvents);
  const tocSum = sum(phase.tocEvents);
  const codSum = sum(phase.codEvents);
  const applied = Number(phase.capacityAppliedMw || 0);
  const TOL = 0.01;

  if (kind === 'ftc') {
    // FTC total cannot exceed applied (or the project's capacity for the source).
    if (applied > 0 && ftcSum + capacityMw > applied + TOL) {
      return { error: `FTC total would exceed Applied (${applied.toFixed(2)} MW). Available headroom: ${Math.max(0, applied - ftcSum).toFixed(2)} MW.` };
    }
  } else if (kind === 'toc') {
    if (tocSum + capacityMw > ftcSum + TOL) {
      return { error: `TOC total (${(tocSum + capacityMw).toFixed(2)} MW) would exceed FTC approved (${ftcSum.toFixed(2)} MW). Record FTC first.` };
    }
    // Date ordering — TOC date should be on/after the earliest FTC date that
    // could cover it. We enforce the soft rule: TOC.eventDate >= MIN(FTC.eventDate).
    if (phase.ftcEvents.length) {
      const minFtc = phase.ftcEvents.reduce((m, e) => (e.eventDate < m ? e.eventDate : m), phase.ftcEvents[0].eventDate);
      if (eventDate < new Date(minFtc)) {
        return { error: `TOC date cannot be before the first FTC date (${new Date(minFtc).toISOString().slice(0,10)}).` };
      }
    }
  } else if (kind === 'cod') {
    if (codSum + capacityMw > tocSum + TOL) {
      return { error: `COD total (${(codSum + capacityMw).toFixed(2)} MW) would exceed TOC issued (${tocSum.toFixed(2)} MW). Record TOC first.` };
    }
    if (phase.tocEvents.length) {
      const minToc = phase.tocEvents.reduce((m, e) => (e.eventDate < m ? e.eventDate : m), phase.tocEvents[0].eventDate);
      if (eventDate < new Date(minToc)) {
        return { error: `COD date cannot be before the first TOC date (${new Date(minToc).toISOString().slice(0,10)}).` };
      }
    }
  }

  const model = MODEL_BY_KIND[kind];
  const created = await prisma[model].create({
    data: { phaseId, eventDate, capacityMw, remarks },
  });

  await refreshCommissioningCache(phaseId);

  const label = LABEL_BY_KIND[kind];
  const noteSuffix = remarks ? `\nRemarks: ${remarks}` : '';
  await prisma.projectNote.create({
    data: {
      projectId: phase.projectId,
      phaseId,
      userId:    user.id,
      text:      `Recorded ${label} event: ${Number(capacityMw).toFixed(2)} MW on ${eventDate.toISOString().slice(0, 10)} (${phase.sourceType}).${noteSuffix}`,
      source:    'SYSTEM',
      field:     `${label}Event`,
      oldValue:  null,
      newValue:  `${Number(capacityMw).toFixed(2)} MW ${eventDate.toISOString().slice(0,10)}`,
    },
  });

  revalidateGridPages(phase.projectId);
  // Events with a past eventDate are inherently back-dated — rebuild snapshots
  // from that date forward so historical aggregates and diffs reflect the new
  // event. Today-dated events use the cheap single-day takeSnapshot.
  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
  if (eventDate.getTime() < todayStart.getTime()) {
    await rebuildSnapshotsFrom(eventDate);
  } else {
    void takeSnapshot();
  }
  void notifyMilestoneEvent({
    kind: kind === 'ftc' ? 'FTC_EVENT' : kind === 'toc' ? 'TOC_EVENT' : 'COD_EVENT',
    project: phase.project,
    regionCode: phase.project.region?.code,
    capacityMw,
    eventDate,
    actorUserId: user.id,
  });
  return { success: true, eventId: created.id };
}

export async function deleteCommissioningEvent(kind, eventId) {
  let user;
  try { user = await requireServerUser(); }
  catch { return { error: 'Session expired. Please log in again.' }; }
  if (!canEditGridData(user.role)) return { error: 'Your role is read-only. Editing requires an RLDC or Administrator account.' };
  if (!MODEL_BY_KIND[kind]) return { error: 'Invalid event kind.' };

  const model = MODEL_BY_KIND[kind];
  const event = await prisma[model].findUnique({
    where: { id: eventId },
    include: { phase: { include: { project: true } } },
  });
  if (!event) return { error: 'Event not found.' };

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== event.phase.project.regionId) {
    return { error: 'Access denied.' };
  }

  // Cascade-safety check: deleting an FTC event may leave TOC > FTC, etc.
  // Re-validate the chain after the proposed delete.
  const [ftc, toc, cod] = await Promise.all([
    prisma.ftcEvent.findMany({ where: { phaseId: event.phaseId } }),
    prisma.tocEvent.findMany({ where: { phaseId: event.phaseId } }),
    prisma.codEvent.findMany({ where: { phaseId: event.phaseId } }),
  ]);
  const sum = (rows) => rows.reduce((s, r) => s + Number(r.capacityMw || 0), 0);
  const projFtc = kind === 'ftc' ? sum(ftc) - Number(event.capacityMw) : sum(ftc);
  const projToc = kind === 'toc' ? sum(toc) - Number(event.capacityMw) : sum(toc);
  const projCod = kind === 'cod' ? sum(cod) - Number(event.capacityMw) : sum(cod);
  const TOL = 0.01;
  if (projToc > projFtc + TOL) {
    return { error: `Cannot delete: would leave TOC (${projToc.toFixed(2)} MW) greater than FTC (${projFtc.toFixed(2)} MW). Delete downstream TOC/COD first.` };
  }
  if (projCod > projToc + TOL) {
    return { error: `Cannot delete: would leave COD (${projCod.toFixed(2)} MW) greater than TOC (${projToc.toFixed(2)} MW). Delete downstream COD first.` };
  }

  await prisma[model].delete({ where: { id: eventId } });
  await refreshCommissioningCache(event.phaseId);

  const label = LABEL_BY_KIND[kind];
  await prisma.projectNote.create({
    data: {
      projectId: event.phase.projectId,
      phaseId:   event.phaseId,
      userId:    user.id,
      text:      `Removed ${label} event: ${Number(event.capacityMw).toFixed(2)} MW (${new Date(event.eventDate).toISOString().slice(0, 10)}, ${event.phase.sourceType}).`,
      source:    'SYSTEM',
      field:     `${label}Event`,
      oldValue:  `${Number(event.capacityMw).toFixed(2)} MW ${new Date(event.eventDate).toISOString().slice(0,10)}`,
      newValue:  null,
    },
  });

  revalidateGridPages(event.phase.projectId);
  // Same logic as add: deleting a back-dated event mutates history from that
  // date forward, so rebuild affected snapshots.
  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
  const deletedDate = new Date(event.eventDate);
  if (deletedDate.getTime() < todayStart.getTime()) {
    await rebuildSnapshotsFrom(deletedDate);
  } else {
    void takeSnapshot();
  }
  return { success: true };
}

// ─── CONTD-4 CLEARANCE ────────────────────────────────────────────────────────

const ROLE_REGION_MAP = { SRLDC: 'SR', NRLDC: 'NR', ERLDC: 'ER', WRLDC: 'WR', NERLDC: 'NER' };

export async function clearContd4(projectId, clearanceRemarks) {
  let user;
  try { user = await requireServerUser(); }
  catch { return { error: 'Session expired. Please log in again.' }; }

  if (!clearanceRemarks?.trim()) {
    return { error: 'Clearance reason is required.' };
  }

  const project = await prisma.generationProject.findUnique({
    where: { id: projectId },
    include: { region: true, plantType: true, _count: { select: { phases: true } } },
  });
  if (!project) return { error: 'Project not found.' };

  const isGlobal  = user.role === 'ADMIN' || user.role === 'NLDC';
  const isOwnRgn  = ROLE_REGION_MAP[user.role] === project.region.code;
  if (!isGlobal && !isOwnRgn) {
    return { error: `You can only clear projects in your assigned region (${ROLE_REGION_MAP[user.role] ?? 'N/A'}).` };
  }

  // Clearing CONTD-4 puts the project into the FTC pipeline — a hybrid must be
  // source-splittable before that happens.
  const splitErr = hybridSplitError(project, project._count.phases);
  if (splitErr) return { error: splitErr };

  const existing = await prisma.contd4Application.findUnique({ where: { projectId } });
  if (!existing) return { error: 'No CONTD-4 application linked to this project.' };
  if (existing.status === 'CLEARED') return { error: 'This application is already cleared.' };

  try {
    await prisma.contd4Application.update({
      where: { projectId },
      data: { status: 'CLEARED' },
    });

    await prisma.projectNote.createMany({
      data: [
        {
          projectId,
          userId:   user.id,
          text:     `Status: ${existing.status} → CLEARED`,
          source:   'SYSTEM',
          field:    'Status',
          oldValue: existing.status,
          newValue: 'CLEARED',
        },
        {
          projectId,
          userId:   user.id,
          text:     clearanceRemarks.trim(),
          source:   'MANUAL',
          field:    null,
          oldValue: null,
          newValue: null,
        },
      ],
    });
  } catch (e) {
    console.error('clearContd4 error:', e);
    return { error: 'Failed to clear CONTD-4. Please try again.' };
  }

  revalidateGridPages(projectId);
  void takeSnapshot();
  void notifyContd4StatusChanged({
    project,
    regionCode: project.region?.code,
    oldStatus: existing.status,
    newStatus: 'CLEARED',
    actorUserId: user.id,
  });
  return { success: true };
}

// ─── COMMISSIONING PHASES ─────────────────────────────────────────────────────

export async function addCommissioningPhases(projectId, formData) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };
  if (!canEditGridData(user.role)) return { error: 'Your role is read-only. Editing requires an RLDC or Administrator account.' };

  const project = await prisma.generationProject.findUniqueOrThrow({
    where: { id: projectId },
    include: { phases: true, plantType: true },
  });

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== project.regionId) {
    return { error: 'Access denied.' };
  }

  // isIntrastate is server-authoritative: stamp it from the project row so a
  // client can't bypass the COD ≤ TOC rule by sending the flag manually.
  const parsed = createPhasesSchema.safeParse({
    ...formData,
    phases: (formData?.phases ?? []).map((p) => ({ ...p, isIntrastate: project.isIntrastate })),
  });
  if (!parsed.success) return { error: parsed.error.flatten() };

  // Per-source capacity cap + component-source validation for hybrid projects
  if (project.plantType.isHybrid) {
    try {
      validateHybridPhaseSources(project, parsed.data.phases);
      validateSourceCap(project, parsed.data.phases);
    } catch (e) {
      return { error: e.message };
    }
  }

  try {
    validateSourcePipeline(project.phases, parsed.data.phases);
  } catch (e) {
    return { error: e.message };
  }

  // Helper: sum MW from event list
  const evSum  = (evs) => (evs ?? []).reduce((s, e) => s + (parseFloat(e.mw) || 0), 0);
  // Helper: latest date from event list (for the cached summary date field)
  const evLatestDate = (evs) => {
    const dates = (evs ?? []).map((e) => parseDate(e.date)).filter(Boolean);
    if (!dates.length) return null;
    return dates.reduce((max, d) => (d > max ? d : max));
  };

  const createdPhases = await prisma.$transaction(
    parsed.data.phases.map((p) => {
      const ftcTotal = evSum(p.ftcEvents);
      const tocTotal = evSum(p.tocEvents);
      const codTotal = evSum(p.codEvents);
      return prisma.commissioningPhase.create({
        data: {
          projectId,
          sourceType:         p.sourceType,
          capacityAppliedMw:  parseFloat(p.capacityAppliedMw),
          // Summary fields derived from events (kept in sync for legacy readers)
          ftcCompletedMw:     ftcTotal > 0 ? ftcTotal : null,
          ftcCompletedDate:   evLatestDate(p.ftcEvents),
          proposedFtcDate:    parseDate(p.proposedFtcDate),
          capacityUnderFtcMw: parseDecimal(p.capacityUnderFtcMw),
          tocIssuedMw:        tocTotal > 0 ? tocTotal : null,
          tocIssuedDate:      evLatestDate(p.tocEvents),
          capacityUnderTocMw: parseDecimal(p.capacityUnderTocMw),
          codDeclaredMw:      codTotal > 0 ? codTotal : null,
          codDeclaredDate:    evLatestDate(p.codEvents),
          expectedApr26Mw:    parseDecimal(p.expectedApr26Mw),
          expectedMonth:      p.expectedMonth || null,
          delayRemarks:       p.delayRemarks || null,
          otherRemarks:       p.otherRemarks || null,
          // Event records — one row per partial FTC / TOC / COD commissioning
          ftcEvents: {
            createMany: {
              data: (p.ftcEvents ?? []).map((e) => ({
                eventDate:  parseDate(e.date),
                capacityMw: parseFloat(e.mw),
                remarks:    e.remarks || null,
              })),
            },
          },
          tocEvents: {
            createMany: {
              data: (p.tocEvents ?? []).map((e) => ({
                eventDate:  parseDate(e.date),
                capacityMw: parseFloat(e.mw),
                remarks:    e.remarks || null,
              })),
            },
          },
          codEvents: {
            createMany: {
              data: (p.codEvents ?? []).map((e) => ({
                eventDate:  parseDate(e.date),
                capacityMw: parseFloat(e.mw),
                remarks:    e.remarks || null,
              })),
            },
          },
        },
      });
    })
  );

  await prisma.projectNote.createMany({
    data: createdPhases.map((ph) => ({
      projectId,
      phaseId:  ph.id,
      userId:   user.id,
      text:     `Phase created: ${ph.sourceType} — ${Number(ph.capacityAppliedMw).toFixed(1)} MW applied`,
      source:   'SYSTEM',
      field:    null,
      oldValue: null,
      newValue: null,
    })),
  });

  // Recording commissioning data places the project in the FTC pipeline,
  // independent of its CONTD-4 status.
  await prisma.generationProject.update({ where: { id: projectId }, data: { inFtcPipeline: true } });

  revalidateGridPages(projectId);
  void takeSnapshot();
  return { success: true };
}

// Upsert variant of addCommissioningPhases: each input phase may carry an
// `existingId`. Those rows replace the existing phase in place (update
// summary fields + nuke and recreate event rows), while rows without an
// existingId fall through to the standard create path. Used by the
// "Add Commissioning Phase" modal in edit mode, so that pre-filling the
// form with existing data and saving doesn't create duplicate phases.
export async function upsertProjectPhases(projectId, formData) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };
  if (!canEditGridData(user.role)) return { error: 'Your role is read-only. Editing requires an RLDC or Administrator account.' };

  const project = await prisma.generationProject.findUniqueOrThrow({
    where: { id: projectId },
    include: { phases: true, plantType: true },
  });

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== project.regionId) {
    return { error: 'Access denied.' };
  }

  // isIntrastate is server-authoritative (see addCommissioningPhases).
  const parsed = createPhasesSchema.safeParse({
    ...formData,
    phases: (formData?.phases ?? []).map((p) => ({ ...p, isIntrastate: project.isIntrastate })),
  });
  if (!parsed.success) return { error: parsed.error.flatten() };

  // Per-source capacity cap validation: only counts NEW phases (not the
  // ones being updated in place) so the cap isn't double-counted.
  const existingByOwnId = new Map(project.phases.map((p) => [p.id, p]));
  const newPhases       = parsed.data.phases.filter((p) => !p.existingId);
  const updatedPhases   = parsed.data.phases.filter((p) =>  p.existingId);
  if (project.plantType.isHybrid) {
    try {
      validateHybridPhaseSources(project, parsed.data.phases);
      validateSourceCap(project, newPhases);
    }
    catch (e) { return { error: e.message }; }
  }

  // Pipeline-chain validation excludes the existing phases that this call
  // is replacing — otherwise they'd be counted twice.
  const stillExistingPhases = project.phases.filter(
    (p) => !updatedPhases.some((u) => u.existingId === p.id),
  );
  try {
    validateSourcePipeline(stillExistingPhases, parsed.data.phases);
  } catch (e) {
    return { error: e.message };
  }

  // Applied-capacity ceiling (covers non-hybrids AND edits, which the
  // new-phase-only check above misses): the post-save applied capacity must not
  // exceed the plant's total (single-source) or each component's capacity
  // (hybrid). finalPhases = existing rows this call keeps + all submitted rows.
  {
    const capField = { WIND: 'windCapacityMw', SOLAR: 'solarCapacityMw', BESS: 'bessCapacityMw' };
    const appliedBySource = {};
    for (const p of stillExistingPhases) appliedBySource[p.sourceType] = (appliedBySource[p.sourceType] ?? 0) + Number(p.capacityAppliedMw ?? 0);
    for (const p of parsed.data.phases) appliedBySource[p.sourceType] = (appliedBySource[p.sourceType] ?? 0) + (parseFloat(p.capacityAppliedMw) || 0);
    const total = Number(project.totalCapacityMw);
    if (project.plantType.isHybrid) {
      for (const [src, ap] of Object.entries(appliedBySource)) {
        const cap = project[capField[src]] != null ? Number(project[capField[src]]) : total;
        if (ap > cap + 0.01) return { error: `${src} applied capacity (${ap} MW) exceeds its capacity of ${cap} MW.` };
      }
    } else {
      const totalApplied = Object.values(appliedBySource).reduce((a, b) => a + b, 0);
      if (totalApplied > total + 0.01) {
        return { error: `Applied capacity (${totalApplied} MW) exceeds the plant's total capacity of ${total} MW.` };
      }
    }
  }

  const evSum  = (evs) => (evs ?? []).reduce((s, e) => s + (parseFloat(e.mw) || 0), 0);
  const evLatestDate = (evs) => {
    const dates = (evs ?? []).map((e) => parseDate(e.date)).filter(Boolean);
    if (!dates.length) return null;
    return dates.reduce((max, d) => (d > max ? d : max));
  };
  const phaseData = (p) => {
    const ftcTotal = evSum(p.ftcEvents);
    const tocTotal = evSum(p.tocEvents);
    const codTotal = evSum(p.codEvents);
    return {
      sourceType:         p.sourceType,
      capacityAppliedMw:  parseFloat(p.capacityAppliedMw),
      ftcCompletedMw:     ftcTotal > 0 ? ftcTotal : null,
      ftcCompletedDate:   evLatestDate(p.ftcEvents),
      proposedFtcDate:    parseDate(p.proposedFtcDate),
      capacityUnderFtcMw: parseDecimal(p.capacityUnderFtcMw),
      tocIssuedMw:        tocTotal > 0 ? tocTotal : null,
      tocIssuedDate:      evLatestDate(p.tocEvents),
      capacityUnderTocMw: parseDecimal(p.capacityUnderTocMw),
      codDeclaredMw:      codTotal > 0 ? codTotal : null,
      codDeclaredDate:    evLatestDate(p.codEvents),
      expectedApr26Mw:    parseDecimal(p.expectedApr26Mw),
      expectedMonth:      p.expectedMonth || null,
      delayRemarks:       p.delayRemarks || null,
      otherRemarks:       p.otherRemarks || null,
    };
  };
  const eventCreateMany = (evs) => ({
    createMany: {
      data: (evs ?? []).map((e) => ({
        eventDate:  parseDate(e.date),
        capacityMw: parseFloat(e.mw),
        remarks:    e.remarks || null,
      })),
    },
  });

  // Per-event upsert helper: events with an `id` are updated in place so
  // their original createdAt is preserved (audit trail). Events without
  // an `id` are inserted as new. Events that existed before but aren't in
  // the form payload are deleted.
  async function reconcileEvents(tx, model, phaseId, incoming) {
    const incomingIds = new Set((incoming ?? []).map((e) => e.id).filter(Boolean));
    // Delete any DB event whose id isn't in the incoming list.
    await tx[model].deleteMany({
      where: {
        phaseId,
        ...(incomingIds.size > 0 ? { id: { notIn: Array.from(incomingIds) } } : {}),
      },
    });
    // Update existing events; create new ones.
    for (const e of (incoming ?? [])) {
      const data = {
        eventDate:  parseDate(e.date),
        capacityMw: parseFloat(e.mw),
        remarks:    e.remarks || null,
      };
      if (e.id) {
        await tx[model].update({ where: { id: e.id }, data });
      } else {
        await tx[model].create({ data: { phaseId, ...data } });
      }
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Update path: refresh the phase row, then reconcile each event
      // collection individually so original createdAt timestamps survive.
      for (const p of updatedPhases) {
        const existing = existingByOwnId.get(p.existingId);
        if (!existing) continue;
        await tx.commissioningPhase.update({ where: { id: p.existingId }, data: phaseData(p) });
        await reconcileEvents(tx, 'ftcEvent', p.existingId, p.ftcEvents);
        await reconcileEvents(tx, 'tocEvent', p.existingId, p.tocEvents);
        await reconcileEvents(tx, 'codEvent', p.existingId, p.codEvents);
      }
      // Insert path: rows without existingId become brand-new phases.
      for (const p of newPhases) {
        await tx.commissioningPhase.create({
          data: {
            projectId,
            ...phaseData(p),
            ftcEvents: eventCreateMany(p.ftcEvents),
            tocEvents: eventCreateMany(p.tocEvents),
            codEvents: eventCreateMany(p.codEvents),
          },
        });
      }
    });
  } catch (e) {
    console.error('upsertProjectPhases error:', e);
    return { error: 'Failed to save phases. Please try again.' };
  }

  // Audit log — one entry per affected phase, distinguishing update vs create.
  await prisma.projectNote.createMany({
    data: [
      ...updatedPhases.map((p) => ({
        projectId,
        phaseId: p.existingId,
        userId:  user.id,
        text:    `Phase updated via Add Phase modal: ${p.sourceType} — ${Number(p.capacityAppliedMw).toFixed(1)} MW applied`,
        source:  'SYSTEM',
        field:   null, oldValue: null, newValue: null,
      })),
      ...newPhases.map((p) => ({
        projectId,
        userId:  user.id,
        text:    `Phase created: ${p.sourceType} — ${Number(p.capacityAppliedMw).toFixed(1)} MW applied`,
        source:  'SYSTEM',
        field:   null, oldValue: null, newValue: null,
      })),
    ],
  });

  // Recording commissioning data places the project in the FTC pipeline.
  await prisma.generationProject.update({ where: { id: projectId }, data: { inFtcPipeline: true } });

  revalidateGridPages(projectId);
  void takeSnapshot();
  return { success: true };
}

export async function updateCommissioningPhase(phaseId, formData) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };
  if (!canEditGridData(user.role)) return { error: 'Your role is read-only. Editing requires an RLDC or Administrator account.' };
  const phase = await prisma.commissioningPhase.findUniqueOrThrow({
    where: { id: phaseId },
    include: { project: true },
  });

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== phase.project.regionId) {
    return { error: 'Access denied.' };
  }

  await prisma.commissioningPhase.update({
    where: { id: phaseId },
    data: {
      ftcCompletedMw:      parseDecimal(formData.ftcCompletedMw),
      ftcCompletedDate:    parseDate(formData.ftcCompletedDate),
      proposedFtcDate:     parseDate(formData.proposedFtcDate),
      capacityUnderFtcMw:  parseDecimal(formData.capacityUnderFtcMw),
      tocIssuedMw:         parseDecimal(formData.tocIssuedMw),
      tocIssuedDate:       parseDate(formData.tocIssuedDate),
      capacityUnderTocMw:  parseDecimal(formData.capacityUnderTocMw),
      codDeclaredMw:       parseDecimal(formData.codDeclaredMw),
      codDeclaredDate:     parseDate(formData.codDeclaredDate),
      expectedApr26Mw:     parseDecimal(formData.expectedApr26Mw),
      expectedMonth:       formData.expectedMonth || null,
      delayCategory:       formData.delayCategory || null,
      delayRemarks:        formData.delayRemarks || null,
      otherRemarks:        formData.otherRemarks || null,
    },
  });

  const prefix = `Phase ${phase.sourceType}`;
  const logs = diffFields([
    { field: `${prefix} — FTC Completed`,    old: fmtMw(phase.ftcCompletedMw),     new: fmtMw(formData.ftcCompletedMw) },
    { field: `${prefix} — FTC Date`,         old: fmtDate(phase.ftcCompletedDate),  new: fmtDate(parseDate(formData.ftcCompletedDate)) },
    { field: `${prefix} — Proposed FTC`,     old: fmtDate(phase.proposedFtcDate),   new: fmtDate(parseDate(formData.proposedFtcDate)) },
    { field: `${prefix} — Under FTC`,        old: fmtMw(phase.capacityUnderFtcMw),  new: fmtMw(formData.capacityUnderFtcMw) },
    { field: `${prefix} — TOC Issued`,       old: fmtMw(phase.tocIssuedMw),         new: fmtMw(formData.tocIssuedMw) },
    { field: `${prefix} — TOC Date`,         old: fmtDate(phase.tocIssuedDate),     new: fmtDate(parseDate(formData.tocIssuedDate)) },
    { field: `${prefix} — Under TOC`,        old: fmtMw(phase.capacityUnderTocMw),  new: fmtMw(formData.capacityUnderTocMw) },
    { field: `${prefix} — COD Declared`,     old: fmtMw(phase.codDeclaredMw),       new: fmtMw(formData.codDeclaredMw) },
    { field: `${prefix} — COD Date`,         old: fmtDate(phase.codDeclaredDate),   new: fmtDate(parseDate(formData.codDeclaredDate)) },
    { field: `${prefix} — Expected`,         old: fmtMw(phase.expectedApr26Mw),     new: fmtMw(formData.expectedApr26Mw) },
    { field: `${prefix} — Delay Category`,   old: fmtStr(phase.delayCategory),      new: fmtStr(formData.delayCategory) },
    { field: `${prefix} — Delay Remarks`,    old: fmtStr(phase.delayRemarks),       new: fmtStr(formData.delayRemarks) },
  ], phase.projectId, user.id, phaseId);
  if (logs.length) await prisma.projectNote.createMany({ data: logs });

  revalidateGridPages(phase.projectId);
  void takeSnapshot();
  return { success: true };
}

export async function deleteCommissioningPhase(phaseId) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };
  if (!canEditGridData(user.role)) return { error: 'Your role is read-only. Editing requires an RLDC or Administrator account.' };
  const phase = await prisma.commissioningPhase.findUniqueOrThrow({
    where: { id: phaseId },
    include: { project: { include: { plantType: true, contd4: { select: { status: true } } } } },
  });

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== phase.project.regionId) {
    return { error: 'Access denied.' };
  }

  const projectId = phase.projectId;

  // Deleting the LAST phase of a pipeline hybrid would leave it with no
  // source-wise data (unattributable in the Including-Hybrid views) — block it
  // unless another split source (segregation / capacity columns) exists.
  const proj = phase.project;
  const inPipeline = proj.inFtcPipeline === true || proj.contd4?.status === 'CLEARED';
  if (inPipeline) {
    const remaining = await prisma.commissioningPhase.count({
      where: { projectId, id: { not: phaseId } },
    });
    const splitErr = hybridSplitError(proj, remaining);
    if (splitErr) {
      return { error: `Cannot delete the last phase of this hybrid: ${splitErr}` };
    }
  }

  // Log before delete (phaseId will cascade-null via SetNull)
  await prisma.projectNote.create({
    data: {
      projectId,
      phaseId:  null,
      userId:   user.id,
      text:     `Phase deleted: ${phase.sourceType} — ${Number(phase.capacityAppliedMw).toFixed(1)} MW applied (FTC: ${fmtMw(phase.ftcCompletedMw)}, TOC: ${fmtMw(phase.tocIssuedMw)}, COD: ${fmtMw(phase.codDeclaredMw)})`,
      source:   'SYSTEM',
      field:    'Phase',
      oldValue: `${phase.sourceType} ${Number(phase.capacityAppliedMw).toFixed(1)} MW`,
      newValue: 'DELETED',
    },
  });

  await prisma.commissioningPhase.delete({ where: { id: phaseId } });
  revalidateGridPages(projectId);
  void takeSnapshot();
  return { success: true };
}

// ─── TRANSMISSION ELEMENTS ────────────────────────────────────────────────────

export async function createTransmissionElement(formData) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };
  if (!canEditGridData(user.role)) return { error: 'Your role is read-only. Editing requires an RLDC or Administrator account.' };

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== formData.regionId) {
    return { error: 'You can only create elements in your assigned region.' };
  }

  const parsed = createTransmissionSchema.safeParse(formData);
  if (!parsed.success) return { error: parsed.error.flatten() };

  const data = parsed.data;
  const el = await prisma.transmissionElement.create({
    include: { region: { select: { code: true } } },
    data: {
      regionId:          data.regionId,
      agencyOwner:       data.agencyOwner,
      elementName:       data.elementName,
      elementType:       data.elementType,
      isRe:              data.isRe,
      voltageRatingKv:   data.voltageRatingKv ? parseInt(data.voltageRatingKv) : null,
      capacityMva:       parseDecimal(data.capacityMva),
      lineLengthKm:      parseDecimal(data.lineLengthKm),
      firstEnergyDate:   parseDate(data.firstEnergyDate),
      pendingFtc:        data.pendingFtc,
      proposedFtcDate:   parseDate(data.proposedFtcDate),
      capacityApr26Mva:  parseDecimal(data.capacityApr26Mva),
      lineLengthApr26Km: parseDecimal(data.lineLengthApr26Km),
      remarks:           data.remarks || null,
    },
  });

  await prisma.transmissionAuditLog.create({
    data: {
      elementId:   el.id,
      elementName: el.elementName,
      userId:      user.id,
      action:      'CREATE',
      field:       null,
      oldValue:    null,
      newValue:    `${el.elementName} (${el.elementType}, ${el.isRe ? 'RE' : 'Non-RE'})`,
      stateJson:   txStateSnapshot(el),
    },
  });

  revalidateTransmissionPages();
  void takeSnapshot();
  void notifyTransmissionUpdated({
    element: el,
    regionCode: el.region?.code,
    action: 'created',
    actorUserId: user.id,
  });
  return { success: true };
}

export async function updateTransmissionElement(elementId, formData) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };
  if (!canEditGridData(user.role)) return { error: 'Your role is read-only. Editing requires an RLDC or Administrator account.' };
  const element = await prisma.transmissionElement.findUniqueOrThrow({ where: { id: elementId } });

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== element.regionId) {
    return { error: 'Access denied.' };
  }

  const parsed = createTransmissionSchema.safeParse(formData);
  if (!parsed.success) return { error: parsed.error.flatten() };

  const data = parsed.data;
  const effectiveDate = resolveEffectiveDate(user.role, data.effectiveDate);

  const updated = await prisma.transmissionElement.update({
    where: { id: elementId },
    data: {
      agencyOwner:       data.agencyOwner,
      elementName:       data.elementName,
      elementType:       data.elementType,
      isRe:              data.isRe,
      voltageRatingKv:   data.voltageRatingKv ? parseInt(data.voltageRatingKv) : null,
      capacityMva:       parseDecimal(data.capacityMva),
      lineLengthKm:      parseDecimal(data.lineLengthKm),
      firstEnergyDate:   parseDate(data.firstEnergyDate),
      pendingFtc:        data.pendingFtc,
      proposedFtcDate:   parseDate(data.proposedFtcDate),
      capacityApr26Mva:  parseDecimal(data.capacityApr26Mva),
      lineLengthApr26Km: parseDecimal(data.lineLengthApr26Km),
      remarks:           data.remarks || null,
    },
  });
  const postState = txStateSnapshot(updated);

  const fmtBool = (v) => (v ? 'Yes' : 'No');
  const fmtKv   = (v) => (v ? `${v} kV` : '—');
  const fmtMva  = (v) => (v != null && v !== '' ? `${Number(v).toFixed(1)} MVA` : '—');
  const fmtKm   = (v) => (v != null && v !== '' ? `${Number(v).toFixed(3)} km` : '—');

  const txLogs = [
    { field: 'Element Name',       old: fmtStr(element.elementName),       new: fmtStr(data.elementName) },
    { field: 'Agency/Owner',       old: fmtStr(element.agencyOwner),       new: fmtStr(data.agencyOwner) },
    { field: 'Type',               old: fmtStr(element.elementType),       new: fmtStr(data.elementType) },
    { field: 'RE',                 old: fmtBool(element.isRe),             new: fmtBool(data.isRe) },
    { field: 'Voltage (kV)',       old: fmtKv(element.voltageRatingKv),    new: fmtKv(data.voltageRatingKv) },
    { field: 'Capacity (MVA)',     old: fmtMva(element.capacityMva),       new: fmtMva(data.capacityMva) },
    { field: 'Line Length (km)',   old: fmtKm(element.lineLengthKm),       new: fmtKm(data.lineLengthKm) },
    { field: 'Pending FTC',        old: fmtBool(element.pendingFtc),       new: fmtBool(data.pendingFtc) },
    { field: 'Proposed FTC Date',  old: fmtDate(element.proposedFtcDate),  new: fmtDate(parseDate(data.proposedFtcDate)) },
    { field: 'Cap to Commission',  old: fmtMva(element.capacityApr26Mva),  new: fmtMva(data.capacityApr26Mva) },
    { field: 'Length to Commission', old: fmtKm(element.lineLengthApr26Km), new: fmtKm(data.lineLengthApr26Km) },
    { field: 'Remarks',            old: fmtStr(element.remarks),           new: fmtStr(data.remarks) },
  ].filter((t) => t.old !== t.new)
   .map((t) => ({
      elementId,
      userId:   user.id,
      action:   'UPDATE',
      field:    t.field,
      oldValue: t.old,
      newValue: t.new,
      effectiveDate,
      stateJson: postState,
    }));

  if (txLogs.length) await prisma.transmissionAuditLog.createMany({
    data: txLogs.map((l) => ({ ...l, elementName: element.elementName })),
  });

  revalidateTransmissionPages();
  if (effectiveDate) await rebuildSnapshotsFrom(effectiveDate);
  else void takeSnapshot();
  return { success: true };
}

// Soft-delete (deactivation). Toggle: if already inactive, reactivates.
// `{ hard: true }` (admin-only) wipes the row entirely.
export async function deleteTransmissionElement(elementId, opts = {}) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };
  if (!canEditGridData(user.role)) return { error: 'Your role is read-only. Editing requires an RLDC or Administrator account.' };
  const element = await prisma.transmissionElement.findUniqueOrThrow({ where: { id: elementId } });

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== element.regionId) {
    return { error: 'Access denied.' };
  }

  const willReactivate = !!element.activeUntil && !opts.hard;
  await prisma.transmissionAuditLog.create({
    data: {
      elementId:   elementId,
      elementName: element.elementName,
      userId:      user.id,
      action:      opts.hard ? 'DELETE' : (willReactivate ? 'REACTIVATE' : 'DEACTIVATE'),
      field:       null,
      oldValue:    `${element.elementName} (${element.elementType})`,
      newValue:    opts.hard ? 'DELETED' : (willReactivate ? 'ACTIVE' : 'INACTIVE'),
    },
  });

  if (opts.hard && user.role === 'ADMIN') {
    await prisma.transmissionElement.delete({ where: { id: elementId } });
  } else {
    await prisma.transmissionElement.update({
      where: { id: elementId },
      data: willReactivate ? { activeUntil: null } : { activeUntil: new Date() },
    });
  }
  revalidateTransmissionPages();
  void takeSnapshot();
  return { success: true, deactivated: !opts.hard };
}

// ─── MASTER DATA ─────────────────────────────────────────────────────────────

export async function createPoolingStation(formData) {
  const _auth = await authedUser();
  if (!_auth) return { error: 'Session expired. Please log in again.' };
  if (!canEditGridData(_auth.role)) return { error: 'Your role is read-only. Editing requires an RLDC or Administrator account.' };
  const name = String(formData.name ?? '').trim();
  const regionId = String(formData.regionId ?? '').trim();
  const voltageKv = formData.voltageKv ? parseInt(formData.voltageKv) : null;
  if (!name || !regionId) return { error: 'Name and region are required.' };

  // Region scope — an RLDC may only create pooling stations in its own region.
  const scope = await buildRegionScope(_auth.role);
  if (scope.regionId && scope.regionId !== regionId) {
    return { error: 'You cannot create pooling stations outside your assigned region.' };
  }

  const existing = await prisma.poolingStation.findFirst({ where: { name, regionId } });
  if (existing) return { error: 'A pooling station with this name already exists in the region.' };

  const station = await prisma.poolingStation.create({
    data: { name, regionId, voltageKv },
  });
  revalidatePath('/generation');
  revalidatePath('/generation/new');
  return { success: true, station };
}

// ─── AUDIT FEED ───────────────────────────────────────────────────────────────

export async function addProjectNote(projectId, text) {
  let user;
  try { user = await requireServerUser(); }
  catch { return { error: 'Session expired. Please refresh the page and log in again.' }; }

  if (!text || typeof text !== 'string') return { error: 'Note text is required.' };
  const trimmed = text.trim();
  if (trimmed.length === 0) return { error: 'Note cannot be empty.' };
  if (trimmed.length > 2000) return { error: 'Note must be under 2000 characters.' };

  // Verify the project exists
  const project = await prisma.generationProject.findUnique({ where: { id: projectId } });
  if (!project) return { error: 'Project not found.' };

  // Region scope — an RLDC may only annotate projects in its own region.
  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== project.regionId) {
    return { error: 'You cannot add notes to projects outside your assigned region.' };
  }

  await prisma.projectNote.create({
    data: { projectId, userId: user.id, text: trimmed },
  });

  revalidatePath(`/generation/${projectId}`);
  return { success: true };
}

export async function markTransmissionFtcDone(elementId) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };
  if (!canEditGridData(user.role)) return { error: 'Your role is read-only. Editing requires an RLDC or Administrator account.' };
  const element = await prisma.transmissionElement.findUniqueOrThrow({ where: { id: elementId } });

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== element.regionId) {
    return { error: 'Access denied.' };
  }

  await prisma.transmissionElement.update({
    where: { id: elementId },
    data: { pendingFtc: false },
  });

  await prisma.transmissionAuditLog.create({
    data: {
      elementId,
      elementName: element.elementName,
      userId:      user.id,
      action:      'UPDATE',
      field:       'pendingFtc',
      oldValue:    'true',
      newValue:    'false',
    },
  });

  revalidateTransmissionPages();
  void takeSnapshot();
  return { success: true };
}
