import { z } from 'zod';

// ─── SHARED ──────────────────────────────────────────────────────────────────

// Allow up to 3 decimals — Excel snapshots use values like 200.003, 175.223
const decimalStr = z.string().regex(/^\d+(\.\d{1,3})?$/, 'Enter a valid number (up to 3 decimal places, e.g. 150.5)');
const optionalDecimalStr = decimalStr.optional().or(z.literal(''));
const optionalDateStr = z.string().optional().or(z.literal(''));

// ─── CONTD-4 APPLICATION ─────────────────────────────────────────────────────

export const contd4Schema = z
  .object({
    // Optional at the field level so legacy projects (CLEARED/REJECTED with
    // unknown original date) can save without a date. The refine below
    // enforces it for PENDING/RECEIVED.
    applicationDate: optionalDateStr,
    proposedFtcDate: optionalDateStr,
    capacityApr26Mw: optionalDecimalStr,
    capacityMonth:   z.string().regex(/^\d{4}-\d{2}$/).optional().or(z.literal('')),
    status: z.preprocess((v) => v || 'UNDER_PROCESS', z.enum(['UNDER_PROCESS', 'CLEARED', 'REJECTED'])),
    remarks: z.string().optional(),
    // ADMIN/NLDC may back-date the change. Server enforces the role check; the
    // schema just validates the format. Empty / undefined → use "now".
    effectiveDate: optionalDateStr,
  })
  .superRefine((data, ctx) => {
    const legacyStatus = data.status === 'CLEARED' || data.status === 'REJECTED';
    if (!data.applicationDate && !legacyStatus) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Application date is required',
        path: ['applicationDate'],
      });
    }
  });

// ─── GENERATION PROJECT ───────────────────────────────────────────────────────

export const createProjectSchema = z
  .object({
    name: z.string().min(1, 'Generating station name is required').max(255),
    regionId: z.string().min(1, 'Region is required'),
    // Plant type may be picked by id (existing master type) or derived from the
    // selected source combination. When only a code is given (e.g. a brand-new
    // Coal+BESS hybrid), the server find-or-creates the PlantType.
    plantTypeId: z.string().optional().or(z.literal('')),
    plantTypeCode: z.string().min(1, 'Plant type is required'),
    plantTypeLabel: z.string().optional().or(z.literal('')),
    plantTypeIsHybrid: z.boolean().optional(),
    plantTypeCategory: z.enum(['RENEWABLE', 'CONVENTIONAL', 'STORAGE']).optional(),
    poolingStationId: z.string().optional().or(z.literal('')),
    // When a master station is picked, its pooling station arrives as a name
    // string (the PoolingStation row may not exist yet). The server resolves
    // it: find-or-create in the project's region. Ignored when
    // poolingStationId is supplied.
    poolingStationName: z.string().optional().or(z.literal('')),
    totalCapacityMw: decimalStr,
    // Hybrid breakdowns (required when isHybrid=true, validated contextually)
    windCapacityMw: optionalDecimalStr,
    solarCapacityMw: optionalDecimalStr,
    bessCapacityMw: optionalDecimalStr,
    // Optional inline CONTD-4 creation
    createContd4: z.boolean().default(false),
    // applicationDate is relaxed here and conditionally required via superRefine
    // so that hidden CONTD-4 fields don't block submission when createContd4=false
    contd4: z
      .object({
        applicationDate: optionalDateStr,
        proposedFtcDate: optionalDateStr,
        capacityApr26Mw: optionalDecimalStr,
        capacityMonth:   z.string().regex(/^\d{4}-\d{2}$/).optional().or(z.literal('')),
        status: z.preprocess((v) => v || 'UNDER_PROCESS', z.enum(['UNDER_PROCESS', 'CLEARED', 'REJECTED'])),
        remarks: z.string().optional(),
      })
      .optional(),
    // ADMIN/NLDC may back-date the project creation so it appears in
    // snapshots starting from this date. Snapshots from effectiveDate to
    // today are rebuilt automatically after create.
    effectiveDate: optionalDateStr,
  })
  .superRefine((data, ctx) => {
    // Pooling station is mandatory: either an explicit id, or a non-placeholder
    // name (from a master station) the server find-or-creates.
    const psName = (data.poolingStationName ?? '').trim();
    const hasPooling = (data.poolingStationId ?? '') !== '' ||
      (psName !== '' && !['-', '—', '–'].includes(psName));
    if (!hasPooling) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Pooling station is required',
        path: ['poolingStationId'],
      });
    }

    // Application date is required for projects starting at PENDING/RECEIVED
    // (the standard "apply for CONTD-4 now" flow). For CLEARED/REJECTED —
    // ADMIN/NLDC onboarding a project that's already past CONTD-4 — the
    // original application date is usually unknown; the action falls back
    // to the effectiveDate, then to a hard-coded placeholder.
    const legacyStatus = data.contd4?.status === 'CLEARED' || data.contd4?.status === 'REJECTED';
    if (data.createContd4 && !data.contd4?.applicationDate && !legacyStatus) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Application date is required',
        path: ['contd4', 'applicationDate'],
      });
    }
  });

// ─── COMMISSIONING PHASE ──────────────────────────────────────────────────────

