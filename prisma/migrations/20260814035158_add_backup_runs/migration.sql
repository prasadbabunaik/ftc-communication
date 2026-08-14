-- Database backup history (scheduled + manual).
DO $$ BEGIN
  CREATE TYPE "BackupStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "BackupTrigger" AS ENUM ('SCHEDULED', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "backup_runs" (
  "id"            TEXT NOT NULL,
  "status"        "BackupStatus" NOT NULL DEFAULT 'RUNNING',
  "trigger"       "BackupTrigger" NOT NULL,
  "startedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"    TIMESTAMP(3),
  "durationMs"    INTEGER,
  "sizeBytes"     BIGINT,
  "fileName"      TEXT,
  "error"         TEXT,
  "triggeredById" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "backup_runs_startedAt_idx" ON "backup_runs"("startedAt");

DO $$ BEGIN
  ALTER TABLE "backup_runs"
    ADD CONSTRAINT "backup_runs_triggeredById_fkey"
    FOREIGN KEY ("triggeredById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
