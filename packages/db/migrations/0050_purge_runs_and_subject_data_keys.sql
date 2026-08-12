-- Migration 0050: purge_runs and subject_data_keys tables.
--
-- purge_runs: append-only immutable ledger of every purge action.
--   A block-mutation trigger prevents UPDATE and DELETE so the ledger cannot be
--   altered after insertion (mirrors the audit_logs immutability pattern).
--
-- subject_data_keys: per-subject wrapped data encryption keys.
--   Destroying this row (setting destroyed_at) makes all ciphertext encrypted
--   with the DEK permanently unrecoverable — the crypto-shred mechanism.

-- ─── purge_runs ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS purge_runs (
  id                UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  -- NULL tenant_id = cross-tenant platform run.
  tenant_id         UUID,
  category          TEXT        NOT NULL,
  horizon_at        TIMESTAMPTZ NOT NULL,
  partitions_dropped TEXT[]     NOT NULL DEFAULT '{}',
  rows_deleted      BIGINT      NOT NULL DEFAULT 0,
  keys_destroyed    INT         NOT NULL DEFAULT 0,
  -- 'dry_run' or 'enforce'
  mode              TEXT        NOT NULL DEFAULT 'dry_run',
  -- 'running', 'success', 'partial', 'failure'
  outcome           TEXT        NOT NULL DEFAULT 'running',
  error_summary     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT purge_runs_mode_valid    CHECK (mode IN ('dry_run', 'enforce')),
  CONSTRAINT purge_runs_outcome_valid CHECK (outcome IN ('running', 'success', 'partial', 'failure'))
);

-- The platform operator role can read all rows (cross-tenant maintenance).
-- Normal tenant sessions see only their own rows.
ALTER TABLE purge_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE purge_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY purge_runs_tenant_isolation ON purge_runs
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.current_tenant', true)::uuid
  );

-- Append-only: block UPDATE and DELETE so the ledger is immutable.
CREATE OR REPLACE FUNCTION purge_runs_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'purge_runs is append-only: mutations are not permitted'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER purge_runs_no_update
  BEFORE UPDATE ON purge_runs
  FOR EACH ROW EXECUTE FUNCTION purge_runs_block_mutation();

CREATE TRIGGER purge_runs_no_delete
  BEFORE DELETE ON purge_runs
  FOR EACH ROW EXECUTE FUNCTION purge_runs_block_mutation();

CREATE INDEX IF NOT EXISTS purge_runs_tenant_category_idx
  ON purge_runs (tenant_id, category, started_at DESC);

CREATE INDEX IF NOT EXISTS purge_runs_category_started_idx
  ON purge_runs (category, started_at DESC);

-- ─── subject_data_keys ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subject_data_keys (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID        NOT NULL,
  subject_type    TEXT        NOT NULL,  -- e.g. 'contact', 'portal_user'
  subject_id      UUID        NOT NULL,
  -- ARN of the KMS key used to wrap the DEK (for auditing key material deletion).
  kms_key_arn     TEXT,
  -- Base64-encoded wrapped (envelope-encrypted) DEK ciphertext.
  wrapped_dek     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Non-NULL when the DEK has been destroyed; ciphertext is unrecoverable after this.
  destroyed_at    TIMESTAMPTZ,
  -- Request that triggered the destruction.
  erasure_request_id UUID
);

ALTER TABLE subject_data_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_data_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY subject_data_keys_tenant_isolation ON subject_data_keys
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE UNIQUE INDEX IF NOT EXISTS subject_data_keys_subject_uniq
  ON subject_data_keys (tenant_id, subject_type, subject_id);

CREATE INDEX IF NOT EXISTS subject_data_keys_tenant_idx
  ON subject_data_keys (tenant_id, destroyed_at NULLS FIRST);
