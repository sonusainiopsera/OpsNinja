-- Migration 011: Webhook delivery log (partitioned monthly)
-- Expand-only: no destructive DDL.
-- The parent table is unlogged during creation but individual partitions
-- are created as regular logged tables so WAL-based replication works.

DO $$ BEGIN
  CREATE TYPE webhook_delivery_status AS ENUM (
    'pending', 'delivered', 'failed', 'dropped'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Parent table (partitioned by range on created_at) ─────────────────────────

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  tenant_id            uuid          NOT NULL,
  id                   uuid          NOT NULL DEFAULT gen_random_uuid(),
  endpoint_id          uuid          NOT NULL,
  event_id             text          NOT NULL,
  event_type           text          NOT NULL,
  attempt              integer       NOT NULL DEFAULT 1,
  status               webhook_delivery_status NOT NULL DEFAULT 'pending',
  http_status          integer       NULL,
  latency_ms           integer       NULL,
  request_headers_meta jsonb         NULL,
  response_snippet     text          NULL,
  error_code           text          NULL,
  -- canonical_payload stored for replay support
  canonical_payload    jsonb         NOT NULL DEFAULT '{}',
  created_at           timestamptz   NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, id, created_at)
) PARTITION BY RANGE (created_at);

-- ── Indexes on parent (inherited by partitions) ───────────────────────────────

-- Unique per (tenant, endpoint, event, attempt) for idempotency under SQS redelivery
CREATE UNIQUE INDEX IF NOT EXISTS webhook_deliveries_attempt_uidx
  ON webhook_deliveries (tenant_id, endpoint_id, event_id, attempt);

-- History view: tenant + endpoint + time descending
CREATE INDEX IF NOT EXISTS webhook_deliveries_history_idx
  ON webhook_deliveries (tenant_id, endpoint_id, created_at DESC);

-- ── Pre-create two monthly partitions (current + next month) ─────────────────
-- Production automation creates partitions via a scheduled job; these cover
-- initial test and development usage.

DO $$
DECLARE
  cur_start  date := date_trunc('month', now())::date;
  next_start date := (date_trunc('month', now()) + interval '1 month')::date;
  after_next date := (date_trunc('month', now()) + interval '2 months')::date;
  cur_name   text := 'webhook_deliveries_' || to_char(cur_start, 'YYYY_MM');
  next_name  text := 'webhook_deliveries_' || to_char(next_start, 'YYYY_MM');
BEGIN
  -- Current month
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = cur_name
  ) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF webhook_deliveries FOR VALUES FROM (%L) TO (%L)',
      cur_name, cur_start, next_start
    );
  END IF;

  -- Next month
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = next_name
  ) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF webhook_deliveries FOR VALUES FROM (%L) TO (%L)',
      next_name, next_start, after_next
    );
  END IF;
END $$;

-- ── Row-level security ────────────────────────────────────────────────────────

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS webhook_deliveries_tenant_isolation ON webhook_deliveries;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

CREATE POLICY webhook_deliveries_tenant_isolation ON webhook_deliveries
  AS PERMISSIVE
  FOR ALL
  USING     (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
