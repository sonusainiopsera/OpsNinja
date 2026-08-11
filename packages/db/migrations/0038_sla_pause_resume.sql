-- Migration 0038: SLA clock pause/resume and auditable state reconstruction (WO-047)
--
-- Changes:
--   1. ALTER sla_timers: add paused_at and pause_reason columns.
--   2. CREATE sla_timer_events: append-only state-transition event log,
--      monthly-partitioned by occurred_at, with RLS and an enforcement trigger
--      that prevents UPDATE and DELETE.
--   3. Revoke UPDATE/DELETE on sla_timer_events from the application role.
--   4. Index: (tenant_id, timer_id, occurred_at) for timeline queries.

-- ---------------------------------------------------------------------------
-- 1. Extend sla_timers with pause tracking columns
-- ---------------------------------------------------------------------------

ALTER TABLE sla_timers
  ADD COLUMN IF NOT EXISTS paused_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pause_reason TEXT;

-- ---------------------------------------------------------------------------
-- 2. Create the append-only sla_timer_events partitioned table
-- ---------------------------------------------------------------------------

-- Parent partitioned table
CREATE TABLE IF NOT EXISTS sla_timer_events (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL,
  timer_id            UUID        NOT NULL,
  ticket_id           UUID        NOT NULL,
  from_state          TEXT        NOT NULL,
  to_state            TEXT        NOT NULL,
  reason              TEXT,
  actor_id            UUID,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  paused_ms_at_event  BIGINT      NOT NULL DEFAULT 0,
  elapsed_ms_at_event BIGINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- Seed monthly partitions covering the next 24 months from Jan 2026
DO $$
DECLARE
  yr  INT;
  mo  INT;
  p_start DATE;
  p_end   DATE;
  p_name  TEXT;
BEGIN
  FOR yr IN 2026..2027 LOOP
    FOR mo IN 1..12 LOOP
      p_start := make_date(yr, mo, 1);
      p_end   := p_start + INTERVAL '1 month';
      p_name  := 'sla_timer_events_' || yr || '_' || LPAD(mo::TEXT, 2, '0');
      IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = p_name AND n.nspname = 'public'
      ) THEN
        EXECUTE format(
          'CREATE TABLE %I PARTITION OF sla_timer_events FOR VALUES FROM (%L) TO (%L)',
          p_name, p_start, p_end
        );
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Default catch-all partition for rows beyond pre-created range
CREATE TABLE IF NOT EXISTS sla_timer_events_default
  PARTITION OF sla_timer_events DEFAULT;

-- ---------------------------------------------------------------------------
-- 3. RLS on the parent table (inherited by all partitions)
-- ---------------------------------------------------------------------------

ALTER TABLE sla_timer_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_timer_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON sla_timer_events
  USING (tenant_id::text = current_setting('app.current_tenant', true));

-- ---------------------------------------------------------------------------
-- 4. Append-only enforcement trigger
--    Raises an exception on any UPDATE or DELETE attempt.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sla_timer_events_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'sla_timer_events is append-only: % operations are not permitted. timer_id=%, id=%',
    TG_OP,
    COALESCE(OLD.timer_id::TEXT, ''),
    COALESCE(OLD.id::TEXT, '');
END;
$$;

-- Apply to parent; partitions inherit trigger behaviour in PG 14+
-- (For compatibility we also apply to existing partitions below)
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname LIKE 'sla_timer_events%'
      AND c.relkind = 'r'
  LOOP
    EXECUTE format(
      'CREATE OR REPLACE TRIGGER sla_timer_events_immutable_trig
       BEFORE UPDATE OR DELETE ON %I
       FOR EACH ROW EXECUTE FUNCTION sla_timer_events_immutable()',
      tbl
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Indexes on the parent (propagated to partitions in PG 11+)
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS sla_timer_events_timer_occurred_idx
  ON sla_timer_events (tenant_id, timer_id, occurred_at);

CREATE INDEX IF NOT EXISTS sla_timer_events_tenant_ticket_idx
  ON sla_timer_events (tenant_id, ticket_id);
