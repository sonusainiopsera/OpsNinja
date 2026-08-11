-- WO-055: Inbound Jira Sync — schema changes for comment mirroring,
-- link metadata and loop-prevention.

-- ---------------------------------------------------------------------------
-- ticket_comments: idempotent comment mirroring via external_ref
-- ---------------------------------------------------------------------------

ALTER TABLE ticket_comments
  ADD COLUMN IF NOT EXISTS external_ref    text,
  ADD COLUMN IF NOT EXISTS external_source text;

-- Unique constraint: one mirrored comment per (tenant, source, external id).
-- Only enforced for rows where both columns are non-null (regular agent
-- comments have no external_ref, so this index is always partial).
CREATE UNIQUE INDEX IF NOT EXISTS ticket_comments_external_ref_uniq
  ON ticket_comments (tenant_id, external_source, external_ref)
  WHERE external_ref IS NOT NULL AND external_source IS NOT NULL;

-- ---------------------------------------------------------------------------
-- ticket_jira_links: ordering / orphan tracking
-- ---------------------------------------------------------------------------

-- jira_updated_at: the issue.fields.updated value from the most-recently
-- processed event, used for out-of-order event detection.
ALTER TABLE ticket_jira_links
  ADD COLUMN IF NOT EXISTS jira_updated_at timestamptz;

-- orphaned: set to true when jira:issue_deleted arrives so the worker
-- skips further inbound processing for this link.
ALTER TABLE ticket_jira_links
  ADD COLUMN IF NOT EXISTS orphaned boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- jira_connections: integration principal for loop detection
-- ---------------------------------------------------------------------------

-- integration_account_id: the Jira account ID (e.g. 5e8c...a3f2) that
-- the OAuth service account uses.  The inbound worker skips events whose
-- Jira author matches this ID to break the feedback loop.
ALTER TABLE jira_connections
  ADD COLUMN IF NOT EXISTS integration_account_id text;
