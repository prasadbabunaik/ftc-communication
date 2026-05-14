'use server';

import { revalidatePath } from 'next/cache';
import { requireServerUser, buildRegionScope } from '@/lib/server-auth';
import { prisma } from '@/lib/prisma';
import {
  createProjectSchema,
  createPhasesSchema,
  createTransmissionSchema,
  contd4Schema,
} from '@/lib/validations/grid';

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

function validateSourcePipeline(existingPhases, newPhases) {
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
    acc[s].ftc += parseFloat(ph.ftcCompletedMw || '0') || 0;
    acc[s].toc += parseFloat(ph.tocIssuedMw    || '0') || 0;
    acc[s].cod += parseFloat(ph.codDeclaredMw  || '0') || 0;
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
  const parsed = createProjectSchema.safeParse(formData);
  if (!parsed.success) return { error: parsed.error.flatten() };

  const data = parsed.data;

  // RLDC users can only create projects in their own region
  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== data.regionId) {
    return { error: 'You can only create projects in your assigned region.' };
  }

  let project;
  try {
    project = await prisma.generationProject.create({
      data: {
        name: data.name,
        developerName: data.developerName || null,
        regionId: data.regionId,
        plantTypeId: data.plantTypeId,
        poolingStationId: data.poolingStationId || null,
        totalCapacityMw: parseFloat(data.totalCapacityMw),
        windCapacityMw:  parseDecimal(data.windCapacityMw),
        solarCapacityMw: parseDecimal(data.solarCapacityMw),
        bessCapacityMw:  parseDecimal(data.bessCapacityMw),
        createdById: user.id,
        ...(data.createContd4 && data.contd4
          ? {
              contd4: {
                create: {
                  applicationDate: new Date(data.contd4.applicationDate),
                  proposedFtcDate: parseDate(data.contd4.proposedFtcDate),
                  capacityApr26Mw: parseDecimal(data.contd4.capacityApr26Mw),
                  capacityMonth:   data.contd4.capacityMonth || null,
                  status: data.contd4.status,
                  remarks: data.contd4.remarks || null,
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

  revalidateGridPages(project.id);
  return { success: true, id: project.id };
}

export async function updateGenerationProject(projectId, formData) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };
  const project = await prisma.generationProject.findUniqueOrThrow({ where: { id: projectId } });

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== project.regionId) {
    return { error: 'You cannot edit projects outside your assigned region.' };
  }

  await prisma.generationProject.update({
    where: { id: projectId },
    data: {
      name:             formData.name,
      developerName:    formData.developerName || null,
      poolingStationId: formData.poolingStationId || null,
      totalCapacityMw:  parseFloat(formData.totalCapacityMw),
      windCapacityMw:   parseDecimal(formData.windCapacityMw),
      solarCapacityMw:  parseDecimal(formData.solarCapacityMw),
      bessCapacityMw:   parseDecimal(formData.bessCapacityMw),
    },
  });

  const logs = diffFields([
    { field: 'Name',               old: fmtStr(project.name),            new: fmtStr(formData.name) },
    { field: 'Developer',          old: fmtStr(project.developerName),   new: fmtStr(formData.developerName) },
    { field: 'Total Capacity',     old: fmtMw(project.totalCapacityMw),  new: fmtMw(formData.totalCapacityMw) },
    { field: 'Wind Capacity',      old: fmtMw(project.windCapacityMw),   new: fmtMw(formData.windCapacityMw) },
    { field: 'Solar Capacity',     old: fmtMw(project.solarCapacityMw),  new: fmtMw(formData.solarCapacityMw) },
    { field: 'BESS Capacity',      old: fmtMw(project.bessCapacityMw),   new: fmtMw(formData.bessCapacityMw) },
    { field: 'Pooling Station ID', old: fmtStr(project.poolingStationId), new: fmtStr(formData.poolingStationId || null) },
  ], projectId, user.id);
  if (logs.length) await prisma.projectNote.createMany({ data: logs });

  revalidateGridPages(projectId);
  return { success: true };
}

export async function deleteGenerationProject(projectId) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };
  const project = await prisma.generationProject.findUnique({ where: { id: projectId } });
  if (!project) return { error: 'Project not found.' };

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== project.regionId) {
    return { error: 'Access denied.' };
  }

  await prisma.generationProject.delete({ where: { id: projectId } });
  revalidateGridPages();
  return { success: true };
}

// ─── CONTD-4 ──────────────────────────────────────────────────────────────────

export async function upsertContd4(projectId, formData) {
  let user;
  try { user = await requireServerUser(); }
  catch { return { error: 'Session expired. Please refresh the page and log in again.' }; }
  const project = await prisma.generationProject.findUniqueOrThrow({ where: { id: projectId } });

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== project.regionId) {
    return { error: 'Access denied.' };
  }

  const parsed = contd4Schema.safeParse(formData);
  if (!parsed.success) return { error: parsed.error.flatten() };

  const data = parsed.data;

  // Fetch existing for change tracking diff
  const existing = await prisma.contd4Application.findUnique({ where: { projectId } });

  const newValues = {
    applicationDate: new Date(data.applicationDate),
    proposedFtcDate: parseDate(data.proposedFtcDate),
    capacityApr26Mw: parseDecimal(data.capacityApr26Mw),
    capacityMonth:   data.capacityMonth || null,
    status:          data.status,
    remarks:         data.remarks || null,
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
      { field: 'Capacity Apr\'26', old: fmtMw(existing.capacityApr26Mw), new: fmtMw(newValues.capacityApr26Mw) },
      { field: 'Status', old: fmtStr(existing.status), new: fmtStr(newValues.status) },
      { field: 'Remarks', old: fmtStr(existing.remarks), new: fmtStr(newValues.remarks) },
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
    });
  }

  if (changeLogs.length > 0) {
    await prisma.projectNote.createMany({ data: changeLogs });
  }

  revalidateGridPages(projectId);
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
    include: { region: true },
  });
  if (!project) return { error: 'Project not found.' };

  const isGlobal  = user.role === 'ADMIN' || user.role === 'NLDC';
  const isOwnRgn  = ROLE_REGION_MAP[user.role] === project.region.code;
  if (!isGlobal && !isOwnRgn) {
    return { error: `You can only clear projects in your assigned region (${ROLE_REGION_MAP[user.role] ?? 'N/A'}).` };
  }

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
  return { success: true };
}

