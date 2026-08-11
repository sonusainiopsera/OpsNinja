-- Down migration 005: Remove organization registry additions
-- Reverses all changes from 005_organization_registry.sql.
-- Run before rolling back to the prior release.

-- ── Drop new tables (child tables first to avoid FK violations) ───────────────

DROP TABLE IF EXISTS custom_field_defs CASCADE;
DROP TABLE IF EXISTS organization_verified_domains CASCADE;
DROP TABLE IF EXISTS contacts CASCADE;
DROP TABLE IF EXISTS customer_accounts CASCADE;

-- ── Remove columns added to organizations ─────────────────────────────────────

ALTER TABLE organizations
  DROP COLUMN IF EXISTS deactivated_at,
  DROP COLUMN IF EXISTS primary_contact_id,
  DROP COLUMN IF EXISTS custom_field_values,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS region,
  DROP COLUMN IF EXISTS sla_tier,
  DROP COLUMN IF EXISTS slug;

-- Remove composite unique constraint added for FK support
ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_tenant_id_uidx;

-- Remove indexes added in 005
DROP INDEX IF EXISTS organizations_custom_field_values_gin_idx;
DROP INDEX IF EXISTS organizations_tenant_name_active_uidx;
DROP INDEX IF EXISTS organizations_tenant_sla_tier_idx;
DROP INDEX IF EXISTS organizations_tenant_status_idx;

-- Restore original RLS policy (USING only, no WITH CHECK)
DROP POLICY IF EXISTS tenant_isolation_organizations ON organizations;

CREATE POLICY organizations_tenant_isolation
  ON organizations
  USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);

-- ── Drop enums ────────────────────────────────────────────────────────────────

DROP TYPE IF EXISTS custom_field_data_type;
DROP TYPE IF EXISTS contact_status;
DROP TYPE IF EXISTS organization_status;
