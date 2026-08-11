-- =============================================================================
-- Migration 0036: Enrich categories table for multi-level categorisation engine
-- =============================================================================
-- Adds slug, depth, sort_order and is_active columns via expand-only ALTER
-- TABLE. All new columns have safe defaults so existing rows are valid.
-- Also installs RLS for the categories table (not covered by 0002/0009).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Extend categories with required columns
-- ---------------------------------------------------------------------------

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS slug       text        NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS depth      integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sort_order integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active  boolean     NOT NULL DEFAULT true;

COMMENT ON COLUMN categories.slug       IS 'URL-safe slug for this node; path is the slug chain.';
COMMENT ON COLUMN categories.depth      IS '0 = root, 1 = child, 2 = grandchild, etc.';
COMMENT ON COLUMN categories.sort_order IS 'Display order within siblings; lower = first.';
COMMENT ON COLUMN categories.is_active  IS 'Soft-delete flag; deactivated nodes are hidden from new-assignment selectors.';

-- Additional index: btree on (tenant_id, sort_order) for ordered sibling queries.
CREATE INDEX IF NOT EXISTS idx_categories_sort
  ON categories (tenant_id, parent_id, sort_order);

-- Index for active-only queries (new-assignment selectors).
CREATE INDEX IF NOT EXISTS idx_categories_active
  ON categories (tenant_id, is_active)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- 2. RLS for categories (tenant isolation)
-- ---------------------------------------------------------------------------

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON categories;
CREATE POLICY tenant_isolation ON categories
  USING  (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ---------------------------------------------------------------------------
-- 3. Grants for app_user role
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE ON categories TO app_user;
  END IF;
END;
$$;

COMMIT;
