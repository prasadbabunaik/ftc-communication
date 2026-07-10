-- BESS energy (MWh) tracked alongside MW through the funnel, and an optional
-- developer/owner name. All additive nullable columns — safe on the shared DB.
ALTER TABLE "commissioning_phases" ADD COLUMN IF NOT EXISTS "capacityAppliedMwh" DECIMAL(12,2);
ALTER TABLE "ftc_events"           ADD COLUMN IF NOT EXISTS "capacityMwh"        DECIMAL(12,2);
ALTER TABLE "toc_events"           ADD COLUMN IF NOT EXISTS "capacityMwh"        DECIMAL(12,2);
ALTER TABLE "cod_events"           ADD COLUMN IF NOT EXISTS "capacityMwh"        DECIMAL(12,2);
ALTER TABLE "generation_projects"  ADD COLUMN IF NOT EXISTS "developerName"      TEXT;
