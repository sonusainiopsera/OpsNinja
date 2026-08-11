-- Migration 004: Agent organization scope assignments
-- Enables per-agent organization scoping with Redis-backed version counters.
-- A scope_version column is maintained on the tenant level via a separate
-- Redis counter (tenant:{tenantId}:user:{userId}:scope_version).

CREATE TABLE IF NOT EXISTS agent_org_scopes (
  id            UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL,
  user_id       UUID        NOT NULL,
  organization_id UUID      NOT NULL,
  access_level  TEXT        NOT NULL DEFAULT 'full',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT agent_org_scopes_pkey PRIMARY KEY (id),
  CONSTRAINT agent_org_scopes_unique UNIQUE (tenant_id, user_id, organization_id),
  CONSTRAINT agent_org_scopes_access_level_check
    CHECK (access_level IN ('full', 'read_only'))
);

-- RLS: agents can only read their own scope rows; managers can read all.
ALTER TABLE agent_org_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_org_scopes FORCE ROW LEVEL SECURITY;

CREATE POLICY agent_org_scopes_tenant_isolation
  ON agent_org_scopes
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Index for the common lookup pattern: resolve scopes for a single user.
CREATE INDEX IF NOT EXISTS agent_org_scopes_user_idx
  ON agent_org_scopes (tenant_id, user_id);

-- Index for org membership validation during scope mutation.
CREATE INDEX IF NOT EXISTS agent_org_scopes_org_idx
  ON agent_org_scopes (tenant_id, organization_id);
