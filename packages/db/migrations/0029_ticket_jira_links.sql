-- WO-053: Ticket Jira Links — durable association between OpsNinja tickets
-- and Jira issues, with async creation via the transactional outbox.

CREATE TABLE IF NOT EXISTS ticket_jira_links (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  ticket_id        uuid        NOT NULL,
  connection_id    uuid        NOT NULL,
  mapping_id       uuid        NOT NULL,
  project_key      text        NOT NULL,
  jira_issue_id    text,
  jira_issue_key   text,
  jira_issue_url   text,
  jira_status      text,
  jira_assignee    text,
  link_state       text        NOT NULL DEFAULT 'pending'
                               CHECK (link_state IN ('pending','linked','failed','unlinked')),
  mode             text        NOT NULL DEFAULT 'create'
                               CHECK (mode IN ('create','link_existing')),
  last_synced_at   timestamptz,
  error_code       text,
  error_message    text,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ticket_jira_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_jira_links FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON ticket_jira_links
  USING (tenant_id::text = current_setting('app.current_tenant', true));

-- Tenant + ticket index (primary query path: GET /tickets/:id/jira-links).
CREATE INDEX IF NOT EXISTS ticket_jira_links_tenant_ticket_idx
  ON ticket_jira_links (tenant_id, ticket_id);

-- Tenant + jira issue id (used by sync worker upsert).
CREATE INDEX IF NOT EXISTS ticket_jira_links_tenant_issue_idx
  ON ticket_jira_links (tenant_id, jira_issue_id);

-- Unique active link: only one pending or linked row per (tenant, ticket, project).
-- 'failed' and 'unlinked' states are excluded so re-escalation works after failure.
CREATE UNIQUE INDEX IF NOT EXISTS ticket_jira_links_unique_active
  ON ticket_jira_links (tenant_id, ticket_id, project_key)
  WHERE link_state IN ('pending','linked');
