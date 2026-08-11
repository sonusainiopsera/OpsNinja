-- Migration: 0004_agent_org_scopes
-- Adds agent_org_scopes table for per-agent organization access control.
-- The scope_version column mirrors the Redis atomic counter so cold-start
-- token validation can seed from the persisted value.

CREATE TABLE IF NOT EXISTS agent_org_scopes (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id),
  user_id        UUID        NOT NULL REFERENCES users(id),
  organization_id UUID       NOT NULL REFERENCES organizations(id),
  access_level   TEXT        NOT NULL DEFAULT 'full',
  scope_version  INTEGER     NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_org_scopes_tenant_user_org_uniq
    UNIQUE (tenant_id, user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS agent_org_scopes_tenant_user_idx
  ON agent_org_scopes (tenant_id, user_id);

-- Enable RLS so the app.current_tenant session variable confines queries.
ALTER TABLE agent_org_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_org_scopes FORCE ROW LEVEL SECURITY;

CREATE POLICY agent_org_scopes_tenant_isolation ON agent_org_scopes
  USING (tenant_id::text = current_setting('app.current_tenant', true));
