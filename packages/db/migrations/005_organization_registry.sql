-- Migration 005: Organization Registry Schema
-- Extends organizations and creates customer_accounts, contacts,
-- organization_verified_domains, and custom_field_defs with tenant-scoped
-- RLS policies (USING + WITH CHECK) on every table.
--
-- Data classifications:
--   organizations      — Internal
--   customer_accounts  — Internal
--   contacts           — Confidential (PII)
--   verified_domains   — Internal
--   custom_field_defs  — Internal
--
-- Backward compatible: all new columns are nullable or carry defaults.
-- Run as the database owner; the application role (opsninja_app) is granted
-- SELECT, INSERT, UPDATE only (no hard-delete from registry tables).

-- ── Extensions ─────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS citext;

-- ── Enums ──────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'organization_status') THEN
    CREATE TYPE organization_status AS ENUM ('active', 'inactive');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contact_status') THEN
    CREATE TYPE contact_status AS ENUM ('active', 'inactive', 'bounced');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'custom_field_data_type') THEN
    CREATE TYPE custom_field_data_type AS ENUM (
      'string', 'number', 'boolean', 'date', 'single_select', 'multi_select'
    );
  END IF;
END$$;

-- ── ALTER TABLE organizations ──────────────────────────────────────────────────
-- Add full registry columns to the existing minimal organizations table.
-- All additions are expand-only (ADD COLUMN IF NOT EXISTS) for backward compatibility.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS slug                TEXT,
  ADD COLUMN IF NOT EXISTS sla_tier            TEXT,
  ADD COLUMN IF NOT EXISTS region              TEXT,
  ADD COLUMN IF NOT EXISTS status              organization_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS custom_field_values JSONB               NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS primary_contact_id  UUID,
  ADD COLUMN IF NOT EXISTS deactivated_at      TIMESTAMPTZ;

-- Add composite unique constraint required for composite FK references from child tables.
-- This allows contacts, customer_accounts and verified_domains to reference
-- (tenant_id, organization_id) — making cross-tenant foreign keys structurally invalid.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'organizations'::regclass
      AND conname = 'organizations_tenant_id_uidx'
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_tenant_id_uidx UNIQUE (tenant_id, id);
  END IF;
END$$;

-- Replace existing RLS policy with a USING + WITH CHECK variant.
-- Use DROP IF EXISTS / CREATE so re-running the migration is idempotent.
DROP POLICY IF EXISTS tenant_isolation_organizations ON organizations;
DROP POLICY IF EXISTS organizations_tenant_isolation ON organizations;

CREATE POLICY tenant_isolation_organizations
  ON organizations
  AS PERMISSIVE
  FOR ALL
  USING  (tenant_id = current_setting('app.current_tenant', TRUE)::UUID)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

-- Indexes on organizations (tenant_id-leading per isolation convention)
CREATE INDEX IF NOT EXISTS organizations_tenant_status_idx
  ON organizations (tenant_id, status);

CREATE INDEX IF NOT EXISTS organizations_tenant_sla_tier_idx
  ON organizations (tenant_id, sla_tier);

-- Partial unique: one active organization per lower(name) within a tenant.
-- Two tenants may have identically-named organizations — uniqueness is per-tenant.
-- Reactivating a name that collides with an existing active org will fail here.
CREATE UNIQUE INDEX IF NOT EXISTS organizations_tenant_name_active_uidx
  ON organizations (tenant_id, lower(name))
  WHERE status = 'active';

-- GIN index for JSONB custom_field_values lookups
CREATE INDEX IF NOT EXISTS organizations_custom_field_values_gin_idx
  ON organizations USING gin (custom_field_values);

-- ── customer_accounts ─────────────────────────────────────────────────────────
-- Billing or parent-account grouping. References organizations via composite FK
-- so cross-tenant references are impossible at the constraint level.

CREATE TABLE IF NOT EXISTS customer_accounts (
  id              UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL,
  organization_id UUID        NOT NULL,
  name            TEXT        NOT NULL,
  billing_email   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT customer_accounts_pkey
    PRIMARY KEY (tenant_id, id),
  CONSTRAINT customer_accounts_org_fk
    FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations (tenant_id, id)
    ON DELETE RESTRICT
);

ALTER TABLE customer_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_customer_accounts
  ON customer_accounts
  AS PERMISSIVE
  FOR ALL
  USING  (tenant_id = current_setting('app.current_tenant', TRUE)::UUID)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);

CREATE INDEX IF NOT EXISTS customer_accounts_tenant_org_idx
  ON customer_accounts (tenant_id, organization_id);

-- ── contacts ──────────────────────────────────────────────────────────────────
-- PII — Confidential. Email stored as citext for case-insensitive comparison.

