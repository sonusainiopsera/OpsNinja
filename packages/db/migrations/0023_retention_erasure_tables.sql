-- Migration 0023: retention_job_runs and erasure_receipts tables.
--
-- retention_job_runs: per-run observability record for the nightly purge job.
-- erasure_receipts:   immutable audit record of completed GDPR erasure operations.
--
-- Both tables follow the platform audit retention policy (Object Lock / longer
-- retention than domain tables) and are explicitly excluded from the purge job.

CREATE TABLE IF NOT EXISTS retention_job_runs (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_name     TEXT        NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  outcome      TEXT        NOT NULL DEFAULT 'running', -- 'running' | 'success' | 'failure' | 'partial'
  summary      JSONB       NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS retention_job_runs_name_started_idx
  ON retention_job_runs (job_name, started_at DESC);

-- erasure_receipts is tenant-scoped so Support Administrators can retrieve it.
CREATE TABLE IF NOT EXISTS erasure_receipts (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   UUID        NOT NULL,
  request_id  UUID        NOT NULL,
  subject_ref TEXT        NOT NULL,  -- opaque reference (contact id or user id)
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  entries     JSONB       NOT NULL DEFAULT '[]',  -- [ { table, rowsAffected, strategy } ]
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ENABLE ROW LEVEL SECURITY ON erasure_receipts;
CREATE POLICY erasure_receipts_tenant_isolation ON erasure_receipts
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE UNIQUE INDEX IF NOT EXISTS erasure_receipts_request_id_uniq
  ON erasure_receipts (tenant_id, request_id);

CREATE INDEX IF NOT EXISTS erasure_receipts_tenant_subject_idx
  ON erasure_receipts (tenant_id, subject_ref, completed_at DESC);
