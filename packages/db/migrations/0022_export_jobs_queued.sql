-- Migration 0022: export_jobs — add truncated flag and align status vocabulary with WO-076.
--
-- The WO-076 API contract uses 'queued'/'processing'/'completed' rather than the
-- original WO-073 defaults of 'pending'/'running'/'complete'. We change the column
-- default so new rows start as 'queued'; existing 'pending' rows are migrated.

-- Add truncated column (false by default — only set true when the 500k row cap is hit).
ALTER TABLE export_jobs ADD COLUMN IF NOT EXISTS truncated BOOLEAN NOT NULL DEFAULT false;

-- Rename old status values so the entire API surface is consistent.
UPDATE export_jobs SET status = 'queued'     WHERE status = 'pending';
UPDATE export_jobs SET status = 'processing' WHERE status = 'running';
UPDATE export_jobs SET status = 'completed'  WHERE status = 'complete';

-- Change column default to match new vocabulary.
ALTER TABLE export_jobs ALTER COLUMN status SET DEFAULT 'queued';

-- Keyset index for the SQS-consumer idempotency query (status transition guard).
CREATE INDEX IF NOT EXISTS export_jobs_id_status_idx
  ON export_jobs (id, status);
