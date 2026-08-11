-- Migration: 0011_webhook_deliveries
-- Creates webhook_deliveries table partitioned monthly by created_at — WO-084.
--
-- Security design:
--   - FORCE ROW LEVEL SECURITY: tenant_id leading key, ::uuid cast fail-closed.
--   - Partitioned monthly to keep active partition small; purge job (WO-085)
--     drops old partitions.
--   - canonical_payload jsonb stored for replay support.
--   - Unique index on (tenant_id, endpoint_id, event_id, attempt) makes
--     attempt recording idempotent under SQS redelivery.
--
-- Expand-only migration: additive DDL only.

-- ==========================================================================
-- 1. Parent partitioned table (range on created_at)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  tenant_id           UUID          NOT NULL,
  id                  UUID          NOT NULL DEFAULT gen_random_uuid(),
  endpoint_id         UUID          NOT NULL,
  event_id            UUID          NOT NULL,
  event_type          TEXT          NOT NULL,
  attempt             SMALLINT      NOT NULL DEFAULT 1,
  status              TEXT          NOT NULL DEFAULT 'pending',
  http_status         SMALLINT,
  latency_ms          INTEGER,
  request_headers_meta JSONB,
  response_snippet    TEXT,
  error_code          TEXT,
  canonical_payload   JSONB         NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT webhook_deliveries_status_check
    CHECK (status IN ('pending', 'delivered', 'failed', 'dropped')),
  CONSTRAINT webhook_deliveries_attempt_check
    CHECK (attempt >= 1 AND attempt <= 10)
) PARTITION BY RANGE (created_at);

-- ==========================================================================
-- 2. Pre-create monthly partitions for 2026
-- ==========================================================================

CREATE TABLE IF NOT EXISTS webhook_deliveries_2026_01
  PARTITION OF webhook_deliveries
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE IF NOT EXISTS webhook_deliveries_2026_02
  PARTITION OF webhook_deliveries
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

CREATE TABLE IF NOT EXISTS webhook_deliveries_2026_03
  PARTITION OF webhook_deliveries
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

CREATE TABLE IF NOT EXISTS webhook_deliveries_2026_04
  PARTITION OF webhook_deliveries
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE TABLE IF NOT EXISTS webhook_deliveries_2026_05
  PARTITION OF webhook_deliveries
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TABLE IF NOT EXISTS webhook_deliveries_2026_06
  PARTITION OF webhook_deliveries
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE IF NOT EXISTS webhook_deliveries_2026_07
  PARTITION OF webhook_deliveries
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE TABLE IF NOT EXISTS webhook_deliveries_2026_08
  PARTITION OF webhook_deliveries
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE TABLE IF NOT EXISTS webhook_deliveries_2026_09
  PARTITION OF webhook_deliveries
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

CREATE TABLE IF NOT EXISTS webhook_deliveries_2026_10
  PARTITION OF webhook_deliveries
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

CREATE TABLE IF NOT EXISTS webhook_deliveries_2026_11
  PARTITION OF webhook_deliveries
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');

CREATE TABLE IF NOT EXISTS webhook_deliveries_2026_12
  PARTITION OF webhook_deliveries
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

-- ==========================================================================
-- 3. Indexes on the parent table (inherited by all partitions)
-- ==========================================================================

-- Idempotency: unique attempt row per (tenant, endpoint, event, attempt).
CREATE UNIQUE INDEX IF NOT EXISTS webhook_deliveries_attempt_uniq
  ON webhook_deliveries (tenant_id, endpoint_id, event_id, attempt);

-- History view: ordered by created_at per endpoint.
CREATE INDEX IF NOT EXISTS webhook_deliveries_tenant_endpoint_created_idx
  ON webhook_deliveries (tenant_id, endpoint_id, created_at DESC);

-- Event-based lookup for replay.
CREATE INDEX IF NOT EXISTS webhook_deliveries_tenant_event_idx
  ON webhook_deliveries (tenant_id, event_id);

-- ==========================================================================
-- 4. RLS
-- ==========================================================================

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_webhook_deliveries ON webhook_deliveries;
CREATE POLICY tenant_isolation_webhook_deliveries ON webhook_deliveries
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
