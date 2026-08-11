-- WO-057: Hourly Jira Link Reconciliation — schema additions.

-- ---------------------------------------------------------------------------
-- jira_connections: reconciliation watermark and configurable lookback
-- ---------------------------------------------------------------------------

ALTER TABLE jira_connections
  ADD COLUMN IF NOT EXISTS reconciliation_watermark  timestamptz,
  ADD COLUMN IF NOT EXISTS reconcile_lookback_hours  smallint NOT NULL DEFAULT 2;

-- ---------------------------------------------------------------------------
-- jira_reconciliation_runs — observability record per connection run
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS jira_reconciliation_runs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  connection_id       uuid        NOT NULL,
  window_start        timestamptz NOT NULL,
  window_end          timestamptz NOT NULL,
  issues_scanned      integer     NOT NULL DEFAULT 0,
  drift_detected      integer     NOT NULL DEFAULT 0,
  events_synthesised  integer     NOT NULL DEFAULT 0,
  pending_repaired    integer     NOT NULL DEFAULT 0,
  orphans_found       integer     NOT NULL DEFAULT 0,
  duration_ms         integer,
  -- 'running' | 'completed' | 'truncated' | 'rate_limited' | 'failed' | 'skipped'
  outcome             text        NOT NULL DEFAULT 'running',
  error               text,
  watermark           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE jira_reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE jira_reconciliation_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON jira_reconciliation_runs
  USING (tenant_id::text = current_setting('app.current_tenant', true));

-- Operator: list recent runs per connection
CREATE INDEX IF NOT EXISTS jira_recon_runs_connection_idx
  ON jira_reconciliation_runs (tenant_id, connection_id, created_at DESC);

-- Scheduler: find running (potentially stuck) runs
CREATE INDEX IF NOT EXISTS jira_recon_runs_outcome_idx
  ON jira_reconciliation_runs (tenant_id, outcome, created_at DESC)
  WHERE outcome = 'running';