// ─── COMMISSIONING PHASES ─────────────────────────────────────────────────────

export async function addCommissioningPhases(projectId, formData) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };

  const project = await prisma.generationProject.findUniqueOrThrow({
    where: { id: projectId },
    include: { phases: true, plantType: true },
  });

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== project.regionId) {
    return { error: 'Access denied.' };
  }

  const parsed = createPhasesSchema.safeParse(formData);
  if (!parsed.success) return { error: parsed.error.flatten() };

  // Per-source capacity cap validation for hybrid projects
  if (project.plantType.isHybrid) {
    try {
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

  const createdPhases = await prisma.$transaction(
    parsed.data.phases.map((p) =>
      prisma.commissioningPhase.create({
        data: {
          projectId,
          sourceType:          p.sourceType,
          capacityAppliedMw:   parseFloat(p.capacityAppliedMw),
          ftcCompletedMw:      parseDecimal(p.ftcCompletedMw),
          ftcCompletedDate:    parseDate(p.ftcCompletedDate),
          proposedFtcDate:     parseDate(p.proposedFtcDate),
          capacityUnderFtcMw:  parseDecimal(p.capacityUnderFtcMw),
          tocIssuedMw:         parseDecimal(p.tocIssuedMw),
          tocIssuedDate:       parseDate(p.tocIssuedDate),
          capacityUnderTocMw:  parseDecimal(p.capacityUnderTocMw),
          codDeclaredMw:       parseDecimal(p.codDeclaredMw),
          codDeclaredDate:     parseDate(p.codDeclaredDate),
          expectedApr26Mw:     parseDecimal(p.expectedApr26Mw),
          delayRemarks:        p.delayRemarks || null,
          otherRemarks:        p.otherRemarks || null,
        },
      })
    )
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

  revalidateGridPages(projectId);
  return { success: true };
}

export async function updateCommissioningPhase(phaseId, formData) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };
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
  return { success: true };
}

export async function deleteCommissioningPhase(phaseId) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };
  const phase = await prisma.commissioningPhase.findUniqueOrThrow({
    where: { id: phaseId },
    include: { project: true },
  });

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== phase.project.regionId) {
    return { error: 'Access denied.' };
  }

  const projectId = phase.projectId;

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
  return { success: true };
}

// ─── TRANSMISSION ELEMENTS ────────────────────────────────────────────────────

export async function createTransmissionElement(formData) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== formData.regionId) {
    return { error: 'You can only create elements in your assigned region.' };
  }

  const parsed = createTransmissionSchema.safeParse(formData);
  if (!parsed.success) return { error: parsed.error.flatten() };

  const data = parsed.data;
  const el = await prisma.transmissionElement.create({
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
    },
  });

  revalidateTransmissionPages();
  return { success: true };
}

export async function updateTransmissionElement(elementId, formData) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };
  const element = await prisma.transmissionElement.findUniqueOrThrow({ where: { id: elementId } });

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== element.regionId) {
    return { error: 'Access denied.' };
  }

  const parsed = createTransmissionSchema.safeParse(formData);
  if (!parsed.success) return { error: parsed.error.flatten() };

  const data = parsed.data;
  await prisma.transmissionElement.update({
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
    }));

  if (txLogs.length) await prisma.transmissionAuditLog.createMany({
    data: txLogs.map((l) => ({ ...l, elementName: element.elementName })),
  });

  revalidateTransmissionPages();
  return { success: true };
}

