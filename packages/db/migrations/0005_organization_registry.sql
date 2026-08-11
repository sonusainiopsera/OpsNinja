-- Migration: 0005_organization_registry
-- Extends the organizations table and adds customer_accounts, contacts,
-- organization_verified_domains, and custom_field_defs.
--
-- Expand/contract discipline: new columns are added with safe defaults;
-- no existing columns are dropped or renamed. The migration is backward
-- compatible for one release.
--
-- RLS policies use:
--   USING       (tenant_id = current_setting('app.current_tenant')::uuid)
--   WITH CHECK  (tenant_id = current_setting('app.current_tenant')::uuid)
-- This ensures a missing app.current_tenant raises an error rather than
-- returning all rows (fail-closed via ::uuid cast on empty string).

-- ==========================================================================
-- 1. Extend existing organizations table (expand pattern)
-- ==========================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS slug               TEXT,
  ADD COLUMN IF NOT EXISTS sla_tier           TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS region             TEXT,
  ADD COLUMN IF NOT EXISTS status             TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS custom_field_values JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS primary_contact_id UUID,
  ADD COLUMN IF NOT EXISTS deactivated_at     TIMESTAMPTZ;

-- Constrain status to valid enum values.
ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_status_check;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_status_check
  CHECK (status IN ('active', 'inactive'));

-- GIN index for JSONB containment queries on custom_field_values.
CREATE INDEX IF NOT EXISTS organizations_custom_field_values_gin
  ON organizations USING GIN (custom_field_values);

-- Composite leading-tenant_id indexes for status and sla_tier lookups.
CREATE INDEX IF NOT EXISTS organizations_tenant_status_idx
  ON organizations (tenant_id, status);

CREATE INDEX IF NOT EXISTS organizations_tenant_sla_tier_idx
  ON organizations (tenant_id, sla_tier);

-- Partial unique index: lower(name) per tenant for active organizations only.
-- Prevents duplicate active org names; inactive orgs may collide without error.
CREATE UNIQUE INDEX IF NOT EXISTS organizations_tenant_active_name_uniq
  ON organizations (tenant_id, lower(name))
  WHERE status = 'active';

-- Enable and force RLS on organizations.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_organizations ON organizations;
CREATE POLICY tenant_isolation_organizations ON organizations
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- Grant application role access (no DELETE on organizations per spec).
-- GRANT SELECT, INSERT, UPDATE ON organizations TO opsninja_app;

-- ==========================================================================
-- 2. customer_accounts
-- ==========================================================================

CREATE TABLE IF NOT EXISTS customer_accounts (
  id              UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL,
  name            TEXT        NOT NULL,
  external_id     TEXT,
  organization_id UUID        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  -- Composite FK includes tenant_id so cross-tenant references are impossible.
  CONSTRAINT customer_accounts_org_fk
    FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations (tenant_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS customer_accounts_tenant_id_idx
  ON customer_accounts (tenant_id);

CREATE INDEX IF NOT EXISTS customer_accounts_tenant_org_idx
  ON customer_accounts (tenant_id, organization_id);

ALTER TABLE customer_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_customer_accounts ON customer_accounts
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ==========================================================================
-- 3. contacts  (Confidential — contains PII)
-- ==========================================================================

-- Enable citext for case-insensitive email storage.
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS contacts (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL,
  organization_id     UUID        NOT NULL,
  email               CITEXT      NOT NULL,
  full_name           TEXT        NOT NULL,
  job_title           TEXT,
  portal_access_enabled BOOLEAN   NOT NULL DEFAULT false,
  status              TEXT        NOT NULL DEFAULT 'active',
  last_portal_login_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  -- Composite FK includes tenant_id.
  CONSTRAINT contacts_org_fk
    FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations (tenant_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  -- One email per tenant (case-insensitive via citext).
  CONSTRAINT contacts_tenant_email_uniq
    UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS contacts_tenant_id_idx
  ON contacts (tenant_id);

CREATE INDEX IF NOT EXISTS contacts_tenant_org_idx
  ON contacts (tenant_id, organization_id);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_contacts ON contacts
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- Now add the composite FK from organizations.primary_contact_id to contacts.
-- (Must come after contacts table is created.)
ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_primary_contact_fk;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_primary_contact_fk
  FOREIGN KEY (tenant_id, primary_contact_id)
  REFERENCES contacts (tenant_id, id)
  DEFERRABLE INITIALLY DEFERRED;

-- ==========================================================================
-- 4. organization_verified_domains
-- ==========================================================================

CREATE TABLE IF NOT EXISTS organization_verified_domains (
  id              UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL,
  organization_id UUID        NOT NULL,
  domain          TEXT        NOT NULL,
  verified_via    TEXT        NOT NULL DEFAULT 'dns_txt',
  verified_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT org_verified_domains_org_fk
    FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations (tenant_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

-- Unique constraint: one domain per tenant (case-insensitive).
-- Two organizations in different tenants may hold the same domain.
CREATE UNIQUE INDEX IF NOT EXISTS org_verified_domains_tenant_domain_uniq
  ON organization_verified_domains (tenant_id, lower(domain));

CREATE INDEX IF NOT EXISTS org_verified_domains_tenant_id_idx
  ON organization_verified_domains (tenant_id);

CREATE INDEX IF NOT EXISTS org_verified_domains_tenant_org_idx
  ON organization_verified_domains (tenant_id, organization_id);

ALTER TABLE organization_verified_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_verified_domains FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_organization_verified_domains
  ON organization_verified_domains
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ==========================================================================
-- 5. custom_field_defs
-- ==========================================================================

CREATE TABLE IF NOT EXISTS custom_field_defs (
  id             UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL,
  field_key      TEXT        NOT NULL,
  label          TEXT        NOT NULL,
  data_type      TEXT        NOT NULL,
  options        JSONB,
  required       BOOLEAN     NOT NULL DEFAULT false,
  applies_to     TEXT        NOT NULL DEFAULT 'organization',
  display_order  INTEGER     NOT NULL DEFAULT 0,
  archived_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT custom_field_defs_data_type_check
    CHECK (data_type IN ('string','number','boolean','date','single_select','multi_select')),
  CONSTRAINT custom_field_defs_tenant_key_uniq
    UNIQUE (tenant_id, field_key)
);

CREATE INDEX IF NOT EXISTS custom_field_defs_tenant_id_idx
  ON custom_field_defs (tenant_id);

ALTER TABLE custom_field_defs ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_field_defs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_custom_field_defs ON custom_field_defs
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ==========================================================================
-- Also add composite (tenant_id, id) unique constraint to organizations
-- so it can serve as the target of composite FKs from other tables.
-- ==========================================================================

ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_tenant_id_id_uniq;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_tenant_id_id_uniq
  UNIQUE (tenant_id, id);
