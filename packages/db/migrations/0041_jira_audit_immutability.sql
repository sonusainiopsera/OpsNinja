-- Migration 0041: Jira audit trail immutability and correlation threading (WO-059)
--
-- Changes:
--   1. Add correlation_id to outbox_events, ticket_jira_links, jira_webhook_events
--      so the full escalate → outbound → webhook → inbound chain can be traced.
--   2. Append-only guard trigger on audit_logs — UPDATE and DELETE raise an
--      exception at the database level (language-level trigger, not application code).
--   3. REVOKE UPDATE, DELETE on audit_logs from the application role (opsninja_app).
--   4. Index: audit_logs (tenant_id, resource_type, created_at DESC) for the
--      Jira-scoped audit query endpoint on the read replica.

-- ---------------------------------------------------------------------------
-- 1. correlation_id columns
-- ---------------------------------------------------------------------------

ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS correlation_id  TEXT;

ALTER TABLE ticket_jira_links
  ADD COLUMN IF NOT EXISTS correlation_id  TEXT;

ALTER TABLE jira_webhook_events
  ADD COLUMN IF NOT EXISTS correlation_id  TEXT;

-- Sparse index for trace-join queries.
CREATE INDEX IF NOT EXISTS ticket_jira_links_correlation_idx
  ON ticket_jira_links (tenant_id, correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS jira_webhook_events_correlation_idx
  ON jira_webhook_events (tenant_id, correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS outbox_events_correlation_idx
  ON outbox_events (tenant_id, correlation_id)
  WHERE correlation_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Append-only guard on audit_logs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION audit_logs_immutability_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'audit_logs is append-only: % operations are not permitted (WO-059). id=%',
    TG_OP,
    COALESCE(OLD.id::TEXT, '');
END;
$$;

CREATE OR REPLACE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutability_guard();

CREATE OR REPLACE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutability_guard();

-- ---------------------------------------------------------------------------
-- 3. Revoke mutating privileges from the application role
--    opsninja_app is the NOSUPERUSER NOBYPASSRLS application role.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'opsninja_app') THEN
    REVOKE UPDATE, DELETE ON audit_logs FROM opsninja_app;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Index supporting the Jira-scoped audit query endpoint
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS audit_logs_jira_resource_idx
  ON audit_logs (tenant_id, resource_type, created_at DESC)
  WHERE resource_type IN (
    'jira_connection',
    'jira_project_mapping',
    'ticket_jira_link',
    'jira_dlq_item',
    'jira_reconciliation_run'
  );
