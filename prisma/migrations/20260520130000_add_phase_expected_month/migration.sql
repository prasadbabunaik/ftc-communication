-- Stores the YYYY-MM that the phase's expectedApr26Mw value refers to,
-- so ADMIN/NLDC entering back-dated data can record "expected for Apr'26"
-- separately from "expected for May'26" rather than relying on a global
-- rolling reference month at display time.

ALTER TABLE "commissioning_phases"
  ADD COLUMN "expectedMonth" TEXT;
