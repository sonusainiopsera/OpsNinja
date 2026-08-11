-- WO-045: SLA timers — durable per-ticket response and resolution clocks.
--
-- One row per (tenant_id, ticket_id, clock_type) — enforced by unique index.
-- Timer creation uses ON CONFLICT DO NOTHING so a retried ticket-create path
-- cannot produce duplicate clocks.
--
-- RLS enabled and forced with a tenant_isolation policy so row-level isolation
-- is enforced even for superuser connections inside the app.

CREATE TABLE IF NOT EXISTS sla_timers (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  ticket_id        uuid        NOT NULL,
  sla_policy_id    uuid        NOT NULL,
  clock_type       text        NOT NULL CHECK (clock_type IN ('response', 'resolution')),
  state            text        NOT NULL DEFAULT 'running'
                               CHECK (state IN ('running', 'paused', 'met', 'breached', 'cancelled')),
  paused_ms        bigint      NOT NULL DEFAULT 0,
  started_at       timestamptz NOT NULL,
  target_at        timestamptz NOT NULL,
  next_fire_at     timestamptz,
  last_state_change_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- RLS: enable and force so even superuser connections are isolated by tenant.
ALTER TABLE sla_timers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_timers FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON sla_timers
  USING (tenant_id::text = current_setting('app.current_tenant', true));

-- Unique constraint: exactly one timer per clock type per ticket.
CREATE UNIQUE INDEX IF NOT EXISTS sla_timers_unique_clock
  ON sla_timers (tenant_id, ticket_id, clock_type);

-- Partial index: the 15-second scheduler scan touches only running timers,
-- ordered by next_fire_at to find the earliest action needed.
CREATE INDEX IF NOT EXISTS sla_timers_running_fire_idx
  ON sla_timers (tenant_id, next_fire_at)
  WHERE state = 'running';

-- General tenant index for getByTicketId queries.
CREATE INDEX IF NOT EXISTS sla_timers_tenant_idx
  ON sla_timers (tenant_id);
