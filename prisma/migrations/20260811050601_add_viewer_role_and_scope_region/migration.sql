-- Read-only VIEWER role, scoped to a region (or all regions when null).

-- 1. New enum value. PG 12 permits ADD VALUE inside a transaction as long as
--    the value isn't used in the same migration (it isn't — no data references
--    it yet), so this is safe under Prisma's transactional migrate.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'VIEWER';

-- 2. Per-user region binding for VIEWER accounts (null = all regions).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "scopeRegionId" TEXT;

-- 3. FK to grid_regions; SET NULL if the region is ever removed (viewer falls
--    back to all-regions rather than dangling).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_scopeRegionId_fkey'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_scopeRegionId_fkey"
      FOREIGN KEY ("scopeRegionId") REFERENCES "grid_regions"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "users_scopeRegionId_idx" ON "users"("scopeRegionId");
