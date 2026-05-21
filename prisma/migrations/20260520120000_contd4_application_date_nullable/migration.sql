-- ADMIN/NLDC onboarding of "already CONTD-4 cleared" legacy projects often
-- has no original application date — allow the column to be null so we can
-- record that fact instead of stamping a fake placeholder.

ALTER TABLE "contd4_applications"
  ALTER COLUMN "applicationDate" DROP NOT NULL;
