-- WO-090: Portal ticket tracking with public-only comment visibility
-- Adds indexes to support portal read path: keyset pagination + public comment scan.

-- 1. Keyset pagination index for portal ticket list:
--    (tenant_id, organization_id, created_at DESC, id DESC)
--    Keeps the per-org portal page scan entirely within the composite index.
CREATE INDEX IF NOT EXISTS tickets_portal_keyset_idx
  ON tickets (tenant_id, organization_id, created_at DESC, id DESC);

-- 2. Partial index on ticket_comments for portal public-thread scan:
--    Only rows where visibility = 'public' are indexed, keeping the tenant-local
--    public scan small.
CREATE INDEX IF NOT EXISTS ticket_comments_portal_public_idx
  ON ticket_comments (tenant_id, ticket_id, created_at)
  WHERE visibility = 'public';

-- 3. Verify FORCE ROW LEVEL SECURITY is enabled on portal-readable tables.
--    These ALTER TABLE statements are safe to replay (IF NOT EXISTS equivalent
--    behaviour: Postgres ignores ENABLE FORCE RLS if already set).
ALTER TABLE tickets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets          FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_comments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_comments  FORCE ROW LEVEL SECURITY;
ALTER TABLE ticket_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_attachments FORCE ROW LEVEL SECURITY;
