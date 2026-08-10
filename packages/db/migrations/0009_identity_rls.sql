-- =============================================================================
-- OpsNinja Identity Schema, RLS Policies and Application Database Role
-- Version: 0009
-- Description:
--   1. Adds a helper function `app_current_tenant()` that safely parses the
--      session variable `app.current_tenant` → UUID, failing closed (NULL)
--      when unset, empty, or an invalid UUID string.
--   2. Expands the existing `users` table (email_normalized, display_name,
--      user_type). Expand-only — existing `kind` column is retained.
--   3. Creates identity tables: roles, permissions, role_permissions,
--      user_roles, refresh_sessions, email_verification_tokens,
--      pending_user_approvals.
--   4. Creates the `app_user` database role (NOSUPERUSER, NOBYPASSRLS) and
--      grants the minimum DML required to operate all identity tables.
--   5. Enables and FORCES Row-Level Security on every tenant-scoped table
--      (including tables from earlier migrations), using `app_current_tenant()`
--      as the policy predicate.
--
-- Invariants:
--   - All tenant-scoped tables have tenant_id as the leading PK column.
--   - FORCE ROW LEVEL SECURITY: no bypass for table owners; only superusers
--     (used for migrations and seeds) bypass the policy.
--   - Token values (refresh tokens, verification tokens) are SHA-256 hashes;
--     plaintext tokens must never appear in any column.
--   - Expand-only; no destructive DDL.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. TENANT CONTEXT HELPER FUNCTION
--    Returns the current tenant UUID from the session variable, or NULL when
--    the variable is unset, empty, or an invalid UUID string. Used by every
--    RLS USING / WITH CHECK predicate so policy expressions stay readable.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE plpgsql STABLE PARALLEL SAFE
AS $$
BEGIN
  RETURN nullif(current_setting('app.current_tenant', true), '')::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  -- app.current_tenant was set to a non-UUID string; fail closed.
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION app_current_tenant IS
  'Returns current_setting(''app.current_tenant'') cast to uuid. '
  'Returns NULL when unset, empty, or an invalid UUID — policies fail closed.';

-- ---------------------------------------------------------------------------
-- 2. EXPAND USERS TABLE
--    Additive columns alongside the existing `kind` column. email_normalized
--    enables case-insensitive uniqueness; user_type adds machine principals;
--    display_name stores the rendered name.
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_normalized text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name     text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_type        text
  CHECK (user_type IN ('staff', 'portal', 'machine'));

-- Backfill email_normalized from existing email values (idempotent via WHERE).
UPDATE users
SET    email_normalized = lower(trim(email))
WHERE  email_normalized IS NULL;

-- Backfill user_type from the existing kind column.
UPDATE users
SET    user_type = kind
WHERE  user_type IS NULL AND kind IS NOT NULL;

-- Unique per-tenant case-insensitive email constraint.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_tenant_email_normalized
  ON users (tenant_id, email_normalized)
  WHERE email_normalized IS NOT NULL;

-- Partial index for fast staff lookups.
CREATE INDEX IF NOT EXISTS idx_users_user_type
  ON users (tenant_id, user_type)
  WHERE user_type IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. ROLES
--    Global RBAC catalog table. Not tenant-scoped; no RLS required.
--    The six canonical roles (support_admin, support_manager, support_lead,
--    support_agent, integration_admin, portal_user) are installed by the
--    identity-roles seed. Machine principals must not be assigned interactive
--    roles; that invariant is enforced at the service layer.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  name         text        NOT NULL,
  display_name text        NOT NULL,
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (name)
);

COMMENT ON TABLE  roles IS 'Global RBAC role catalog; not tenant-scoped.';
COMMENT ON COLUMN roles.name IS 'Canonical slug, e.g. support_admin, portal_user.';

-- ---------------------------------------------------------------------------
-- 4. PERMISSIONS
--    Permission codes in resource:action format. Global catalog; no RLS.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permissions (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  code        text        NOT NULL,   -- e.g. ticket:reassign, jira:configure
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (code)
);

COMMENT ON TABLE  permissions IS 'Global permission catalog; resource:action format.';
COMMENT ON COLUMN permissions.code IS 'Canonical permission string, e.g. ticket:reassign.';

-- ---------------------------------------------------------------------------
-- 5. ROLE_PERMISSIONS
--    Junction table between roles and permissions. Global; no RLS.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       uuid        NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid        NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role
  ON role_permissions (role_id);

