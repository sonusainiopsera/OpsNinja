-- Migration: 0009_report_definitions
-- Creates report_definitions and export_jobs tables — WO-073.
--
-- Security design:
--   - RLS policies use ::uuid cast on app.current_tenant so an empty string
--     raises an error (fail-closed behaviour).
--   - tenant_id leads every index to ensure optimal per-tenant query plans.
--   - export_jobs.report_definition_id FK is ON DELETE SET NULL so job history
--     survives definition deletion.
--
-- Expand-only migration: additive DDL only, no destructive statements.

-- ==========================================================================
-- 1. report_definitions
-- ==========================================================================

CREATE TABLE IF NOT EXISTS report_definitions (
  id             UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL,
  name           TEXT        NOT NULL,
  description    TEXT,
  metrics        JSONB       NOT NULL DEFAULT '[]',
  group_by       JSONB       NOT NULL DEFAULT '[]',
  filter_ast     JSONB,
  chart_type     TEXT,
  sharing_scope  TEXT        NOT NULL DEFAULT 'private',
  schedule       JSONB,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ,
  PRIMARY KEY (id),
  CONSTRAINT report_definitions_sharing_scope_check
    CHECK (sharing_scope IN ('private', 'shared', 'system'))
);

-- tenant_id-leading indexes.
CREATE INDEX IF NOT EXISTS report_definitions_tenant_deleted_idx
  ON report_definitions (tenant_id, deleted_at);

CREATE INDEX IF NOT EXISTS report_definitions_tenant_scope_idx
  ON report_definitions (tenant_id, sharing_scope);

CREATE INDEX IF NOT EXISTS report_definitions_tenant_created_by_idx
  ON report_definitions (tenant_id, created_by);

-- ==========================================================================
-- RLS for report_definitions
-- ==========================================================================

ALTER TABLE report_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_definitions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_report_definitions ON report_definitions;
CREATE POLICY tenant_isolation_report_definitions ON report_definitions
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ==========================================================================
-- 2. export_jobs
-- ==========================================================================

CREATE TABLE IF NOT EXISTS export_jobs (
  id                   UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id            UUID        NOT NULL,
  report_definition_id UUID,
  requested_by         UUID        NOT NULL,
  format               TEXT        NOT NULL,
  status               TEXT        NOT NULL DEFAULT 'pending',
  s3_key               TEXT,
  row_count            INTEGER,
  byte_size            INTEGER,
  error_code           TEXT,
  expires_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at         TIMESTAMPTZ,
  PRIMARY KEY (id),
  CONSTRAINT export_jobs_format_check
    CHECK (format IN ('csv', 'xlsx', 'pdf')),
  CONSTRAINT export_jobs_status_check
    CHECK (status IN ('pending', 'running', 'complete', 'failed', 'expired')),
  CONSTRAINT export_jobs_report_definition_fk
    FOREIGN KEY (report_definition_id)
    REFERENCES report_definitions (id)
    ON DELETE SET NULL
);

-- tenant_id-leading indexes.
CREATE INDEX IF NOT EXISTS export_jobs_tenant_status_idx
  ON export_jobs (tenant_id, status);

CREATE INDEX IF NOT EXISTS export_jobs_tenant_expires_idx
  ON export_jobs (tenant_id, expires_at);

CREATE INDEX IF NOT EXISTS export_jobs_tenant_requested_by_idx
  ON export_jobs (tenant_id, requested_by, created_at DESC);

-- ==========================================================================
-- RLS for export_jobs
-- ==========================================================================

ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_jobs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_export_jobs ON export_jobs;
CREATE POLICY tenant_isolation_export_jobs ON export_jobs
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
