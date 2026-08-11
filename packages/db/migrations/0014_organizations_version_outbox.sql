-- Migration 0014: organizations.version column + outbox_events table
--
-- Created by: WO-024 Organization CRUD API with cursor pagination and filters
--
-- Adds optimistic-concurrency version tracking to organizations and creates
-- the transactional outbox table that mutation services write to inside the
-- same DB transaction as the data change.

-- ---------------------------------------------------------------------------
-- organizations: add version column
-- ---------------------------------------------------------------------------
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------------
-- outbox_events
--
-- Every domain mutation (organization.created, organization.updated, …) writes
-- a row here inside the same Drizzle transaction as the data change.
-- The drain worker reads pending rows, publishes to the message bus, and marks
-- them processed. Tenant-scoped RLS applies so cross-tenant reads are
-- impossible even if the drain worker shares a connection.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbox_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    aggregate_type  TEXT NOT NULL,   -- e.g. 'organization'
    aggregate_id    UUID NOT NULL,
    event_type      TEXT NOT NULL,   -- e.g. 'organization.created'
    payload         JSONB NOT NULL DEFAULT '{}',
    trace_id        TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'published', 'failed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS outbox_events_status_created_idx
    ON outbox_events(status, created_at)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS outbox_events_tenant_agg_idx
    ON outbox_events(tenant_id, aggregate_type, aggregate_id);

-- RLS: tenant-scoped visibility
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;

CREATE POLICY outbox_events_rls ON outbox_events
    USING  (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
