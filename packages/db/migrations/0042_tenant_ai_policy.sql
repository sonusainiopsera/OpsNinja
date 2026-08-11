-- Migration 0042: Per-tenant AI token budget and opt-out policy (WO-063)
--
-- Creates two tables:
--   tenant_ai_settings  — per-tenant enablement flag and monthly budget cap.
--   tenant_ai_usage     — monthly period aggregates with atomic upsert semantics.

-- ---------------------------------------------------------------------------
-- tenant_ai_settings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenant_ai_settings (
  tenant_id             uuid        PRIMARY KEY,
  ai_enabled            boolean     NOT NULL DEFAULT true,
  monthly_token_budget  bigint,
  warn_threshold_pct    integer     NOT NULL DEFAULT 80
                                    CHECK (warn_threshold_pct BETWEEN 1 AND 100),
  warned_at             timestamptz,
  version               integer     NOT NULL DEFAULT 1,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenant_ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_ai_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenant_ai_settings
  USING (tenant_id::text = current_setting('app.current_tenant', true));

-- ---------------------------------------------------------------------------
-- tenant_ai_usage
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenant_ai_usage (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL,
  period                text        NOT NULL,   -- YYYY-MM
  input_tokens          bigint      NOT NULL DEFAULT 0,
  output_tokens         bigint      NOT NULL DEFAULT 0,
  request_count         integer     NOT NULL DEFAULT 0,
  estimated_cost_micros bigint      NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenant_ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_ai_usage FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenant_ai_usage
  USING (tenant_id::text = current_setting('app.current_tenant', true));

CREATE UNIQUE INDEX IF NOT EXISTS tenant_ai_usage_tenant_period_uniq
  ON tenant_ai_usage (tenant_id, period);

CREATE INDEX IF NOT EXISTS tenant_ai_usage_tenant_idx
  ON tenant_ai_usage (tenant_id);
