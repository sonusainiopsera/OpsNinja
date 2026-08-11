-- Migration 008: Jira connections
-- Expand-only: no destructive DDL.

-- ── Enums ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE jira_auth_method AS ENUM ('oauth3lo', 'api_token');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE jira_connection_state AS ENUM ('pending', 'active', 'degraded', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── jira_connections ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS jira_connections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  site_url        TEXT NOT NULL,
  cloud_id        TEXT NOT NULL,
  auth_method     jira_auth_method NOT NULL,
  scopes          TEXT[] NOT NULL DEFAULT '{}',
  secret_ref      TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  state           jira_connection_state NOT NULL DEFAULT 'pending',
  last_tested_at  TIMESTAMPTZ,
  created_by      UUID NOT NULL,
  updated_by      UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Leading tenant_id index (satisfies isolation harness)
CREATE INDEX IF NOT EXISTS jira_connections_tenant_idx
  ON jira_connections (tenant_id);

-- Per-tenant unique cloud_id (same Jira site cannot appear twice under the same tenant)
CREATE UNIQUE INDEX IF NOT EXISTS jira_connections_tenant_cloud_id_uidx
  ON jira_connections (tenant_id, cloud_id);

-- Global unique cloud_id — blocks cross-tenant binding of the same Jira site
CREATE UNIQUE INDEX IF NOT EXISTS jira_connections_global_cloud_id_uidx
  ON jira_connections (cloud_id);

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE jira_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE jira_connections FORCE ROW LEVEL SECURITY;

CREATE POLICY jira_connections_tenant_isolation
  ON jira_connections
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
