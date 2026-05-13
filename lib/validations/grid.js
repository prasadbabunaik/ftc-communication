import { z } from 'zod';

// ─── SHARED ──────────────────────────────────────────────────────────────────

const decimalStr = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter a valid number (e.g. 150.5)');
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
    expectedApr26Mw:  optionalDecimalStr,
    delayRemarks:     z.string().optional(),
    otherRemarks:     z.string().optional(),
  })
  // Pipeline constraint 1: TOC capacity ≤ FTC completed
  .refine(
    (p) => {
      const toc = parseFloat(p.tocIssuedMw || '0');
      if (!toc) return true;
      const ftc = parseFloat(p.ftcCompletedMw || '0');
      return ftc > 0 && toc <= ftc;
    },
    { message: 'FTC must be completed before TOC can be issued, and TOC cannot exceed FTC', path: ['tocIssuedMw'] }
  )
  // Pipeline constraint 2: COD capacity ≤ TOC issued
  .refine(
    (p) => {
      const cod = parseFloat(p.codDeclaredMw || '0');
      if (!cod) return true;
      const toc = parseFloat(p.tocIssuedMw || '0');
      return toc > 0 && cod <= toc;
    },
    { message: 'TOC must be issued before COD can be declared, and COD cannot exceed TOC', path: ['codDeclaredMw'] }
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