CREATE TABLE IF NOT EXISTS contacts (
  id                     UUID           NOT NULL DEFAULT gen_random_uuid(),
  tenant_id              UUID           NOT NULL,
  organization_id        UUID           NOT NULL,
  -- citext: case-insensitive; requires the citext extension
  email                  CITEXT         NOT NULL,
  full_name              TEXT           NOT NULL,
  job_title              TEXT,
  portal_access_enabled  BOOLEAN        NOT NULL DEFAULT FALSE,
  status                 contact_status NOT NULL DEFAULT 'active',
  last_portal_login_at   TIMESTAMPTZ,
  created_at             TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ    NOT NULL DEFAULT now(),

  CONSTRAINT contacts_pkey
    PRIMARY KEY (tenant_id, id),
  CONSTRAINT contacts_org_fk
    FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations (tenant_id, id)
    ON DELETE RESTRICT
);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_contacts
  ON contacts
  AS PERMISSIVE
  FOR ALL
  USING  (tenant_id = current_setting('app.current_tenant', TRUE)::UUID)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);

CREATE INDEX IF NOT EXISTS contacts_tenant_org_idx
  ON contacts (tenant_id, organization_id);

CREATE INDEX IF NOT EXISTS contacts_tenant_status_idx
  ON contacts (tenant_id, status);

-- citext makes this comparison case-insensitive without lower()
CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_email_uidx
  ON contacts (tenant_id, email);

-- ── organization_verified_domains ─────────────────────────────────────────────
-- AC5: unique constraint on (tenant_id, lower(domain)) — one domain per tenant.

CREATE TABLE IF NOT EXISTS organization_verified_domains (
  id              UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL,
  organization_id UUID        NOT NULL,
  -- citext: case-insensitive domain matching
  domain          CITEXT      NOT NULL,
  verified_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT organization_verified_domains_pkey
    PRIMARY KEY (tenant_id, id),
  CONSTRAINT organization_verified_domains_org_fk
    FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations (tenant_id, id)
    ON DELETE RESTRICT
);

ALTER TABLE organization_verified_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_verified_domains FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_organization_verified_domains
  ON organization_verified_domains
  AS PERMISSIVE
  FOR ALL
  USING  (tenant_id = current_setting('app.current_tenant', TRUE)::UUID)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);

-- AC5: one domain cannot bind to two organizations within the same tenant.
-- lower() cast is explicit here; citext would also handle it, but the SQL
-- standard function makes the intent obvious in EXPLAIN output.
CREATE UNIQUE INDEX IF NOT EXISTS org_verified_domains_tenant_domain_uidx
  ON organization_verified_domains (tenant_id, lower(domain::text));

CREATE INDEX IF NOT EXISTS org_verified_domains_tenant_org_idx
  ON organization_verified_domains (tenant_id, organization_id);

-- ── custom_field_defs ─────────────────────────────────────────────────────────
-- No per-tenant DDL. DevOps metadata lives in organizations.custom_field_values
-- JSONB; this table provides the schema/validation contract.

CREATE TABLE IF NOT EXISTS custom_field_defs (
  id              UUID                   NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       UUID                   NOT NULL,
  field_key       TEXT                   NOT NULL,
  label           TEXT                   NOT NULL,
  data_type       custom_field_data_type NOT NULL,
  options         JSONB,
  required        BOOLEAN                NOT NULL DEFAULT FALSE,
  applies_to      TEXT                   NOT NULL DEFAULT 'organization',
  display_order   INTEGER                NOT NULL DEFAULT 0,
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ            NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ            NOT NULL DEFAULT now(),

  CONSTRAINT custom_field_defs_pkey
    PRIMARY KEY (tenant_id, id)
);

ALTER TABLE custom_field_defs ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_field_defs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_custom_field_defs
  ON custom_field_defs
  AS PERMISSIVE
  FOR ALL
  USING  (tenant_id = current_setting('app.current_tenant', TRUE)::UUID)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);

-- Active (non-archived) field_key must be unique per tenant
CREATE UNIQUE INDEX IF NOT EXISTS custom_field_defs_tenant_field_key_uidx
  ON custom_field_defs (tenant_id, field_key)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS custom_field_defs_tenant_applies_to_idx
  ON custom_field_defs (tenant_id, applies_to);

-- ── Grants ────────────────────────────────────────────────────────────────────
-- SELECT, INSERT, UPDATE only — no hard DELETE on registry tables.
-- Replace 'opsninja_app' with the provisioned application role.

-- GRANT SELECT, INSERT, UPDATE ON organizations TO opsninja_app;
-- GRANT SELECT, INSERT, UPDATE ON customer_accounts TO opsninja_app;
-- GRANT SELECT, INSERT, UPDATE ON contacts TO opsninja_app;
-- GRANT SELECT, INSERT, UPDATE ON organization_verified_domains TO opsninja_app;
-- GRANT SELECT, INSERT, UPDATE ON custom_field_defs TO opsninja_app;
