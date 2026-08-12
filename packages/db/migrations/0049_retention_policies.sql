-- Migration 0049: retention_policies table.
--
-- Stores per-category retention configuration with optional per-tenant overrides.
-- Platform minimum and maximum bounds are enforced by CHECK constraints.
-- audit_trail cannot be configured below 365 days (hard floor enforced here and
-- in the service layer).

CREATE TABLE IF NOT EXISTS retention_policies (
  id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  -- NULL tenant_id = platform default; non-NULL = tenant override.
  tenant_id      UUID,
  -- Data classification category (matches @opsninja/retention registry).
  category       TEXT        NOT NULL,
  -- Retention period in days. Platform bounds: 7 ≤ retention_days ≤ 3650.
  -- audit_trail floor: 365 days (also enforced by service layer).
  retention_days INT         NOT NULL,
  -- 'dry_run' (default for new categories) or 'enforce'.
  mode           TEXT        NOT NULL DEFAULT 'dry_run',
  created_by     TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT retention_policies_days_min    CHECK (retention_days >= 7),
  CONSTRAINT retention_policies_days_max    CHECK (retention_days <= 3650),
  CONSTRAINT retention_policies_mode_valid  CHECK (mode IN ('dry_run', 'enforce')),
  -- audit_trail minimum is 365 days regardless of who requests it.
  CONSTRAINT retention_policies_audit_floor
    CHECK (category <> 'audit_trail' OR retention_days >= 365)
);

-- Unique scope + category: only one policy row per (tenant_scope, category).
-- Platform defaults use the special sentinel '00000000-0000-0000-0000-000000000000'.
CREATE UNIQUE INDEX IF NOT EXISTS retention_policies_scope_category_uniq
  ON retention_policies (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), category);

CREATE INDEX IF NOT EXISTS retention_policies_tenant_idx
  ON retention_policies (tenant_id, category);

-- RLS: tenant-scoped rows visible only to the owning tenant;
-- platform defaults (tenant_id IS NULL) are visible to all authenticated callers.
ALTER TABLE retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE retention_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY retention_policies_isolation ON retention_policies
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.current_tenant', true)::uuid
  );
