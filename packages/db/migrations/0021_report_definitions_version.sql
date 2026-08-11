-- Migration: 0021_report_definitions_version
-- WO-074: Report Run Preview API and Saved Definition Sharing
--
-- Adds version (optimistic-concurrency counter) to report_definitions.
-- Adds keyset cursor index on (created_at, id) for efficient pagination.

ALTER TABLE report_definitions
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Keyset index for cursor-paginated listing: ordered by (created_at, id)
CREATE INDEX IF NOT EXISTS report_definitions_keyset_idx
  ON report_definitions (tenant_id, created_at, id)
  WHERE deleted_at IS NULL;
