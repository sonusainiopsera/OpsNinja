-- WO-046: SLA Scheduler — dedicated least-privilege claim role.
--
-- This migration is additive (no ALTER TABLE on existing columns).
-- It creates the opsninja_sla_scheduler role and adds a role-scoped RLS
-- policy so the scheduler can claim timers across tenants without BYPASSRLS.
--
-- See docs/adr/sla-scheduler-rls-claim-pattern.md for the full design rationale.
--
-- Idempotent: all statements use IF NOT EXISTS / DO NOTHING guards.

-- ---------------------------------------------------------------------------
-- 1. Create the claim role (idempotent)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'opsninja_sla_scheduler') THEN
    CREATE ROLE opsninja_sla_scheduler NOLOGIN NOSUPERUSER NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Grant narrow table privileges
-- ---------------------------------------------------------------------------
-- SELECT + UPDATE on sla_timers (claim + advance next_fire_at / state).
GRANT SELECT, UPDATE ON TABLE sla_timers TO opsninja_sla_scheduler;

-- INSERT on outbox_events (fallback path; primary inserts use per-tenant sub-tx).
GRANT INSERT ON TABLE outbox_events TO opsninja_sla_scheduler;

-- ---------------------------------------------------------------------------
-- 3. Role-scoped RLS policy on sla_timers
--
-- The existing tenant_isolation policy keeps the normal app role isolated.
-- This additional policy permits the scheduler role to read and write across
-- all tenants — but ONLY for this role, and ONLY on sla_timers.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies
    WHERE tablename = 'sla_timers' AND policyname = 'scheduler_claim'
  ) THEN
    CREATE POLICY scheduler_claim ON sla_timers
      FOR ALL
      TO opsninja_sla_scheduler
      USING (true)
      WITH CHECK (true);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Covering index to support the claim query plan
--
-- The claim query is:
--   SELECT ... FROM sla_timers
--   WHERE state = 'running' AND next_fire_at <= now()
--   ORDER BY next_fire_at
--   FOR UPDATE SKIP LOCKED
--   LIMIT 500
--
-- The existing partial index sla_timers_running_fire_idx only covers
-- (tenant_id, next_fire_at) WHERE state = 'running'. The scheduler
-- needs (next_fire_at) with the WHERE state = 'running' partial predicate
-- for a cross-tenant ordered scan.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS sla_timers_scheduler_scan_idx
  ON sla_timers (next_fire_at)
  WHERE state = 'running';

-- ---------------------------------------------------------------------------
-- 5. fired_boundaries deduplication table
--
-- Records every (timer_id, boundary) pair that has been fired so the
-- exactly-once guarantee survives pod crashes and concurrent pods.
-- The scheduler tolerates a unique-constraint violation on insert as an
-- already-fired no-op.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sla_fired_boundaries (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL,
  timer_id    uuid        NOT NULL,
  boundary    text        NOT NULL
              CHECK (boundary IN ('reminder_first', 'reminder_second', 'breach')),
  fired_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sla_fired_boundaries_once UNIQUE (timer_id, boundary)
);

ALTER TABLE sla_fired_boundaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_fired_boundaries FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON sla_fired_boundaries
  USING (tenant_id::text = current_setting('app.current_tenant', true));

-- Scheduler role can insert fired boundaries inside per-tenant sub-transactions.
GRANT SELECT, INSERT ON TABLE sla_fired_boundaries TO opsninja_sla_scheduler;
GRANT SELECT, INSERT ON TABLE sla_fired_boundaries TO opsninja_app;

CREATE INDEX IF NOT EXISTS sla_fired_boundaries_timer_idx
  ON sla_fired_boundaries (timer_id);
