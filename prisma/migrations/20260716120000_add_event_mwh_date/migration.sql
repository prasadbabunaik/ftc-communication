-- Per-event MWh date for BESS milestones (independent of the MW eventDate).
ALTER TABLE "ftc_events" ADD COLUMN "mwhDate" TIMESTAMP(3);
ALTER TABLE "toc_events" ADD COLUMN "mwhDate" TIMESTAMP(3);
ALTER TABLE "cod_events" ADD COLUMN "mwhDate" TIMESTAMP(3);
