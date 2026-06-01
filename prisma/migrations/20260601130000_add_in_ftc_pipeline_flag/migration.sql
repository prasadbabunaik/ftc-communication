-- FTC and CONTD-4 are independent entry points. A project can be entered
-- directly into the FTC pipeline without a CLEARED CONTD-4. This flag marks
-- such membership explicitly; the pipeline filter is `inFtcPipeline OR
-- contd4.status = CLEARED`.

ALTER TABLE "generation_projects"
  ADD COLUMN "inFtcPipeline" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: every project currently treated as "in FTC" (has a CLEARED
-- CONTD-4, or already has commissioning phases) is flagged so existing
-- pipeline membership is preserved.
UPDATE "generation_projects" gp
SET "inFtcPipeline" = true
WHERE EXISTS (SELECT 1 FROM "contd4_applications" c WHERE c."projectId" = gp.id AND c."status" = 'CLEARED')
   OR EXISTS (SELECT 1 FROM "commissioning_phases" p WHERE p."projectId" = gp.id);
