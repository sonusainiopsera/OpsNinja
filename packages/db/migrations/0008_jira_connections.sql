-- Migration: 0008_jira_connections
-- Creates the jira_connections tenant-scoped table — WO-051.
--
-- Security design:
--   - secret_ref holds only an opaque reference to AWS Secrets Manager.
--     The raw credential never appears in this table.
--   - RLS policies use ::uuid cast on app.current_tenant so an empty string
--     raises an error (fail-closed behaviour).
--   - Global unique partial index on cloud_id prevents the same Jira Cloud
--     site from being bound to two tenants simultaneously.
--
-- Expand-only migration: additive DDL only, no destructive statements.

CREATE TABLE IF NOT EXISTS jira_connections (
  id               UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL,
  site_url         TEXT        NOT NULL,
  cloud_id         TEXT,
  auth_method      TEXT        NOT NULL DEFAULT 'oauth3lo',
  scopes           TEXT[]      NOT NULL DEFAULT '{}',
  secret_ref       TEXT,
  token_expires_at TIMESTAMPTZ,
  state            TEXT        NOT NULL DEFAULT 'pending',
  last_tested_at   TIMESTAMPTZ,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT jira_connections_auth_method_check
    CHECK (auth_method IN ('oauth3lo', 'api_token')),
  CONSTRAINT jira_connections_state_check
    CHECK (state IN ('pending', 'active', 'degraded', 'revoked'))
);

-- Tenant-leading index for all per-tenant queries.
CREATE INDEX IF NOT EXISTS jira_connections_tenant_id_idx
  ON jira_connections (tenant_id);

-- Per-tenant uniqueness: only one active connection per (tenant, cloud_id).
-- Partial: excludes revoked connections so a tenant can reconnect after revoking.
CREATE UNIQUE INDEX IF NOT EXISTS jira_connections_tenant_cloud_uniq
  ON jira_connections (tenant_id, cloud_id)
  WHERE cloud_id IS NOT NULL AND state != 'revoked';

-- Global uniqueness: prevents the same Jira Cloud site from being attached
-- to multiple tenants simultaneously. A unique constraint violation here
-- surfaces as JIRA_SITE_ALREADY_BOUND.
-- Note: global unique constraints work even under RLS because PostgreSQL
-- evaluates uniqueness against all rows, not just those visible to the session.
CREATE UNIQUE INDEX IF NOT EXISTS jira_connections_cloud_id_global_uniq
  ON jira_connections (cloud_id)
  WHERE cloud_id IS NOT NULL AND state != 'revoked';

-- ==========================================================================
-- Row-Level Security
-- ==========================================================================

ALTER TABLE jira_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE jira_connections FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_jira_connections ON jira_connections;
CREATE POLICY tenant_isolation_jira_connections ON jira_connections
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
