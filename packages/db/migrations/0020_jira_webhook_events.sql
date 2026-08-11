-- Migration: 0020_jira_webhook_events
-- WO-054: Signed Jira Webhook Receiver with Idempotent Ingest
--
-- 1. Extends jira_connections with webhook_secret_ref and webhook_secret_rotated_at.
-- 2. Creates jira_webhook_events with unique (tenant_id, jira_event_id) for
--    idempotent ingest and a partial index on processing_state for DLQ/replay queries.
-- 3. Enables FORCE ROW LEVEL SECURITY on jira_webhook_events with tenant isolation policy.

-- ---------------------------------------------------------------------------
-- Extend jira_connections
-- ---------------------------------------------------------------------------

ALTER TABLE jira_connections
  ADD COLUMN IF NOT EXISTS webhook_secret_ref         TEXT,
  ADD COLUMN IF NOT EXISTS webhook_secret_rotated_at  TIMESTAMPTZ;

-- Unique index so cloudId lookups are O(1) (also enforces one site per tenant).
-- Use CREATE UNIQUE INDEX … IF NOT EXISTS to be re-runnable.
CREATE UNIQUE INDEX IF NOT EXISTS jira_connections_cloud_id_uniq
  ON jira_connections (cloud_id)
  WHERE cloud_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- jira_webhook_events
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS jira_webhook_events (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID        NOT NULL,
  jira_event_id      TEXT        NOT NULL,
  event_type         TEXT        NOT NULL,
  jira_issue_id      TEXT,
  jira_issue_key     TEXT,
  payload            JSONB       NOT NULL,
  signature_verified BOOLEAN     NOT NULL DEFAULT false,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  processing_state   TEXT        NOT NULL DEFAULT 'pending',
  attempts           INTEGER     NOT NULL DEFAULT 0,
  last_error         TEXT
);

-- Idempotency: duplicate (tenant_id, jira_event_id) returns a conflict that
-- the receiver catches and converts to a 200 dedupe response.
CREATE UNIQUE INDEX IF NOT EXISTS jira_webhook_events_tenant_event_uniq
  ON jira_webhook_events (tenant_id, jira_event_id);

-- Fast lookup for tenant-scoped event history.
CREATE INDEX IF NOT EXISTS jira_webhook_events_tenant_id_idx
  ON jira_webhook_events (tenant_id);

-- DLQ / replay view: find events still requiring processing.
CREATE INDEX IF NOT EXISTS jira_webhook_events_pending_idx
  ON jira_webhook_events (received_at)
  WHERE processing_state IN ('pending', 'failed');

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE jira_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE jira_webhook_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON jira_webhook_events
  FOR SELECT
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_insert ON jira_webhook_events
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_update ON jira_webhook_events
  FOR UPDATE
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Purge job exclusion: a nightly DELETE by the maintenance role (no RLS binding)
-- still runs because FORCE RLS only applies to non-superuser/non-bypassrls roles.
-- The maintenance role is granted BYPASSRLS so it can run the 7-day TTL purge.
