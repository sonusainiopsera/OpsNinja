-- =============================================================================
-- WO-092: Audit Log Enrichment
-- Description:
--   1. Adds hash-chain columns, actor enrichment, IP hash and payload columns
--      to the existing audit_logs table (expand-only; all new columns nullable).
--   2. Adds the two remaining required composite indexes.
--   3. Creates the audit_logs_block_mutation() trigger function and attaches
--      it BEFORE UPDATE OR DELETE on the parent and existing partitions.
--   4. Creates ensure_audit_partitions(months_ahead) which idempotently creates
--      monthly partitions, attaches the trigger to each, and warns if the
--      current-month partition is missing.
--
-- Backward-compatible expand-and-contract discipline:
--   No column drops, no renames, no destructive DDL.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ADD MISSING COLUMNS TO audit_logs
-- ---------------------------------------------------------------------------

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS actor_display  text,
  ADD COLUMN IF NOT EXISTS actor_role     text,
  ADD COLUMN IF NOT EXISTS source         text,
  ADD COLUMN IF NOT EXISTS request_id     text,
  ADD COLUMN IF NOT EXISTS ip_hash        text,
  ADD COLUMN IF NOT EXISTS user_agent     text,
  ADD COLUMN IF NOT EXISTS changed_fields text[],
  ADD COLUMN IF NOT EXISTS hash_prev      bytea,
  ADD COLUMN IF NOT EXISTS hash_self      bytea;

COMMENT ON COLUMN audit_logs.actor_display  IS 'Display name of the actor; never a raw email address.';
COMMENT ON COLUMN audit_logs.actor_role     IS 'Role of the actor at time of action (e.g. support_admin).';
COMMENT ON COLUMN audit_logs.source         IS 'Origin of the event: api | webhook | worker | system.';
COMMENT ON COLUMN audit_logs.request_id     IS 'HTTP request correlation ID from X-Request-Id header.';
COMMENT ON COLUMN audit_logs.ip_hash        IS 'Salted SHA-256 of the client IP for forensics without PII.';
COMMENT ON COLUMN audit_logs.user_agent     IS 'HTTP User-Agent header value.';
COMMENT ON COLUMN audit_logs.changed_fields IS 'Array of field names that changed in an update event.';
COMMENT ON COLUMN audit_logs.hash_prev      IS 'SHA-256 hash of the immediately preceding record for this tenant.';
COMMENT ON COLUMN audit_logs.hash_self      IS 'SHA-256(hash_prev || canonical_json(record)) for this record.';

-- ---------------------------------------------------------------------------
-- 2. ADD MISSING COMPOSITE INDEXES
-- ---------------------------------------------------------------------------

-- Resource lookup: supports 90-day single-resource audit history queries.
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource
  ON audit_logs (tenant_id, resource_type, resource_id, occurred_at DESC);

-- Actor lookup: supports per-user activity timeline queries.
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
  ON audit_logs (tenant_id, actor_id, occurred_at DESC)
  WHERE actor_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. APPEND-ONLY GUARD TRIGGER FUNCTION
--
--    Installed as BEFORE UPDATE OR DELETE. Even roles that nominally hold
--    UPDATE/DELETE grants (e.g. a compromised admin account) cannot mutate
--    audit rows. The error code RESTRICT_VIOLATION maps to SQLSTATE 23001,
--    which is surfaced by the application as AUDIT_APPEND_ONLY_VIOLATION.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_logs_block_mutation()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
BEGIN
  RAISE EXCEPTION
    'audit_logs is append-only: % on % is forbidden (AUDIT_APPEND_ONLY_VIOLATION)',
    TG_OP,
    TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION audit_logs_block_mutation IS
  'BEFORE UPDATE OR DELETE trigger that unconditionally raises an exception. '
  'Second layer of append-only enforcement on top of the REVOKE on app_user. '
  'Error code RESTRICT_VIOLATION (23001) = AUDIT_APPEND_ONLY_VIOLATION in app.';

-- Attach to parent table (PG 16 propagates to child partitions created in the
-- future, but existing partitions must be handled by ensure_audit_partitions).
DROP TRIGGER IF EXISTS trg_audit_logs_block_mutation ON audit_logs;
CREATE TRIGGER trg_audit_logs_block_mutation
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();

-- Attach to the default catch-all partition explicitly.
DROP TRIGGER IF EXISTS trg_audit_logs_block_mutation ON audit_logs_default;
CREATE TRIGGER trg_audit_logs_block_mutation
  BEFORE UPDATE OR DELETE ON audit_logs_default
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();

-- ---------------------------------------------------------------------------
-- 4. ensure_audit_partitions(p_months_ahead int)
--
--    Superset of the generic ensure_monthly_partitions:
--    • Creates monthly RANGE partitions for audit_logs.
--    • Attaches the append-only trigger to every new (and existing) partition.
--    • Emits a PostgreSQL WARNING if the current-month partition is absent so
--      the alerting layer can fire an audit_partition_missing metric.
--
--    Idempotent: safe to call at API startup and from the nightly worker.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ensure_audit_partitions(
  p_months_ahead integer DEFAULT 3
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_offset         integer;
  v_month          date;
  v_partition_name text;
  v_start_date     text;
  v_end_date       text;
BEGIN
  FOR v_offset IN 0..p_months_ahead LOOP
    v_month          := date_trunc('month', CURRENT_DATE + (v_offset || ' months')::interval)::date;
    v_partition_name := 'audit_logs_' || to_char(v_month, 'YYYY_MM');
    v_start_date     := to_char(v_month, 'YYYY-MM-01');
    v_end_date       := to_char(v_month + interval '1 month', 'YYYY-MM-01');

    -- Create partition if it doesn't exist.
    BEGIN
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs '
        'FOR VALUES FROM (%L::timestamptz) TO (%L::timestamptz)',
        v_partition_name,
        v_start_date,
        v_end_date
      );
    EXCEPTION
      WHEN duplicate_table          THEN NULL;
      WHEN invalid_object_definition THEN NULL;
    END;

    -- Attach (or re-attach) the append-only trigger to this partition.
    BEGIN
      EXECUTE format(
        'DROP TRIGGER IF EXISTS trg_audit_logs_block_mutation ON %I',
        v_partition_name
      );
      EXECUTE format(
        'CREATE TRIGGER trg_audit_logs_block_mutation '
        'BEFORE UPDATE OR DELETE ON %I '
        'FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation()',
        v_partition_name
      );
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
  END LOOP;

  -- Warn monitoring if the current-month partition does not exist.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'audit_logs_' || to_char(CURRENT_DATE, 'YYYY_MM')
  ) THEN
    RAISE WARNING
      'audit_partition_missing: current-month partition audit_logs_% is absent',
      to_char(CURRENT_DATE, 'YYYY_MM');
  END IF;
END;
$$;

COMMENT ON FUNCTION ensure_audit_partitions IS
  'Idempotently creates monthly audit_logs partitions and attaches the '
  'append-only trigger to each partition. Call at API startup and nightly. '
  'Raises WARNING (metric: audit_partition_lookahead_months) if the current '
  'month partition is missing.';

-- Bootstrap: apply to current month + 3 months ahead.
SELECT ensure_audit_partitions(3);

COMMIT;
