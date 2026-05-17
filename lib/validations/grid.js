import { z } from 'zod';

// ─── SHARED ──────────────────────────────────────────────────────────────────

// Allow up to 3 decimals — Excel snapshots use values like 200.003, 175.223
const decimalStr = z.string().regex(/^\d+(\.\d{1,3})?$/, 'Enter a valid number (up to 3 decimal places, e.g. 150.5)');
const optionalDecimalStr = decimalStr.optional().or(z.literal(''));
const optionalDateStr = z.string().optional().or(z.literal(''));

// ─── CONTD-4 APPLICATION ─────────────────────────────────────────────────────

export const contd4Schema = z.object({
  applicationDate: z.string().min(1, 'Application date is required'),
  proposedFtcDate: optionalDateStr,
  capacityApr26Mw: optionalDecimalStr,
  capacityMonth:   z.string().regex(/^\d{4}-\d{2}$/).optional().or(z.literal('')),
  status: z.preprocess((v) => v || 'PENDING', z.enum(['PENDING', 'RECEIVED', 'CLEARED', 'REJECTED'])),
  remarks: z.string().optional(),
});

// ─── GENERATION PROJECT ───────────────────────────────────────────────────────

export const createProjectSchema = z
  .object({
    name: z.string().min(1, 'Generating station name is required').max(255),
    developerName: z.string().optional().or(z.literal('')),
    regionId: z.string().min(1, 'Region is required'),
    plantTypeId: z.string().min(1, 'Plant type is required'),
    poolingStationId: z.string().optional().or(z.literal('')),
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
        status: z.preprocess((v) => v || 'PENDING', z.enum(['PENDING', 'RECEIVED', 'CLEARED', 'REJECTED'])),
        remarks: z.string().optional(),
      })
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.createContd4 && !data.contd4?.applicationDate) {
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
// forward — every partial must be recorded as a separate event.
const commissioningEventSchema = z.object({
  mw:      decimalStr,
  date:    z.string().min(1, 'Date is required'),
  remarks: z.string().optional(),
});

const phaseRowSchema = z
  .object({
    sourceType: z.enum(['WIND', 'SOLAR', 'COAL', 'HYDRO', 'PSP', 'BESS'], {
      required_error: 'Source type is required',
    }),
    capacityAppliedMw: decimalStr,
    proposedFtcDate:   optionalDateStr,
    capacityUnderFtcMw: optionalDecimalStr,
    capacityUnderTocMw: optionalDecimalStr,
    expectedApr26Mw:   optionalDecimalStr,
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
});
