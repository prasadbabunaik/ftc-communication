-- Adds an effectiveDate column to audit-log style tables so ADMIN/NLDC can
-- back-date a change. Historical replay code falls back to createdAt when
-- effectiveDate is NULL, so all pre-existing rows behave exactly as before.

ALTER TABLE "project_notes"          ADD COLUMN "effectiveDate" TIMESTAMP(3);
ALTER TABLE "transmission_audit_logs" ADD COLUMN "effectiveDate" TIMESTAMP(3);

CREATE INDEX "project_notes_effectiveDate_idx"
  ON "project_notes" ("effectiveDate");

CREATE INDEX "transmission_audit_logs_effectiveDate_idx"
  ON "transmission_audit_logs" ("effectiveDate");
