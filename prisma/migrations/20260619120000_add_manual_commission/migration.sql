-- Manual commissioning override for generation projects.
ALTER TABLE "generation_projects" ADD COLUMN "manuallyCommissioned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "generation_projects" ADD COLUMN "commissionedAt" TIMESTAMP(3);
