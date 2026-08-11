-- Migration 003: Audit Logs Extension for Cross-Cutting Audit Capture
-- Adds state-diffing columns, actor enrichment, request correlation, and
-- idempotency key to the existing audit_logs table.

-- ── New columns ───────────────────────────────────────────────────────────────

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS before_state     jsonb,
  ADD COLUMN IF NOT EXISTS after_state      jsonb,
  ADD COLUMN IF NOT EXISTS changed_fields   text[],
  ADD COLUMN IF NOT EXISTS actor_role       text,
  ADD COLUMN IF NOT EXISTS request_id       text,
  -- idempotency_key is set by worker paths; NULL for HTTP requests.
  -- Format: '{tenant_id}:{event_id}:{action}'
  ADD COLUMN IF NOT EXISTS idempotency_key  text;

-- ── Idempotency index (partial – only rows that have a key) ──────────────────
-- ON CONFLICT DO NOTHING against this index prevents duplicate audit records
-- when SQS delivers a message more than once.
CREATE UNIQUE INDEX IF NOT EXISTS audit_logs_idempotency_key_uidx
  ON audit_logs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ── Lookup index for compliance queries (actor + tenant) ─────────────────────
CREATE INDEX IF NOT EXISTS audit_logs_tenant_actor_idx
  ON audit_logs (tenant_id, actor_id, occurred_at DESC)
  WHERE tenant_id IS NOT NULL;
