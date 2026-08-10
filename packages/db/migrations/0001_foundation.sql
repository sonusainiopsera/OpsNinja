-- =============================================================================
-- OpsNinja Foundation Schema Migration
-- Version: 0001
-- Description: Creates all foundation tables for the multi-tenant platform:
--   tenants, organizations, organization_verified_domains, custom_field_defs,
--   customer_contacts, users, role_assignments, agent_org_scopes, categories,
--   tickets (partitioned), ticket_comments (partitioned), audit_logs (partitioned),
--   outbox_events, retention_policies.
--
-- Design invariants:
--   1. Every tenant-scoped table has a non-nullable tenant_id uuid as the
--      leading column of its primary key or principal composite index.
--   2. All FKs between tenant-scoped tables are composite and include tenant_id
--      to enforce cross-tenant containment at the database level.
--   3. High-volume tables (tickets, ticket_comments, audit_logs) are PARTITION
--      BY RANGE on created_at/occurred_at with monthly child partitions.
--   4. No destructive DDL — forward-compatible expand-and-contract discipline.
--
-- Expand-and-contract exceptions documented inline.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. TENANTS
--    Root entity. NOT tenant-scoped (it IS the tenant registry).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  name           text        NOT NULL,
  -- plan_tier: starter | growth | enterprise
  plan_tier      text        NOT NULL DEFAULT 'starter'
                              CHECK (plan_tier IN ('starter', 'growth', 'enterprise')),
  ai_synthesis_enabled boolean NOT NULL DEFAULT false,
  is_active      boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

COMMENT ON TABLE  tenants IS 'Root multi-tenant registry; every other entity is scoped to a row here.';
COMMENT ON COLUMN tenants.plan_tier IS 'starter | growth | enterprise; drives feature flags and usage limits.';

-- ---------------------------------------------------------------------------
-- 2. ORGANIZATIONS
--    tenant_id-leading composite PK (tenant_id, id).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
  tenant_id           uuid        NOT NULL REFERENCES tenants(id),
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  name                text        NOT NULL,
  -- tier: standard | premium | enterprise (per-org, distinct from tenant plan_tier)
  tier                text        NOT NULL DEFAULT 'standard'
                                   CHECK (tier IN ('standard', 'premium', 'enterprise')),
  region              text,
  is_active           boolean     NOT NULL DEFAULT true,
  -- JSONB DevOps metadata. GIN index created below for containment queries.
  custom_field_values jsonb       NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

COMMENT ON COLUMN organizations.custom_field_values IS 'Arbitrary DevOps metadata keyed by custom_field_defs.key. GIN-indexed for fast containment queries.';
COMMENT ON COLUMN organizations.is_active IS 'Deactivation flag; hard delete is blocked by FK dependencies from tickets.';

