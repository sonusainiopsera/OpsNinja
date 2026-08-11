-- Down migration: 0005_organization_registry
-- Reverses the organization registry expansion in safe order.
-- Drops new tables first (FKs reference organizations), then removes
-- added columns from organizations.

-- 5. Remove custom_field_defs
DROP TABLE IF EXISTS custom_field_defs;

-- 4. Remove organization_verified_domains
DROP TABLE IF EXISTS organization_verified_domains;

-- 3. Remove contacts (and the FK from organizations first)
ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_primary_contact_fk;

DROP TABLE IF EXISTS contacts;

-- 2. Remove customer_accounts
DROP TABLE IF EXISTS customer_accounts;

-- 1. Remove columns added to organizations (expand reversal)
DROP INDEX IF EXISTS organizations_custom_field_values_gin;
DROP INDEX IF EXISTS organizations_tenant_status_idx;
DROP INDEX IF EXISTS organizations_tenant_sla_tier_idx;
DROP INDEX IF EXISTS organizations_tenant_active_name_uniq;

ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_tenant_id_id_uniq;

ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_status_check;

ALTER TABLE organizations
  DROP COLUMN IF EXISTS slug,
  DROP COLUMN IF EXISTS sla_tier,
  DROP COLUMN IF EXISTS region,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS custom_field_values,
  DROP COLUMN IF EXISTS primary_contact_id,
  DROP COLUMN IF EXISTS deactivated_at;

-- Re-disable RLS on organizations (it was enabled by this migration).
ALTER TABLE organizations DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_organizations ON organizations;
