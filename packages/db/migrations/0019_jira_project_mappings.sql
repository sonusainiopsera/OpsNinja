-- Migration: 0019_jira_project_mappings
-- WO-052: Jira Project Scoping and Field Mapping Configuration
--
-- Creates jira_project_mappings with:
--   - tenant_id-leading composite indexes
--   - JSONB columns for field_map, status_map, sync_rules
--   - GIN index on field_map for future querying
--   - Unique partial index enforcing one is_default per connection
--   - ENABLE FORCE ROW LEVEL SECURITY + tenant isolation policy

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS jira_project_mappings (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL,
  connection_id         UUID        NOT NULL REFERENCES jira_connections(id) ON DELETE CASCADE,
  project_key           TEXT        NOT NULL,
  project_id            TEXT        NOT NULL,
  default_issue_type_id TEXT        NOT NULL,
  field_map             JSONB       NOT NULL DEFAULT '[]'::jsonb,
  status_map            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  sync_rules            JSONB       NOT NULL DEFAULT '{
    "applyInboundStatus": true,
    "applyInboundComments": true,
    "autoResolveOnJiraDone": false,
    "commentVisibility": "internal"
  }'::jsonb,
  is_default            BOOLEAN     NOT NULL DEFAULT false,
  enabled               BOOLEAN     NOT NULL DEFAULT true,
  created_by            UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS jira_project_mappings_tenant_id_idx
  ON jira_project_mappings (tenant_id);

CREATE INDEX IF NOT EXISTS jira_project_mappings_connection_id_idx
  ON jira_project_mappings (connection_id);

CREATE INDEX IF NOT EXISTS jira_project_mappings_tenant_connection_idx
  ON jira_project_mappings (tenant_id, connection_id);

-- GIN index on field_map for future JSONB querying
CREATE INDEX IF NOT EXISTS jira_project_mappings_field_map_gin_idx
  ON jira_project_mappings USING GIN (field_map);

-- Exactly one default mapping per connection (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS jira_project_mappings_unique_default_idx
  ON jira_project_mappings (connection_id)
  WHERE (is_default = true);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE jira_project_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE jira_project_mappings FORCE ROW LEVEL SECURITY;

-- Tenant isolation: only rows whose tenant_id matches the session variable
-- are visible or mutable. The ::uuid cast on an empty string throws, giving
-- fail-closed behaviour when app.current_tenant is not set.
CREATE POLICY tenant_isolation_select ON jira_project_mappings
  FOR SELECT
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_insert ON jira_project_mappings
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_update ON jira_project_mappings
  FOR UPDATE
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_delete ON jira_project_mappings
  FOR DELETE
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
