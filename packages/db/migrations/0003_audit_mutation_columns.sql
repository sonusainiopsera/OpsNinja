-- Migration 0003: Extend audit_logs for mutation events
-- Adds columns for resource-level mutation audit, idempotency dedup, and worker source.

BEGIN;

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS resource_type   text,
  ADD COLUMN IF NOT EXISTS resource_id     text,
  ADD COLUMN IF NOT EXISTS action          text,
  ADD COLUMN IF NOT EXISTS before_state    jsonb,
  ADD COLUMN IF NOT EXISTS after_state     jsonb,
  ADD COLUMN IF NOT EXISTS changed_fields  text[],
  ADD COLUMN IF NOT EXISTS source          text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS request_id      text,
  ADD COLUMN IF NOT EXISTS ip_hash         text,
  ADD COLUMN IF NOT EXISTS user_agent      text;

-- Unique partial index for worker idempotency — only non-NULL idempotency keys
-- are deduplicated; HTTP events never set this field.
CREATE UNIQUE INDEX IF NOT EXISTS audit_logs_idempotency_key_idx
  ON audit_logs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Index for resource-level queries (e.g., all changes to a specific ticket).
CREATE INDEX IF NOT EXISTS audit_logs_resource_idx
  ON audit_logs (tenant_id, resource_type, resource_id);

COMMIT;
