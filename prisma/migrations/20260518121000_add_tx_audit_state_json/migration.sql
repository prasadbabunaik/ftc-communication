-- Snapshot of the TransmissionElement's full state immediately AFTER each
-- audit event. Used by txStateAsOf() to reconstruct historical state for
-- back-dated edits. Nullable so pre-existing audit rows (before this column
-- was added) don't need backfill — the replay function falls through to the
-- current row when no log carries a stateJson.

ALTER TABLE "transmission_audit_logs"
  ADD COLUMN "stateJson" JSONB;
