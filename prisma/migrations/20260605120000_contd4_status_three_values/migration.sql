-- Collapse CONTD-4 status to three values: UNDER_PROCESS, CLEARED, REJECTED.
-- PENDING and RECEIVED both map to UNDER_PROCESS.
ALTER TYPE "Contd4Status" RENAME TO "Contd4Status_old";
CREATE TYPE "Contd4Status" AS ENUM ('UNDER_PROCESS', 'CLEARED', 'REJECTED');
ALTER TABLE "contd4_applications" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "contd4_applications" ALTER COLUMN "status" TYPE "Contd4Status" USING (
  CASE WHEN "status"::text IN ('PENDING', 'RECEIVED') THEN 'UNDER_PROCESS'
       ELSE "status"::text END::"Contd4Status"
);
ALTER TABLE "contd4_applications" ALTER COLUMN "status" SET DEFAULT 'UNDER_PROCESS';
DROP TYPE "Contd4Status_old";
