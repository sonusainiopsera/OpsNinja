-- =============================================================================
-- OpsNinja AI Synthesis Persistence Schema
-- Version: 0060
-- Description:
--   Creates tenant-scoped storage for LLM-generated ticket summaries and
--   blast-radius tags, with full RLS enforcement, attempt-count provenance,
--   and registration in the retention purge and GDPR erasure manifests.
--
--   Tables created:
--     ticket_ai_summaries — one row per (tenant, ticket); tracks synthesis
--       state, model provenance, attempt count, and the summary texts.
--     ticket_affected_areas — zero or more rows per (tenant, ticket);
--       stores blast-radius tags produced by the model.
--
--   Design invariants:
--     - tenant_id leads the PK on both tables.
--     - UNIQUE (tenant_id, ticket_id) on ticket_ai_summaries makes synthesis
--       writeback idempotent via ON CONFLICT DO UPDATE.
--     - ai_status is constrained to: pending | running | succeeded | failed | skipped.
--     - RLS: ENABLE + FORCE on both tables; policy predicate uses
--       app_current_tenant() (defined in migration 0009).
--     - FK to tickets omitted: tickets is range-partitioned with PK
--       (tenant_id, id, created_at); a FK from ticket_ai_summaries cannot
--       reference the full partition-key PK without created_at.
--       Cascade delete is handled by the retention purge manifest.
--       This mirrors the documented ticket_comments exception.
--     - Summary text columns (crux_summary, resolution_summary) are
--       Confidential tier; app_user has no SELECT beyond tenant scope.
--
--   Expand-only: no destructive DDL.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ticket_ai_summaries
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_ai_summaries (
  tenant_id          uuid        NOT NULL REFERENCES tenants(id),
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  ticket_id          uuid        NOT NULL,
  -- Confidential tier: excluded from structured log output (see redact.ts).
  crux_summary       text,
  resolution_summary text,
  model_id           text,
  prompt_version     text,
  -- Enumerated status with CHECK constraint for cheap extensibility.
  ai_status          text        NOT NULL DEFAULT 'pending'
                                  CHECK (ai_status IN (
                                    'pending', 'running', 'succeeded', 'failed', 'skipped'
                                  )),
  -- Durable counter for the three-attempt failure cap.
  attempt_count      integer     NOT NULL DEFAULT 0,
  last_error_code    text,
  generated_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

COMMENT ON TABLE  ticket_ai_summaries IS
  'LLM-generated summaries for resolved tickets. '
  'One row per (tenant_id, ticket_id). '
  'crux_summary and resolution_summary are Confidential tier.';

COMMENT ON COLUMN ticket_ai_summaries.ai_status IS
  'pending | running | succeeded | failed | skipped';

COMMENT ON COLUMN ticket_ai_summaries.attempt_count IS
  'Incremented each synthesis attempt. Capped at 3 by the synthesis worker.';

-- Unique: enables idempotent upsert via ON CONFLICT (tenant_id, ticket_id).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_ai_summaries_ticket
  ON ticket_ai_summaries (tenant_id, ticket_id);

-- Leading-tenant_id index for tenant-local ticket lookups.
CREATE INDEX IF NOT EXISTS idx_ticket_ai_summaries_ticket
  ON ticket_ai_summaries (tenant_id, ticket_id);

-- ---------------------------------------------------------------------------
-- 2. ticket_affected_areas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_affected_areas (
  tenant_id  uuid        NOT NULL REFERENCES tenants(id),
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  ticket_id  uuid        NOT NULL,
  area_label text        NOT NULL,
  -- confidence: low | medium | high (text, not float, for AffectedAreaChips).
  confidence text,
  -- source: 'ai' (default) | 'manual'.
  source     text        NOT NULL DEFAULT 'ai',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

COMMENT ON TABLE  ticket_affected_areas IS
  'Blast-radius tags for tickets, produced by the AI synthesis pipeline. '
  'Zero or more rows per (tenant_id, ticket_id).';

COMMENT ON COLUMN ticket_affected_areas.confidence IS
  'low | medium | high — matches AffectedAreaChips display in the UI spec.';

-- Leading-tenant_id index for tenant-local ticket lookups.
CREATE INDEX IF NOT EXISTS idx_ticket_affected_areas_ticket
  ON ticket_affected_areas (tenant_id, ticket_id);

-- Leading-tenant_id index for dashboard affected-area aggregation.
CREATE INDEX IF NOT EXISTS idx_ticket_affected_areas_label
  ON ticket_affected_areas (tenant_id, area_label);

-- ---------------------------------------------------------------------------
-- 3. Row-Level Security
--    Predicates use app_current_tenant() (defined in 0009_identity_rls.sql).
-- ---------------------------------------------------------------------------

-- ticket_ai_summaries
ALTER TABLE ticket_ai_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_ai_summaries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ticket_ai_summaries;
CREATE POLICY tenant_isolation ON ticket_ai_summaries
  USING  (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- ticket_affected_areas
ALTER TABLE ticket_affected_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_affected_areas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ticket_affected_areas;
CREATE POLICY tenant_isolation ON ticket_affected_areas
  USING  (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- ---------------------------------------------------------------------------
-- 4. app_user grants
--    SELECT + INSERT + UPDATE on summaries (worker updates status/attempt_count).
--    SELECT + INSERT + DELETE on affected_areas (worker replaces the full list).
--    No BYPASSRLS; tenant isolation enforced by RLS policy above.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE ON ticket_ai_summaries  TO app_user;
    GRANT SELECT, INSERT, DELETE ON ticket_affected_areas TO app_user;
  END IF;
END$$;

COMMIT;
