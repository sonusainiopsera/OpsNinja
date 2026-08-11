-- Migration: 0006_saved_views
-- Creates saved_views and saved_view_pins tables for WO-039.
--
-- saved_views stores compiler-validated filter ASTs with scope classification.
-- saved_view_pins records per-agent pin state and display order.
--
-- RLS policies use:
--   USING       (tenant_id = current_setting('app.current_tenant')::uuid)
--   WITH CHECK  (tenant_id = current_setting('app.current_tenant')::uuid)
-- ::uuid cast on empty string raises an error (fail-closed behaviour).
--
-- System views (scope='system') are seeded by idempotent migration-time or
-- tenant-provisioning routines; the slug unique index prevents duplicates.

-- ==========================================================================
-- 1. saved_views
-- ==========================================================================

CREATE TABLE IF NOT EXISTS saved_views (
  id             UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL,
  owner_user_id  UUID,                           -- NULL for scope='system'
  name           TEXT        NOT NULL,
  filter_ast     JSONB       NOT NULL DEFAULT '{}',
  sort_spec      JSONB       NOT NULL DEFAULT '[]',
  columns        JSONB       NOT NULL DEFAULT '[]',
  scope          TEXT        NOT NULL DEFAULT 'private',
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  slug           TEXT,                           -- well-known slug for system views
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT saved_views_scope_check
    CHECK (scope IN ('system', 'private', 'shared'))
);

-- Leading-tenant_id indexes.
CREATE INDEX IF NOT EXISTS saved_views_tenant_id_idx
  ON saved_views (tenant_id);

CREATE INDEX IF NOT EXISTS saved_views_tenant_owner_idx
  ON saved_views (tenant_id, owner_user_id);

CREATE INDEX IF NOT EXISTS saved_views_tenant_scope_idx
  ON saved_views (tenant_id, scope);

-- Unique constraint on (tenant_id, lower(name)) scoped to owner_user_id for
-- private views. NOTE: name uniqueness across private + shared is enforced at
-- the application layer via a service-level check; the DB partial unique index
-- below prevents system view slug collisions.

-- Unique slug per tenant — prevents duplicate system view seeding.
CREATE UNIQUE INDEX IF NOT EXISTS saved_views_tenant_slug_uniq
  ON saved_views (tenant_id, slug)
  WHERE slug IS NOT NULL;

-- RLS.
ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_views FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_saved_views ON saved_views;
CREATE POLICY tenant_isolation_saved_views ON saved_views
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ==========================================================================
-- 2. saved_view_pins
-- ==========================================================================

CREATE TABLE IF NOT EXISTS saved_view_pins (
  tenant_id  UUID        NOT NULL,
  user_id    UUID        NOT NULL,
  view_id    UUID        NOT NULL,
  pin_order  INTEGER     NOT NULL DEFAULT 0,
  pinned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, view_id),
  -- FK to saved_views; deferrable so batch upsert can complete before
  -- old pin rows referencing replaced views are cleaned up.
  CONSTRAINT saved_view_pins_view_fk
    FOREIGN KEY (tenant_id, view_id)
    REFERENCES saved_views (tenant_id, id)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS saved_view_pins_tenant_user_idx
  ON saved_view_pins (tenant_id, user_id);

-- RLS.
ALTER TABLE saved_view_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_view_pins FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_saved_view_pins ON saved_view_pins;
CREATE POLICY tenant_isolation_saved_view_pins ON saved_view_pins
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ==========================================================================
-- 3. Composite (tenant_id, id) unique on saved_views for FK from pins.
-- ==========================================================================

ALTER TABLE saved_views
  DROP CONSTRAINT IF EXISTS saved_views_tenant_id_id_uniq;
ALTER TABLE saved_views
  ADD CONSTRAINT saved_views_tenant_id_id_uniq
  UNIQUE (tenant_id, id);
