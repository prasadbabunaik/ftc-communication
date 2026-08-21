-- Download / print activity log (Excel, PDF, print). Admin-only view.
CREATE TABLE IF NOT EXISTS "download_logs" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT,
  "label"      TEXT NOT NULL,
  "format"     TEXT NOT NULL,
  "meta"       TEXT,
  "roleAtTime" TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "download_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "download_logs_createdAt_idx" ON "download_logs"("createdAt");

DO $$ BEGIN
  ALTER TABLE "download_logs"
    ADD CONSTRAINT "download_logs_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
