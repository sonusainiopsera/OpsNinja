-- =============================================================================
-- Outbox Backoff Migration
-- Version: 0005
-- Description: Additive migration adding backoff infrastructure to outbox_events:
--   - status column (pending | published | dead_letter)
--   - next_attempt_at column for exponential backoff scheduling
--   - outbox_seq monotonic sequence for per-aggregate ordering tiebreaker
--   - Partial drain index on (tenant_id, next_attempt_at) WHERE status = 'pending'
--   - Confirms REVOKE of UPDATE/DELETE on audit_logs for app_user
--   - Updates retention_policies to enforce 12-month minimum for audit_logs
--
-- Expand-and-contract discipline:
--   - All new columns are added with defaults so existing rows get valid values.
--   - No columns are dropped. No check constraint changes to existing columns.
--   - The status column migrates existing rows based on published_at.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Monotonic sequence for outbox_events ordering tiebreaker.
--    Used to break ties when two events share the same created_at timestamp.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS outbox_seq
  START WITH 1
  INCREMENT BY 1
  NO MAXVALUE
  CACHE 100;  -- Cache 100 values per session for throughput.

-- ---------------------------------------------------------------------------
-- 2. Add new columns to outbox_events.
--
--    Using IF NOT EXISTS guards so this migration is safe to re-run.
-- ---------------------------------------------------------------------------

-- outbox_seq: monotonic tiebreaker for per-aggregate ordering.
ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS outbox_seq bigint NOT NULL DEFAULT nextval('outbox_seq');

-- next_attempt_at: NULL means "eligible immediately".
-- The drain query selects rows where next_attempt_at IS NULL OR next_attempt_at <= now().
ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

-- status: current processing state.
-- Added as nullable first, then NOT NULL-constrained after backfill (expand-and-contract).
ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS status text;

-- Backfill status from existing data: rows with published_at set are 'published'.
UPDATE outbox_events
  SET status = CASE
    WHEN published_at IS NOT NULL THEN 'published'
    ELSE 'pending'
  END
  WHERE status IS NULL;

-- Now enforce NOT NULL and check constraint.
ALTER TABLE outbox_events
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'pending';

-- Add the check constraint as a separate step for clarity.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'outbox_events_status_check'
  ) THEN
    ALTER TABLE outbox_events
      ADD CONSTRAINT outbox_events_status_check
        CHECK (status IN ('pending', 'published', 'dead_letter'));
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Partial drain index.
--    The drain loop filters by status='pending' AND (next_attempt_at IS NULL OR
--    next_attempt_at <= now()). This partial index covers that scan efficiently.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_outbox_drain_pending
  ON outbox_events (tenant_id, COALESCE(next_attempt_at, '-infinity'::timestamptz), outbox_seq)
  WHERE status = 'pending';

-- Drop the old unpublished index from 0001 since the new one supersedes it.
DROP INDEX IF EXISTS idx_outbox_unpublished;

-- ---------------------------------------------------------------------------
-- 4. Confirm audit_logs immutability (idempotent; no-op if app_user exists
--    and the REVOKE was applied in 0001_foundation.sql).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    REVOKE UPDATE, DELETE ON audit_logs FROM app_user;
    REVOKE UPDATE, DELETE ON audit_logs_default FROM app_user;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Retention policy: ensure audit_logs has at least 12 months retention.
-- ---------------------------------------------------------------------------
INSERT INTO retention_policies (table_name, retention_months)
VALUES ('audit_logs', 12)
ON CONFLICT (table_name) DO UPDATE
  SET retention_months = GREATEST(retention_policies.retention_months, 12),
      updated_at = now();

COMMIT;
