-- Migration 0039: SLA reminder emission idempotency table (WO-048)
--
-- Creates sla_reminder_emissions with:
--   - RLS enabled and forced with tenant_isolation policy
--   - Unique index on (timer_id, threshold_pct, channel) for idempotency
--   - Index on (tenant_id, delivery_status, created_at) for operator queries

CREATE TABLE IF NOT EXISTS sla_reminder_emissions (
  id                UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL,
  timer_id          UUID        NOT NULL,
  ticket_id         UUID        NOT NULL,
  threshold_pct     SMALLINT    NOT NULL,
  channel           TEXT        NOT NULL,
  recipient_ref     TEXT,
  delivery_status   TEXT        NOT NULL DEFAULT 'pending',
  attempt_count     INTEGER     NOT NULL DEFAULT 0,
  suppressed_reason TEXT,
  emitted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- RLS: tenant isolation
ALTER TABLE sla_reminder_emissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_reminder_emissions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON sla_reminder_emissions
  USING (tenant_id::text = current_setting('app.current_tenant', true));

-- Idempotency: exactly one emission record per (timer_id, threshold_pct, channel)
CREATE UNIQUE INDEX IF NOT EXISTS sla_reminder_emissions_idempotency_idx
  ON sla_reminder_emissions (timer_id, threshold_pct, channel);

-- Operator query support
CREATE INDEX IF NOT EXISTS sla_reminder_emissions_tenant_status_idx
  ON sla_reminder_emissions (tenant_id, delivery_status, created_at);

CREATE INDEX IF NOT EXISTS sla_reminder_emissions_tenant_ticket_idx
  ON sla_reminder_emissions (tenant_id, ticket_id);