export async function deleteTransmissionElement(elementId) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };
  const element = await prisma.transmissionElement.findUniqueOrThrow({ where: { id: elementId } });

  const scope = await buildRegionScope(user.role);
  if (scope.regionId && scope.regionId !== element.regionId) {
    return { error: 'Access denied.' };
  }

  await prisma.transmissionAuditLog.create({
    data: {
      elementId:   elementId,
      elementName: element.elementName,
      userId:      user.id,
      action:      'DELETE',
      field:       null,
      oldValue:    `${element.elementName} (${element.elementType})`,
      newValue:    'DELETED',
    },
  });

  await prisma.transmissionElement.delete({ where: { id: elementId } });
  revalidateTransmissionPages();
  return { success: true };
}

// ─── MASTER DATA ─────────────────────────────────────────────────────────────

export async function createPoolingStation(formData) {
  const _auth = await authedUser();
  if (!_auth) return { error: 'Session expired. Please log in again.' };
  const name = String(formData.name ?? '').trim();
  const regionId = String(formData.regionId ?? '').trim();
  const voltageKv = formData.voltageKv ? parseInt(formData.voltageKv) : null;
  if (!name || !regionId) return { error: 'Name and region are required.' };

  const existing = await prisma.poolingStation.findFirst({ where: { name, regionId } });
  if (existing) return { error: 'A pooling station with this name already exists in the region.' };

  const station = await prisma.poolingStation.create({
    data: { name, regionId, voltageKv },
  });
  revalidatePath('/generation');
  revalidatePath('/generation/new');
  return { success: true, station };
}

// ─── BULK IMPORT ──────────────────────────────────────────────────────────────

export async function bulkImportRows(type, rows) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };
  const scope = await buildRegionScope(user.role);

  let created = 0;
  let failed = 0;
  const errors = [];

  if (type === 'generation') {
    for (const row of rows) {
      try {
        if (scope.regionId && scope.regionId !== row.regionId) {
          throw new Error('Region mismatch');
        }
        await prisma.generationProject.create({
          data: {
            name:            row.name,
            regionId:        row.regionId,
            plantTypeId:     row.plantTypeId,
            poolingStationId: row.poolingStationId || null,
            totalCapacityMw: parseFloat(row.totalCapacityMw),
            windCapacityMw:  parseDecimal(row.windCapacityMw),
            solarCapacityMw: parseDecimal(row.solarCapacityMw),
            createdById:     user.id,
            ...(row.applicationDate
              ? {
                  contd4: {
                    create: {
                      applicationDate: new Date(row.applicationDate),
                      proposedFtcDate: parseDate(row.proposedFtcDate),
                      capacityApr26Mw: parseDecimal(row.capacityApr26Mw),
                      status: 'PENDING',
                      remarks: row.remarks || null,
                    },
                  },
                }
              : {}),
          },
        });
        created++;
      } catch (e) {
        failed++;
        errors.push({ row: row.name, error: e.message });
      }
    }
  } else if (type === 'transmission') {
    for (const row of rows) {
      try {
        if (scope.regionId && scope.regionId !== row.regionId) {
          throw new Error('Region mismatch');
        }
        await prisma.transmissionElement.create({
          data: {
            regionId:        row.regionId,
            agencyOwner:     row.agencyOwner,
            elementName:     row.elementName,
            elementType:     row.elementType || 'LINE',
            isRe:            row.isRe === true || row.isRe === 'RE',
            voltageRatingKv: row.voltageRatingKv ? parseInt(row.voltageRatingKv) : null,
            capacityMva:     parseDecimal(row.capacityMva),
            lineLengthKm:    parseDecimal(row.lineLengthKm),
            firstEnergyDate: parseDate(row.firstEnergyDate),
            pendingFtc:      row.pendingFtc === true || row.pendingFtc === 'Yes',
            proposedFtcDate: parseDate(row.proposedFtcDate),
            remarks:         row.remarks || null,
          },
        });
        created++;
      } catch (e) {
        failed++;
        errors.push({ row: row.elementName, error: e.message });
      }
    }
  }

  revalidateGridPages();
  revalidateTransmissionPages();

  return { success: true, created, failed, errors };
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

  await prisma.projectNote.create({
    data: { projectId, userId: user.id, text: trimmed },
  });

  revalidatePath(`/generation/${projectId}`);
  return { success: true };
}

export async function markTransmissionFtcDone(elementId) {
  const user = await authedUser();
  if (!user) return { error: 'Session expired. Please log in again.' };
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
  return { success: true };
}
