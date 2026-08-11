-- WO-056: Outbound Jira Sync Resilience — DLQ table and link observability columns.

-- ---------------------------------------------------------------------------
-- jira_sync_dlq — dead-letter projection for exhausted outbound sync items
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS jira_sync_dlq (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  link_id           uuid        NOT NULL,
  ticket_id         uuid        NOT NULL,
  connection_id     uuid        NOT NULL,
  event_type        text        NOT NULL,
  original_payload  jsonb       NOT NULL DEFAULT '{}',
  attempts          integer     NOT NULL DEFAULT 0,
  last_error_code   text,
  last_error_message text,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_attempt_at   timestamptz,
  replayed_at       timestamptz,
  replayed_by       uuid
);

ALTER TABLE jira_sync_dlq ENABLE ROW LEVEL SECURITY;
ALTER TABLE jira_sync_dlq FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON jira_sync_dlq
  USING (tenant_id::text = current_setting('app.current_tenant', true));

CREATE INDEX IF NOT EXISTS jira_sync_dlq_tenant_idx
  ON jira_sync_dlq (tenant_id, first_seen_at DESC);

CREATE INDEX IF NOT EXISTS jira_sync_dlq_link_idx
  ON jira_sync_dlq (tenant_id, link_id);

-- ---------------------------------------------------------------------------
-- ticket_jira_links: operator observability columns
-- ---------------------------------------------------------------------------

ALTER TABLE ticket_jira_links
  ADD COLUMN IF NOT EXISTS attempts       integer  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
