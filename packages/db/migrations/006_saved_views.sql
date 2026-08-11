-- Migration 006: Saved Views and Per-Agent Pin State
-- Creates saved_views (view definitions with validated filter ASTs) and
-- saved_view_pins (per-agent pin state and ordering).
-- Both tables carry tenant_id-leading RLS with USING + WITH CHECK.

-- ── Enum ──────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'view_scope') THEN
    CREATE TYPE view_scope AS ENUM ('system', 'private', 'shared');
  END IF;
END$$;

-- ── saved_views ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS saved_views (
  id              UUID       NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       UUID       NOT NULL,
  -- NULL for system and shared views not owned by a single agent
  owner_user_id   UUID,
  name            TEXT       NOT NULL,
  -- Stored validated JSON filter AST
  filter_ast      JSONB      NOT NULL,
  -- Array of { field, direction } objects from the allow-listed sort registry
  sort_spec       JSONB      NOT NULL DEFAULT '[]',
  -- Allow-listed display column keys
  columns         TEXT[]     NOT NULL DEFAULT '{}',
  scope           view_scope NOT NULL DEFAULT 'private',
  is_active       BOOLEAN    NOT NULL DEFAULT TRUE,
  -- SHA-256 of the canonical AST stored for audit log de-duplication
  ast_signature   TEXT       NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT saved_views_pkey PRIMARY KEY (id)
);

ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_views FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_saved_views
  ON saved_views
  AS PERMISSIVE
  FOR ALL
  USING  (tenant_id = current_setting('app.current_tenant', TRUE)::UUID)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);

-- Tenant-leading indexes
CREATE INDEX IF NOT EXISTS saved_views_tenant_idx
  ON saved_views (tenant_id);

CREATE INDEX IF NOT EXISTS saved_views_tenant_scope_idx
  ON saved_views (tenant_id, scope);

CREATE INDEX IF NOT EXISTS saved_views_tenant_owner_idx
  ON saved_views (tenant_id, owner_user_id);

-- Name uniqueness is per (tenant_id, owner_user_id) pair
-- owner_user_id IS NULL for system views; NULL = NULL is false in SQL so system
-- view names are unique as a group (handled at application level).
CREATE UNIQUE INDEX IF NOT EXISTS saved_views_tenant_owner_name_uidx
  ON saved_views (tenant_id, owner_user_id, lower(name))
  WHERE owner_user_id IS NOT NULL;

-- Separate unique index for system/shared views (owner_user_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS saved_views_tenant_null_owner_name_uidx
  ON saved_views (tenant_id, lower(name))
  WHERE owner_user_id IS NULL;

-- ── saved_view_pins ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS saved_view_pins (
  tenant_id   UUID        NOT NULL,
  user_id     UUID        NOT NULL,
  view_id     UUID        NOT NULL,
  pin_order   INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT saved_view_pins_pkey
    PRIMARY KEY (tenant_id, user_id, view_id),
  CONSTRAINT saved_view_pins_view_fk
    FOREIGN KEY (view_id) REFERENCES saved_views (id)
    ON DELETE CASCADE
);

ALTER TABLE saved_view_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_view_pins FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_saved_view_pins
  ON saved_view_pins
  AS PERMISSIVE
  FOR ALL
  USING  (tenant_id = current_setting('app.current_tenant', TRUE)::UUID)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);

CREATE INDEX IF NOT EXISTS saved_view_pins_user_idx
  ON saved_view_pins (tenant_id, user_id);

-- ── Grants ────────────────────────────────────────────────────────────────────
-- GRANT SELECT, INSERT, UPDATE ON saved_views TO opsninja_app;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON saved_view_pins TO opsninja_app;