-- GIN index with jsonb_path_ops for fast containment (@>) and existence queries.
CREATE INDEX IF NOT EXISTS idx_organizations_custom_fields
  ON organizations USING GIN (custom_field_values jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- 3. ORGANIZATION_VERIFIED_DOMAINS
--    Per-tenant domain uniqueness enforces that two organizations within one
--    tenant cannot claim the same domain, while different tenants may both
--    hold example.com.
--
--    Composite FK (tenant_id, organization_id) → organizations is the
--    cross-tenant containment lock.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_verified_domains (
  tenant_id       uuid        NOT NULL,
  organization_id uuid        NOT NULL,
  domain          text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- PK doubles as the per-tenant domain uniqueness constraint.
  PRIMARY KEY (tenant_id, domain),
  -- Composite FK: domain cannot reference an org from a different tenant.
  CONSTRAINT fk_ovd_organization
    FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations(tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_ovd_organization
  ON organization_verified_domains (tenant_id, organization_id);

-- ---------------------------------------------------------------------------
-- 4. CUSTOM_FIELD_DEFS
--    Per-tenant schema for custom fields applied to organizations, tickets or
--    contacts. UNIQUE (tenant_id, key) prevents duplicate field keys.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS custom_field_defs (
  tenant_id   uuid        NOT NULL REFERENCES tenants(id),
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  key         text        NOT NULL,
  label       text        NOT NULL,
  -- data_type: text | number | boolean | date | select
  data_type   text        NOT NULL
               CHECK (data_type IN ('text', 'number', 'boolean', 'date', 'select')),
  required    boolean     NOT NULL DEFAULT false,
  -- applies_to: organization | ticket | contact
  applies_to  text        NOT NULL
               CHECK (applies_to IN ('organization', 'ticket', 'contact')),
  -- validation: optional JSON constraints (min/max for numbers, regex for text, options for select)
  validation  jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, key)
);

-- ---------------------------------------------------------------------------
-- 5. USERS
--    Internal staff and portal customers. kind='staff' requires OIDC;
--    kind='portal' uses magic-link or self-service signup.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  tenant_id        uuid        NOT NULL REFERENCES tenants(id),
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  -- external_subject: OIDC sub claim; NULL for portal users without SSO.
  external_subject text,
  email            text        NOT NULL,
  -- kind: staff | portal
  kind             text        NOT NULL
                    CHECK (kind IN ('staff', 'portal')),
  -- status: active | inactive | pending
  status           text        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'inactive', 'pending')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_external_subject
  ON users (tenant_id, external_subject)
  WHERE external_subject IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. CUSTOMER_CONTACTS
--    External contact records tied to an organization.
--    Composite FK (tenant_id, organization_id) prevents cross-tenant
--    contact attachment.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_contacts (
  tenant_id             uuid        NOT NULL REFERENCES tenants(id),
  id                    uuid        NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid        NOT NULL,
  email                 text        NOT NULL,
  name                  text        NOT NULL,
  portal_access_enabled boolean     NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, email),
  -- Composite FK: contact's org must belong to the same tenant.
  CONSTRAINT fk_contacts_organization
    FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations(tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- 7. ROLE_ASSIGNMENTS
--    Maps users to roles within a tenant. scope_version is bumped on every
--    org-scope change; the auth guard forces JWT re-issuance when it advances.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_assignments (
  tenant_id     uuid        NOT NULL REFERENCES tenants(id),
  user_id       uuid        NOT NULL,
  -- role: admin | agent | manager | lead | integration_admin | portal_user
  role          text        NOT NULL
                 CHECK (role IN ('admin', 'agent', 'manager', 'lead', 'integration_admin', 'portal_user')),
  -- scope_version: monotonic bigint counter; bumped on org-scope changes.
  scope_version bigint      NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, role),
  -- Composite FK: user must belong to the same tenant.
  CONSTRAINT fk_role_assignments_user
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES users(tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- 8. AGENT_ORG_SCOPES
--    Controls which organizations an agent can access and at what level.
--    Composite FKs to both users and organizations.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_org_scopes (
  tenant_id       uuid        NOT NULL REFERENCES tenants(id),
  user_id         uuid        NOT NULL,
  organization_id uuid        NOT NULL,
  -- access_level: read | write | admin
  access_level    text        NOT NULL DEFAULT 'read'
                   CHECK (access_level IN ('read', 'write', 'admin')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, organization_id),
  CONSTRAINT fk_agent_scopes_user
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES users(tenant_id, id),
  CONSTRAINT fk_agent_scopes_organization
    FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations(tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- 9. CATEGORIES
--    Multi-level (self-referencing) category tree.
--
--    parent_id FK is a composite (tenant_id, parent_id) → (tenant_id, id)
--    to prevent cross-tenant parent references.
--
--    Sibling-name uniqueness is enforced with two partial unique indexes:
--      - Root nodes (parent_id IS NULL): unique on (tenant_id, lower(name))
--      - Child nodes (parent_id IS NOT NULL): unique on (tenant_id, parent_id, lower(name))
--
--    path is a materialised text column maintained by the application service.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  tenant_id  uuid        NOT NULL REFERENCES tenants(id),
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  parent_id  uuid,
  name       text        NOT NULL,
  -- Materialised path, e.g. "Pipeline / Jenkins Integration"
  path       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  -- Composite self-FK: parent must belong to the same tenant.
  CONSTRAINT fk_categories_parent
    FOREIGN KEY (tenant_id, parent_id)
    REFERENCES categories(tenant_id, id)
);

-- Index on (tenant_id, path) for prefix-lookup queries.
CREATE INDEX IF NOT EXISTS idx_categories_path
  ON categories (tenant_id, path);

-- Uniqueness: root categories (no parent) must have unique lower(name) per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_root_name
  ON categories (tenant_id, lower(name))
  WHERE parent_id IS NULL;

-- Uniqueness: child categories must have unique lower(name) per parent per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_child_name
  ON categories (tenant_id, parent_id, lower(name))
  WHERE parent_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 10. TICKETS  (PARTITION BY RANGE on created_at)
--
--     PK: (tenant_id, id, created_at)
--     created_at is in the PK because PostgreSQL requires the partition key
--     to be part of the primary key for partitioned tables.
--
--     Cross-tenant containment FKs:
--       (tenant_id, organization_id)     → organizations
--       (tenant_id, requester_contact_id) → customer_contacts
--       (tenant_id, assignee_user_id)     → users
--       (tenant_id, category_id)          → categories
--
--     EXCEPTION: PostgreSQL ≤16 does not allow FK references TO a partitioned
--     table. ticket_comments → tickets is enforced by a trigger-free check
--     (application-layer validation + the composite tenant_id predicate in
--     the RLS policy, which closes the gap). See migrations/README.md.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
  tenant_id          uuid        NOT NULL REFERENCES tenants(id),
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  organization_id    uuid        NOT NULL,
  requester_contact_id uuid,
  assignee_user_id   uuid,
  -- status: open | pending | on_hold | solved | closed
  status             text        NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'pending', 'on_hold', 'solved', 'closed')),
  -- priority: P1 (critical) | P2 | P3 | P4 (low)
  priority           text        NOT NULL DEFAULT 'P3'
                      CHECK (priority IN ('P1', 'P2', 'P3', 'P4')),
  category_id        uuid,
  subject            text        NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id, created_at),
  -- Cross-tenant containment FKs.
  CONSTRAINT fk_tickets_organization
    FOREIGN KEY (tenant_id, organization_id)
    REFERENCES organizations(tenant_id, id),
  -- Requester contact is optional (agent-created tickets may not have one).
  CONSTRAINT fk_tickets_requester
    FOREIGN KEY (tenant_id, requester_contact_id)
    REFERENCES customer_contacts(tenant_id, id),
  -- Assignee is optional (unassigned tickets).
  CONSTRAINT fk_tickets_assignee
    FOREIGN KEY (tenant_id, assignee_user_id)
    REFERENCES users(tenant_id, id),
  -- Category is optional.
  CONSTRAINT fk_tickets_category
    FOREIGN KEY (tenant_id, category_id)
    REFERENCES categories(tenant_id, id)
) PARTITION BY RANGE (created_at);