// Individual FTC / TOC / COD event: each partial commissioning entry has its
// own MW quantum, date, and optional remarks. This is the standard going
// forward — every partial must be recorded as a separate event. `id` is
// present when the row was pre-filled from an existing DB event; the upsert
// action keys on it so the original createdAt audit timestamp is preserved.
const commissioningEventSchema = z.object({
  id:      z.string().optional(),
  mw:      decimalStr,
  date:    z.string().min(1, 'Date is required'),
  remarks: z.string().optional(),
});

const phaseRowSchema = z
  .object({
    // Optional ID of an existing phase this row corresponds to. Present when
    // the form is pre-filled from existing data; the server uses it to know
    // whether to update the existing row or insert a new one.
    existingId: z.string().nullable().optional(),
    sourceType: z.enum(['WIND', 'SOLAR', 'COAL', 'HYDRO', 'PSP', 'BESS'], {
      required_error: 'Source type is required',
    }),
    capacityAppliedMw: decimalStr,
    proposedFtcDate:   optionalDateStr,
    capacityUnderFtcMw: optionalDecimalStr,
    capacityUnderTocMw: optionalDecimalStr,
    expectedApr26Mw:   optionalDecimalStr,
    // YYYY-MM the expectedApr26Mw value targets (e.g. "2026-04").
    expectedMonth:     z.string().regex(/^\d{4}-\d{2}$/).optional().or(z.literal('')),
    delayRemarks:      z.string().optional(),
    otherRemarks:      z.string().optional(),
    // Per-event lists — the source of truth; summary fields are derived from these
    ftcEvents: z.array(commissioningEventSchema).optional().default([]),
    tocEvents: z.array(commissioningEventSchema).optional().default([]),
    codEvents: z.array(commissioningEventSchema).optional().default([]),
  })
  // FTC total ≤ Applied capacity
  .refine(
    (p) => {
      const ftc     = (p.ftcEvents ?? []).reduce((s, e) => s + (parseFloat(e.mw) || 0), 0);
      const applied = parseFloat(p.capacityAppliedMw || '0');
      return ftc <= applied + 0.01;
    },
    { message: 'Total FTC cannot exceed Applied capacity' }
  )
  // FTC total + Under FTC ≤ Applied
  .refine(
    (p) => {
      const ftc      = (p.ftcEvents ?? []).reduce((s, e) => s + (parseFloat(e.mw) || 0), 0);
      const underFtc = parseFloat(p.capacityUnderFtcMw || '0');
      const applied  = parseFloat(p.capacityAppliedMw || '0');
      return ftc + underFtc <= applied + 0.01;
    },
    { message: 'FTC completed + Under FTC cannot exceed Applied capacity', path: ['capacityUnderFtcMw'] }
  )
  // TOC total ≤ FTC total
  .refine(
    (p) => {
      const toc = (p.tocEvents ?? []).reduce((s, e) => s + (parseFloat(e.mw) || 0), 0);
      if (!toc) return true;
      const ftc = (p.ftcEvents ?? []).reduce((s, e) => s + (parseFloat(e.mw) || 0), 0);
      return toc <= ftc + 0.01;
    },
    { message: 'Total TOC cannot exceed Total FTC (FTC ≥ TOC)' }
  )
  // TOC total + Under TOC ≤ FTC total
  .refine(
    (p) => {
      const toc      = (p.tocEvents ?? []).reduce((s, e) => s + (parseFloat(e.mw) || 0), 0);
      const underToc = parseFloat(p.capacityUnderTocMw || '0');
      const ftc      = (p.ftcEvents ?? []).reduce((s, e) => s + (parseFloat(e.mw) || 0), 0);
      return toc + underToc <= ftc + 0.01;
    },
    { message: 'TOC completed + Under TOC cannot exceed Total FTC', path: ['capacityUnderTocMw'] }
  )
  // COD total ≤ TOC total
  .refine(
    (p) => {
      const cod = (p.codEvents ?? []).reduce((s, e) => s + (parseFloat(e.mw) || 0), 0);
      if (!cod) return true;
      const toc = (p.tocEvents ?? []).reduce((s, e) => s + (parseFloat(e.mw) || 0), 0);
      return cod <= toc + 0.01;
    },
    { message: 'Total COD cannot exceed Total TOC (TOC ≥ COD)' }
  );

export const createPhasesSchema = z.object({
  phases: z.array(phaseRowSchema).min(1, 'At least one phase is required'),
});

// ─── TRANSMISSION ELEMENT ─────────────────────────────────────────────────────

export const createTransmissionSchema = z.object({
  regionId: z.string().min(1, 'Region is required'),
  agencyOwner: z.string().min(1, 'Agency/Owner is required'),
  elementName: z.string().min(1, 'Element name is required'),
  elementType: z.enum(['LINE', 'ICT', 'GT', 'ST']),
  isRe: z.boolean().default(false),
  voltageRatingKv: z.string().optional().or(z.literal('')),
  capacityMva: optionalDecimalStr,
  lineLengthKm: optionalDecimalStr,
  firstEnergyDate: optionalDateStr,
  pendingFtc: z.boolean().default(false),
  proposedFtcDate: optionalDateStr,
  capacityApr26Mva: optionalDecimalStr,
  lineLengthApr26Km: optionalDecimalStr,
  remarks: z.string().optional(),
  // ADMIN/NLDC may back-date a TX change so audit replay + snapshots reflect
  // the real-world date of the change. Empty / non-ADMIN → "now".
  effectiveDate: optionalDateStr,
});
