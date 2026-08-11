-- =============================================================================
-- WO-003: Row-Level Security for Foundation Tables
-- Description:
--   Enables FORCE ROW LEVEL SECURITY on every tenant-scoped table created
--   in migration 0001_foundation.sql and installs deny-by-default
--   tenant_isolation policies.
--
--   Policy shape:
--     USING      (tenant_id = current_setting('app.current_tenant', true)::uuid)
--     WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid)
--
--   Fail-closed guarantee: current_setting(..., true) returns NULL when the
--   variable is unset; NULL::uuid = NULL yields NULL which is treated as
--   FALSE — zero rows are returned rather than all rows.
--
--   Note: migration 0009_identity_rls.sql later replaces these policies with
--   the app_current_tenant() helper function (equivalent semantics, better
--   error handling). It uses DROP POLICY IF EXISTS so there is no conflict.
--
--   Tables from 0001 covered here:
--     organizations, organization_verified_domains, custom_field_defs,
--     categories, tickets, ticket_comments, audit_logs, outbox_events.
--
--   Tables added later (0009): users, customer_contacts, role_assignments,
--     agent_org_scopes, user_roles, refresh_sessions, email_verification_tokens,
--     pending_user_approvals — handled by 0009_identity_rls.sql.
--
--   Portal policies (RESTRICTIVE): when app.principal_kind = 'portal':
--     • tickets    — only rows whose organization_id is in the caller's
--                    app.current_org_ids list are visible.
--     • ticket_comments — only rows with visibility = 'public' are visible.
--   RESTRICTIVE policies are AND'd with permissive ones so they narrow rather
--   than replace the tenant scope.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

-- app_current_org_ids: parse the comma-separated app.current_org_ids session
-- variable and return a uuid[]. Stable + SECURITY DEFINER so it is planner-
-- friendly and cannot be subverted via search_path.
CREATE OR REPLACE FUNCTION app_current_org_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT elem::uuid
      FROM unnest(
        string_to_array(current_setting('app.current_org_ids', true), ',')
      ) AS elem
      WHERE elem IS NOT NULL AND trim(elem) <> ''
    ),
    ARRAY[]::uuid[]
  );
$$;

COMMENT ON FUNCTION app_current_org_ids IS
  'Returns the portal session''s allowed organization IDs from '
  'app.current_org_ids (comma-separated). Returns empty array when unset.';

-- ---------------------------------------------------------------------------
-- 1. ORGANIZATIONS
-- ---------------------------------------------------------------------------
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON organizations;
CREATE POLICY tenant_isolation ON organizations
  USING      (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ---------------------------------------------------------------------------
-- 2. ORGANIZATION_VERIFIED_DOMAINS
-- ---------------------------------------------------------------------------
ALTER TABLE organization_verified_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_verified_domains FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON organization_verified_domains;
CREATE POLICY tenant_isolation ON organization_verified_domains
  USING      (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ---------------------------------------------------------------------------
-- 3. CUSTOM_FIELD_DEFS
-- ---------------------------------------------------------------------------
ALTER TABLE custom_field_defs ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_field_defs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON custom_field_defs;
CREATE POLICY tenant_isolation ON custom_field_defs
  USING      (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ---------------------------------------------------------------------------
-- 4. CATEGORIES
-- ---------------------------------------------------------------------------
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON categories;
CREATE POLICY tenant_isolation ON categories
  USING      (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ---------------------------------------------------------------------------
-- 5. TICKETS  (partitioned parent — PG16 propagates to child partitions)
-- ---------------------------------------------------------------------------
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tickets;
CREATE POLICY tenant_isolation ON tickets
  USING      (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Portal org restriction: portal principal can only see tickets whose
-- organization_id is in their allowed org list. Evaluated as RESTRICTIVE
-- so it narrows the tenant_isolation permissive policy.
DROP POLICY IF EXISTS portal_org_restriction ON tickets;
CREATE POLICY portal_org_restriction ON tickets
  AS RESTRICTIVE FOR SELECT
  USING (
    current_setting('app.principal_kind', true) IS DISTINCT FROM 'portal'
    OR organization_id = ANY(app_current_org_ids())
  );

-- ---------------------------------------------------------------------------
-- 6. TICKET_COMMENTS  (partitioned parent)
-- ---------------------------------------------------------------------------
ALTER TABLE ticket_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_comments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ticket_comments;
CREATE POLICY tenant_isolation ON ticket_comments
  USING      (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Portal comment restriction: portal principal can only see 'public' comments.
DROP POLICY IF EXISTS portal_comment_restriction ON ticket_comments;
CREATE POLICY portal_comment_restriction ON ticket_comments
  AS RESTRICTIVE FOR SELECT
  USING (
    current_setting('app.principal_kind', true) IS DISTINCT FROM 'portal'
    OR visibility = 'public'
  );

-- ---------------------------------------------------------------------------
-- 7. AUDIT_LOGS  (partitioned parent; append-only)
-- ---------------------------------------------------------------------------
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON audit_logs;
-- Audit logs: SELECT only for portal principals (no portal restriction needed
-- as portal users don't have access to audit logs in the grant matrix).
CREATE POLICY tenant_isolation ON audit_logs
  USING      (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ---------------------------------------------------------------------------
-- 8. OUTBOX_EVENTS
-- ---------------------------------------------------------------------------
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON outbox_events;
CREATE POLICY tenant_isolation ON outbox_events
  USING      (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

COMMIT;