-- ---------------------------------------------------------------------------
-- 6. USER_ROLES
--    Per-tenant user-to-role assignments. Replaces the text-role
--    role_assignments table with a normalized FK to roles.
--    Composite FK (tenant_id, user_id) → users enforces cross-tenant safety.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_roles (
  tenant_id  uuid        NOT NULL REFERENCES tenants(id),
  user_id    uuid        NOT NULL,
  role_id    uuid        NOT NULL REFERENCES roles(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid,   -- user_id of the manager who granted this role
  PRIMARY KEY (tenant_id, user_id, role_id),
  CONSTRAINT fk_user_roles_user
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES users(tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user
  ON user_roles (tenant_id, user_id);

CREATE INDEX IF NOT EXISTS idx_user_roles_role
  ON user_roles (role_id);

-- ---------------------------------------------------------------------------
-- 7. REFRESH_SESSIONS
--    Server-side session metadata for rotating refresh tokens.
--    token_hash is SHA-256(raw_token) — plaintext is never stored.
--    user_agent_hash and ip_hash are SHA-256 to avoid storing PII while
--    preserving anomaly-detection capability.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_sessions (
  tenant_id       uuid        NOT NULL REFERENCES tenants(id),
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL,
  token_hash      text        NOT NULL,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  user_agent_hash text,
  ip_hash         text,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (token_hash),
  CONSTRAINT fk_sessions_user
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES users(tenant_id, id)
);

COMMENT ON COLUMN refresh_sessions.token_hash IS 'SHA-256 of the raw refresh token; plaintext must never be stored.';
COMMENT ON COLUMN refresh_sessions.user_agent_hash IS 'SHA-256 of User-Agent header; enables anomaly detection without storing PII.';

-- Active sessions: most common query path for token validation.
CREATE INDEX IF NOT EXISTS idx_refresh_sessions_active
  ON refresh_sessions (tenant_id, user_id)
  WHERE revoked_at IS NULL;

-- Token lookup by hash (login/refresh flow).
CREATE INDEX IF NOT EXISTS idx_refresh_sessions_token_hash
  ON refresh_sessions (token_hash)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 8. EMAIL_VERIFICATION_TOKENS
--    Single-use email verification tokens. tenant_id is nullable because
--    a signup email may arrive before the domain is matched to a tenant.
--    token_hash is SHA-256(raw_token).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid,   -- nullable: unbound pre-tenant signups
  token_hash  text        NOT NULL,
  email       text        NOT NULL,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (token_hash)
);

COMMENT ON COLUMN email_verification_tokens.tenant_id IS 'NULL for pre-bind signups awaiting domain resolution.';
COMMENT ON COLUMN email_verification_tokens.token_hash IS 'SHA-256 of the raw verification token; plaintext never stored.';

-- Fast lookup by email for expiry/rate-limit checks.
CREATE INDEX IF NOT EXISTS idx_evtokens_email
  ON email_verification_tokens (email, expires_at)
  WHERE consumed_at IS NULL;

-- ---------------------------------------------------------------------------
-- 9. PENDING_USER_APPROVALS
--    Holds signup requests whose email domain does not match a verified
--    organization domain. tenant_id is nullable until a tenant admin approves
--    and binds the request.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pending_user_approvals (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    uuid,   -- nullable until domain-matched and approved
  email        text        NOT NULL,
  display_name text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at  timestamptz,
  rejected_at  timestamptz,
  reviewed_by  uuid,   -- user_id of the admin who acted
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_pending_approvals_email
  ON pending_user_approvals (email);

CREATE INDEX IF NOT EXISTS idx_pending_approvals_tenant
  ON pending_user_approvals (tenant_id)
  WHERE tenant_id IS NOT NULL AND approved_at IS NULL AND rejected_at IS NULL;

-- ---------------------------------------------------------------------------
-- 10. APPLICATION DATABASE ROLE
--     NOSUPERUSER: cannot escalate privileges.
--     NOBYPASSRLS: subject to all RLS policies on all tables.
--     NOLOGIN: connects via SET ROLE from a login role in production.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOLOGIN
      NOBYPASSRLS;
  END IF;
END;
$$;

COMMENT ON ROLE app_user IS
  'Application runtime role. NOSUPERUSER and NOBYPASSRLS so all RLS policies apply.';

-- Grant minimal DML on identity tables.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    -- Core identity tables
    GRANT SELECT, INSERT, UPDATE         ON users                     TO app_user;
    GRANT SELECT                         ON roles                     TO app_user;
    GRANT SELECT                         ON permissions               TO app_user;
    GRANT SELECT                         ON role_permissions          TO app_user;
    GRANT SELECT, INSERT, DELETE         ON user_roles                TO app_user;
    -- Legacy role_assignments: keep granting so existing code still works
    GRANT SELECT, INSERT, UPDATE, DELETE ON role_assignments          TO app_user;
    GRANT SELECT, INSERT, DELETE         ON agent_org_scopes          TO app_user;
    -- Sessions
    GRANT SELECT, INSERT, UPDATE         ON refresh_sessions          TO app_user;
    GRANT SELECT, INSERT, UPDATE         ON email_verification_tokens TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON pending_user_approvals    TO app_user;
    -- Supporting tables (read/write for application operations)
    GRANT SELECT, INSERT, UPDATE         ON organizations             TO app_user;
    GRANT SELECT, INSERT, DELETE         ON organization_verified_domains TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON custom_field_defs        TO app_user;
    GRANT SELECT                         ON tenants                   TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON categories                TO app_user;
    GRANT SELECT, INSERT, UPDATE         ON tickets                   TO app_user;
    GRANT SELECT, INSERT                 ON ticket_comments           TO app_user;
    GRANT SELECT, INSERT                 ON audit_logs                TO app_user;
    GRANT SELECT, INSERT, UPDATE         ON outbox_events             TO app_user;
    GRANT SELECT, INSERT, UPDATE         ON customer_contacts         TO app_user;
    -- Sequences
    GRANT USAGE                          ON ALL SEQUENCES IN SCHEMA public TO app_user;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 11. ROW-LEVEL SECURITY
--
--     Applied to every tenant-scoped table. Pattern:
--       USING      (tenant_id = app_current_tenant())   -- row visibility
--       WITH CHECK (tenant_id = app_current_tenant())   -- write enforcement
--
--     Tables with nullable tenant_id use a permissive policy:
--       USING      (tenant_id IS NULL OR tenant_id = app_current_tenant())
--
--     Platform-level tables (tenants, roles, permissions, role_permissions,
--     retention_policies) have no tenant_id and no RLS.
--
--     Partitioned tables: RLS is enabled on the parent; all partitions
--     inherit the policy automatically (PostgreSQL 16 behaviour).
-- ---------------------------------------------------------------------------

-- Helper macro: we repeat the same pattern, so inline the policy text here.

-- ·· users ··
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON users;
CREATE POLICY tenant_isolation ON users
  USING      (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- ·· customer_contacts ··
ALTER TABLE customer_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_contacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON customer_contacts;
CREATE POLICY tenant_isolation ON customer_contacts
  USING      (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- ·· role_assignments ··
ALTER TABLE role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON role_assignments;
CREATE POLICY tenant_isolation ON role_assignments
  USING      (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- ·· agent_org_scopes ··
ALTER TABLE agent_org_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_org_scopes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON agent_org_scopes;
CREATE POLICY tenant_isolation ON agent_org_scopes
  USING      (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- ·· user_roles ··
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON user_roles;
CREATE POLICY tenant_isolation ON user_roles
  USING      (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- ·· refresh_sessions ··
ALTER TABLE refresh_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON refresh_sessions;
CREATE POLICY tenant_isolation ON refresh_sessions
  USING      (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- ·· email_verification_tokens (nullable tenant_id) ··
--    Unbound signup rows (tenant_id IS NULL) are always readable for the
--    verification flow; once bound they are filtered by tenant.
ALTER TABLE email_verification_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_verification_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON email_verification_tokens;
CREATE POLICY tenant_isolation ON email_verification_tokens
  USING (
    tenant_id IS NULL
    OR tenant_id = app_current_tenant()
  )
  WITH CHECK (
    tenant_id IS NULL
    OR tenant_id = app_current_tenant()
  );

-- ·· pending_user_approvals (nullable tenant_id) ··
--    Unbound approval rows (tenant_id IS NULL) are globally accessible to
--    the admin approval flow; bound rows are tenant-scoped.
ALTER TABLE pending_user_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_user_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pending_user_approvals;
CREATE POLICY tenant_isolation ON pending_user_approvals
  USING (
    tenant_id IS NULL
    OR tenant_id = app_current_tenant()
  )
  WITH CHECK (
    tenant_id IS NULL
    OR tenant_id = app_current_tenant()
  );

-- ·· organizations ··
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON organizations;
CREATE POLICY tenant_isolation ON organizations
  USING      (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- ·· organization_verified_domains ··
ALTER TABLE organization_verified_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_verified_domains FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON organization_verified_domains;
CREATE POLICY tenant_isolation ON organization_verified_domains
  USING      (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- ·· custom_field_defs ··
ALTER TABLE custom_field_defs ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_field_defs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON custom_field_defs;
CREATE POLICY tenant_isolation ON custom_field_defs
  USING      (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- ·· categories ··
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON categories;
CREATE POLICY tenant_isolation ON categories
  USING      (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- ·· tickets (partitioned parent) ··
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tickets;
CREATE POLICY tenant_isolation ON tickets
  USING      (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- ·· ticket_comments (partitioned parent) ··
ALTER TABLE ticket_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_comments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ticket_comments;
CREATE POLICY tenant_isolation ON ticket_comments
  USING      (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- ·· audit_logs (partitioned parent) ··
--    Append-only; UPDATE and DELETE are already revoked from app_user.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON audit_logs;
CREATE POLICY tenant_isolation ON audit_logs
  USING      (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- ·· outbox_events ··
--    The outbox drain worker (worker-outbox) must connect as a role with
--    BYPASSRLS or as a superuser, since it processes events across all
--    tenants. In production this is handled by a separate drain_user role.
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON outbox_events;
CREATE POLICY tenant_isolation ON outbox_events
  USING      (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

COMMIT;
