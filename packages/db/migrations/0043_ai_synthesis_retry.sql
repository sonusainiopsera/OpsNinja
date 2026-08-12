-- Migration 0043: AI synthesis retry cap and reconciliation index (WO-064)
--
-- Adds:
--   attempt_count column to ticket_ai_summaries so the worker can enforce the
--   3-attempt cap durably across crashes and SQS redeliveries.
--
--   Partial index on (tenant_id, ai_status, updated_at) filtered to
--   ai_status IN ('pending','running') so the reconciliation job scan stays
--   O(stuck-set) rather than O(all-summaries).

-- ---------------------------------------------------------------------------
-- attempt_count column
-- ---------------------------------------------------------------------------

ALTER TABLE ticket_ai_summaries
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Partial index for reconciliation job
-- (CONCURRENTLY not used here — run inside migration transaction)
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS ticket_ai_summaries_stale_idx
  ON ticket_ai_summaries (tenant_id, ai_status, updated_at)
  WHERE ai_status IN ('pending', 'running');
