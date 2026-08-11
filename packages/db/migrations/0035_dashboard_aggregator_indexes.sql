-- Migration 0035: Supporting indexes for the Dashboard Aggregator reconciliation (WO-067).
--
-- All created CONCURRENTLY so they do not take an exclusive lock on
-- production tables.  Run outside a transaction block (CONCURRENTLY requires it).
--
-- Partial index on tickets: open-state filter keeps the index small and ensures
-- the reconciliation COUNT(*) GROUP BY priority query stays index-backed.
--
-- Partial index on sla_timers: running-state filter mirrors the existing
-- sla_timers_running_fire_idx but makes tenant + next_fire_at lookups cheaper
-- for the approaching-breach computation.
--
-- NOTE: CONCURRENTLY cannot run inside BEGIN/COMMIT.
-- Run this migration via a tool that executes each statement independently.

CREATE INDEX CONCURRENTLY IF NOT EXISTS tickets_tenant_priority_open_idx
  ON tickets (tenant_id, priority)
  WHERE status IN ('open', 'new', 'pending_customer', 'pending_engineering');

CREATE INDEX CONCURRENTLY IF NOT EXISTS sla_timers_tenant_fire_running_idx
  ON sla_timers (tenant_id, next_fire_at)
  WHERE state = 'running';

-- ticket_affected_areas index (created with the table in 0034; ensure it exists)
CREATE INDEX CONCURRENTLY IF NOT EXISTS ticket_affected_areas_tenant_label_idx
  ON ticket_affected_areas (tenant_id, area_label);
