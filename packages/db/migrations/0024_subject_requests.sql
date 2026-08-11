-- WO-096: Subject requests table for GDPR data-subject rights (access, portability,
-- rectification, erasure). Unique partial index coalesces duplicate in-flight
-- requests for the same subject/type so only one active job exists at a time.

CREATE TABLE IF NOT EXISTS subject_requests (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL,
  type            TEXT        NOT NULL CHECK (type IN ('access', 'portability', 'rectification', 'erasure')),
  subject_type    TEXT        NOT NULL,
  subject_id      TEXT        NOT NULL,
  requested_by    UUID        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'queued'
                              CHECK (status IN ('queued', 'running', 'deferred', 'completed', 'failed')),
  deferral_reason TEXT,
  artifact_s3_key TEXT,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tenant-leading index for list queries scoped by tenant.
CREATE INDEX IF NOT EXISTS subject_requests_tenant_idx
  ON subject_requests (tenant_id, created_at DESC);

-- Fast lookup by subject identity.
CREATE INDEX IF NOT EXISTS subject_requests_tenant_subject_idx
  ON subject_requests (tenant_id, subject_type, subject_id, created_at DESC);

-- Coalesce duplicate in-flight requests: only one queued/running request
-- per (tenant, type, subject_id) is allowed.
CREATE UNIQUE INDEX IF NOT EXISTS subject_requests_inflight_uniq
  ON subject_requests (tenant_id, type, subject_id)
  WHERE status IN ('queued', 'running');

ENABLE ROW LEVEL SECURITY ON subject_requests;
ALTER TABLE subject_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY subject_requests_tenant_isolation ON subject_requests
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
  );
