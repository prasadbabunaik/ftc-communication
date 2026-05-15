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

const phaseRowSchema = z
  .object({
    sourceType: z.enum(['WIND', 'SOLAR', 'COAL', 'HYDRO', 'PSP', 'BESS'], {
      required_error: 'Source type is required',
    }),
    capacityAppliedMw: decimalStr,
    ftcCompletedMw:   optionalDecimalStr,
    ftcCompletedDate: optionalDateStr,
    proposedFtcDate:  optionalDateStr,
    capacityUnderFtcMw: optionalDecimalStr,
    tocIssuedMw:      optionalDecimalStr,
    tocIssuedDate:    optionalDateStr,
    capacityUnderTocMw: optionalDecimalStr,
    codDeclaredMw:    optionalDecimalStr,
    codDeclaredDate:  optionalDateStr,
    capacityPendingCodMw: optionalDecimalStr,
    expectedApr26Mw:  optionalDecimalStr,
    delayRemarks:     z.string().optional(),
    otherRemarks:     z.string().optional(),
  })
  // Pipeline constraint 1a: FTC completed ≤ Applied capacity
  .refine(
    (p) => {
      const ftc     = parseFloat(p.ftcCompletedMw || '0');
      const applied = parseFloat(p.capacityAppliedMw || '0');
      return ftc <= applied + 0.01;
    },
    { message: 'FTC Approved capacity cannot exceed Applied capacity', path: ['ftcCompletedMw'] }
  )
  // Pipeline constraint 1b: FTC + Under FTC ≤ Applied (can't have more pending+done than applied for)
  .refine(
    (p) => {
      const ftc      = parseFloat(p.ftcCompletedMw || '0');
      const underFtc = parseFloat(p.capacityUnderFtcMw || '0');
      const applied  = parseFloat(p.capacityAppliedMw || '0');
      return ftc + underFtc <= applied + 0.01;
    },
    { message: 'FTC Approved + Under FTC cannot exceed Applied capacity', path: ['capacityUnderFtcMw'] }
  )
  // Pipeline constraint 2a: TOC capacity ≤ FTC completed
  .refine(
    (p) => {
      const toc = parseFloat(p.tocIssuedMw || '0');
      if (!toc) return true;
      const ftc = parseFloat(p.ftcCompletedMw || '0');
      return toc <= ftc + 0.01;
    },
    { message: 'TOC Issued cannot exceed FTC Approved capacity (FTC ≥ TOC)', path: ['tocIssuedMw'] }
  )
  // Pipeline constraint 2b: TOC + Under TOC ≤ FTC
  .refine(
    (p) => {
      const toc      = parseFloat(p.tocIssuedMw || '0');
      const underToc = parseFloat(p.capacityUnderTocMw || '0');
      const ftc      = parseFloat(p.ftcCompletedMw || '0');
      return toc + underToc <= ftc + 0.01;
    },
    { message: 'TOC Issued + Under TOC cannot exceed FTC Approved capacity', path: ['capacityUnderTocMw'] }
  )
  // Pipeline constraint 3a: COD capacity ≤ TOC issued
  .refine(
    (p) => {
      const cod = parseFloat(p.codDeclaredMw || '0');
      if (!cod) return true;
      const toc = parseFloat(p.tocIssuedMw || '0');
      return cod <= toc + 0.01;
    },
    { message: 'COD Declared cannot exceed TOC Issued capacity (TOC ≥ COD)', path: ['codDeclaredMw'] }
  )
  // Pipeline constraint 3b: COD + Pending COD ≤ TOC
  .refine(
    (p) => {
      const cod        = parseFloat(p.codDeclaredMw || '0');
      const pendingCod = parseFloat(p.capacityPendingCodMw || '0');
      const toc        = parseFloat(p.tocIssuedMw || '0');
      return cod + pendingCod <= toc + 0.01;
    },
    { message: 'COD Declared + Pending COD cannot exceed TOC Issued capacity', path: ['capacityPendingCodMw'] }
  )
  // Pipeline constraint 3: FTC date ≤ TOC date
  .refine(
    (p) => {
      if (!p.ftcCompletedDate || !p.tocIssuedDate) return true;
      return new Date(p.ftcCompletedDate) <= new Date(p.tocIssuedDate);
    },
    { message: 'TOC date must be on or after FTC date', path: ['tocIssuedDate'] }
  )
  // Pipeline constraint 4: TOC date ≤ COD date
  .refine(
    (p) => {
      if (!p.tocIssuedDate || !p.codDeclaredDate) return true;
      return new Date(p.tocIssuedDate) <= new Date(p.codDeclaredDate);
    },
    { message: 'COD date must be on or after TOC date', path: ['codDeclaredDate'] }
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
