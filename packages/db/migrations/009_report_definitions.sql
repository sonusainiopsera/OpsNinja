-- Migration 009: Report definitions and export jobs
-- Expand-only: no destructive DDL.

-- ── Enums ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE report_chart_type AS ENUM (
    'table', 'bar', 'line', 'pie', 'area', 'heatmap'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE report_sharing_scope AS ENUM (
    'private', 'team', 'tenant'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE export_job_format AS ENUM ('csv', 'xlsx', 'pdf');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE export_job_status AS ENUM (
    'pending', 'processing', 'completed', 'failed', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── report_definitions ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS report_definitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  metrics         JSONB NOT NULL DEFAULT '[]',
  group_by        JSONB NOT NULL DEFAULT '[]',
  filter_ast      JSONB,
  chart_type      report_chart_type NOT NULL DEFAULT 'table',
  sharing_scope   report_sharing_scope NOT NULL DEFAULT 'private',
  schedule        JSONB,
  created_by      UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- tenant_id leading on all indexes (isolation harness requirement)
CREATE INDEX IF NOT EXISTS report_definitions_tenant_idx
  ON report_definitions (tenant_id, deleted_at);

CREATE INDEX IF NOT EXISTS report_definitions_tenant_scope_idx
  ON report_definitions (tenant_id, sharing_scope);

CREATE INDEX IF NOT EXISTS report_definitions_tenant_created_by_idx
  ON report_definitions (tenant_id, created_by);

-- ── Row-Level Security: report_definitions ────────────────────────────────────

ALTER TABLE report_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_definitions FORCE ROW LEVEL SECURITY;

CREATE POLICY report_definitions_tenant_isolation
  ON report_definitions
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ── export_jobs ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS export_jobs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  report_definition_id  UUID REFERENCES report_definitions(id) ON DELETE SET NULL,
  requested_by          UUID NOT NULL,
  format                export_job_format NOT NULL,
  status                export_job_status NOT NULL DEFAULT 'pending',
  s3_key                TEXT,
  row_count             INTEGER,
  byte_size             BIGINT,
  error_code            TEXT,
  expires_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ
);

-- tenant_id leading on all indexes
CREATE INDEX IF NOT EXISTS export_jobs_tenant_status_idx
  ON export_jobs (tenant_id, status);

CREATE INDEX IF NOT EXISTS export_jobs_tenant_expires_idx
  ON export_jobs (tenant_id, expires_at);

CREATE INDEX IF NOT EXISTS export_jobs_tenant_requested_by_idx
  ON export_jobs (tenant_id, requested_by, created_at DESC);

-- ── Row-Level Security: export_jobs ──────────────────────────────────────────

ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY export_jobs_tenant_isolation
  ON export_jobs
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
