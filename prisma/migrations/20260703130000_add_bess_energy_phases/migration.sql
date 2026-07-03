-- Phase-wise BESS energy commissioning (JSON array of { mwh, date, remarks }).
-- Additive, nullable — backward compatible with the cached energyCommissionedMwh sum.
ALTER TABLE "generation_projects" ADD COLUMN "energyPhasesJson" JSONB;