-- Default catch-all partition for out-of-range inserts.
-- Rows landing here trigger a monitored metric rather than failing the write.
CREATE TABLE IF NOT EXISTS tickets_default PARTITION OF tickets DEFAULT;

-- ---------------------------------------------------------------------------
-- 11. TICKET_COMMENTS  (PARTITION BY RANGE on created_at)
--
--     PK: (tenant_id, id, created_at)
--
--     FK Exception: Cannot create FK to partitioned tickets table in PG ≤16.
--     ticket_comments.ticket_id is validated at the application layer.
--     See migrations/README.md.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_comments (
  tenant_id      uuid        NOT NULL REFERENCES tenants(id),
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  ticket_id      uuid        NOT NULL,
  author_user_id uuid        NOT NULL,
  -- visibility: public | internal. Default 'internal' for agent notes.
  visibility     text        NOT NULL DEFAULT 'internal'
                  CHECK (visibility IN ('public', 'internal')),
  body           text        NOT NULL,
  PRIMARY KEY (tenant_id, id, created_at),
  -- author must belong to the same tenant.
  CONSTRAINT fk_comments_author
    FOREIGN KEY (tenant_id, author_user_id)
    REFERENCES users(tenant_id, id)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS ticket_comments_default PARTITION OF ticket_comments DEFAULT;

-- ---------------------------------------------------------------------------
-- 12. AUDIT_LOGS  (PARTITION BY RANGE on occurred_at)
--
--     Append-only. UPDATE and DELETE are revoked from the application role.
--     The application connects as app_user; see REVOKE section below.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  tenant_id     uuid        NOT NULL REFERENCES tenants(id),
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  -- occurred_at is the partition key and canonical timestamp.
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  -- actor_type: user | system | integration
  actor_type    text        NOT NULL,
  actor_id      uuid,
  -- action: create | update | delete | access_denied | login | logout | etc.
  action        text        NOT NULL,
  resource_type text        NOT NULL,
  resource_id   uuid        NOT NULL,
  before_state  jsonb,
  after_state   jsonb,
  trace_id      text,
  PRIMARY KEY (tenant_id, id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS audit_logs_default PARTITION OF audit_logs DEFAULT;

-- Composite index on (tenant_id, occurred_at) for time-range queries.
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_time
  ON audit_logs (tenant_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- 13. OUTBOX_EVENTS
--     Transactional outbox for reliable event delivery.
--     published_at is NULL for undelivered events (drain loop query target).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbox_events (
  tenant_id      uuid        NOT NULL REFERENCES tenants(id),
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  aggregate_type text        NOT NULL,
  aggregate_id   uuid        NOT NULL,
  event_type     text        NOT NULL,
  payload        jsonb       NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz,
  attempts       integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id)
);

-- Drain loop queries unpublished events ordered by created_at.
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
  ON outbox_events (tenant_id, created_at)
  WHERE published_at IS NULL;

-- ---------------------------------------------------------------------------
-- 14. RETENTION_POLICIES
--     Data-driven configuration for the future purge job.
--     Not tenant-scoped — platform-wide policy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retention_policies (
  table_name       text        NOT NULL,
  retention_months integer     NOT NULL DEFAULT 24,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (table_name)
);

-- Insert launch defaults.
INSERT INTO retention_policies (table_name, retention_months)
VALUES
  ('tickets',        24),
  ('ticket_comments', 24),
  ('audit_logs',     24)
ON CONFLICT (table_name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 15. PARTITION HELPER FUNCTION
--     ensure_monthly_partitions(table_name, months_ahead) idempotently
--     creates the next N monthly partitions for a range-partitioned table.
--     Safe to call repeatedly — IF NOT EXISTS is used throughout.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ensure_monthly_partitions(
  p_table_name  text,
  p_months_ahead integer DEFAULT 3
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_offset         integer;
  v_month          date;
  v_partition_name text;
  v_start_date     text;
  v_end_date       text;
BEGIN
  FOR v_offset IN 0..p_months_ahead LOOP
    v_month          := date_trunc('month', CURRENT_DATE + (v_offset || ' months')::interval)::date;
    v_partition_name := p_table_name || '_' || to_char(v_month, 'YYYY_MM');
    v_start_date     := to_char(v_month, 'YYYY-MM-01');
    v_end_date       := to_char(v_month + interval '1 month', 'YYYY-MM-01');

    BEGIN
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L::timestamptz) TO (%L::timestamptz)',
        v_partition_name,
        p_table_name,
        v_start_date,
        v_end_date
      );
    EXCEPTION
      -- Partition already exists as a non-IF-NOT-EXISTS path fallback.
      WHEN duplicate_table THEN NULL;
      -- Partition range already covered (overlapping partition definition).
      WHEN invalid_object_definition THEN NULL;
    END;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION ensure_monthly_partitions IS
  'Idempotently creates monthly range partitions for a PARTITION BY RANGE table. '
  'Safe to call multiple times; existing partitions are silently skipped.';

-- Create initial partitions for the current month plus 3 months ahead.
SELECT ensure_monthly_partitions('tickets',        3);
SELECT ensure_monthly_partitions('ticket_comments', 3);
SELECT ensure_monthly_partitions('audit_logs',     3);

-- ---------------------------------------------------------------------------
-- 16. ADDITIONAL INDEXES on high-query-path columns
-- ---------------------------------------------------------------------------

-- tickets: primary agent queue queries filter by (tenant_id, status, priority, updated_at)
CREATE INDEX IF NOT EXISTS idx_tickets_queue
  ON tickets (tenant_id, status, priority, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_organization
  ON tickets (tenant_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_tickets_assignee
  ON tickets (tenant_id, assignee_user_id)
  WHERE assignee_user_id IS NOT NULL;

-- ticket_comments: lookup by ticket
CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket
  ON ticket_comments (tenant_id, ticket_id, created_at);

-- outbox_events: drain loop ordering
CREATE INDEX IF NOT EXISTS idx_outbox_aggregate
  ON outbox_events (tenant_id, aggregate_type, aggregate_id);

-- ---------------------------------------------------------------------------
-- 17. APPLICATION ROLE PERMISSIONS
--     The application connects as 'app_user'. Revoke mutating grants on
--     audit_logs to enforce append-only semantics.
--
--     The role may not exist in all environments (created by infra); the
--     DO block is defensive.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    -- Audit logs are append-only; mutations are forbidden at the DB level.
    REVOKE UPDATE, DELETE ON audit_logs FROM app_user;
    -- Ensure default partitions inherit the restriction.
    REVOKE UPDATE, DELETE ON audit_logs_default FROM app_user;
  END IF;
END;
$$;

COMMIT;
