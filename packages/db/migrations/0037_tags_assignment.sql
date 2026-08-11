-- ---------------------------------------------------------------------------
-- 0037_tags_assignment.sql
--
-- Adds tag management, ticket tagging, assignment groups and group membership.
-- Also extends the tickets table with an assignment_group_id column.
--
-- All tables use tenant_id-leading composite PKs for RLS compliance.
-- RLS ENABLE + FORCE with tenant_isolation policy on every new table.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. TAGS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tags (
  tenant_id   uuid        NOT NULL REFERENCES tenants(id),
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  slug        text        NOT NULL,
  colour      text,
  is_active   boolean     NOT NULL DEFAULT true,
  usage_count integer     NOT NULL DEFAULT 0
                           CHECK (usage_count >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

-- Unique slug per tenant (case-insensitive de-dup is enforced at application
-- layer via normalisation before insert; the DB index seals the race window).
CREATE UNIQUE INDEX IF NOT EXISTS uq_tags_slug
  ON tags (tenant_id, slug);

CREATE INDEX IF NOT EXISTS idx_tags_tenant_active
  ON tags (tenant_id, is_active);

-- ---------------------------------------------------------------------------
-- 2. TICKET_TAGS  (join table; no FK to partitioned tickets — app-validated)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_tags (
  tenant_id   uuid        NOT NULL REFERENCES tenants(id),
  ticket_id   uuid        NOT NULL,
  tag_id      uuid        NOT NULL,
  attached_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, ticket_id, tag_id),
  -- FK to tags (non-partitioned — FK is safe here).
  CONSTRAINT fk_ticket_tags_tag
    FOREIGN KEY (tenant_id, tag_id)
    REFERENCES tags(tenant_id, id) ON DELETE CASCADE
);

-- Lookup by tag (for merge queries and usage counts).
CREATE INDEX IF NOT EXISTS idx_ticket_tags_tag
  ON ticket_tags (tenant_id, tag_id);

-- ---------------------------------------------------------------------------
-- 3. ASSIGNMENT_GROUPS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assignment_groups (
  tenant_id   uuid        NOT NULL REFERENCES tenants(id),
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  description text,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

-- Case-insensitive name uniqueness per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_assignment_groups_name
  ON assignment_groups (tenant_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_assignment_groups_tenant_active
  ON assignment_groups (tenant_id, is_active);

-- ---------------------------------------------------------------------------
-- 4. ASSIGNMENT_GROUP_MEMBERS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assignment_group_members (
  tenant_id uuid        NOT NULL REFERENCES tenants(id),
  group_id  uuid        NOT NULL,
  user_id   uuid        NOT NULL,
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, group_id, user_id),
  CONSTRAINT fk_group_members_group
    FOREIGN KEY (tenant_id, group_id)
    REFERENCES assignment_groups(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_group_members_user
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES users(tenant_id, id) ON DELETE CASCADE
);

-- Reverse lookup: "which groups does user X belong to?"
CREATE INDEX IF NOT EXISTS idx_group_members_user
  ON assignment_group_members (tenant_id, user_id);

-- ---------------------------------------------------------------------------
-- 5. Extend tickets with assignment_group_id
-- ---------------------------------------------------------------------------
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS assignment_group_id uuid;

-- ---------------------------------------------------------------------------
-- 6. RLS — tags
-- ---------------------------------------------------------------------------
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tags
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- 7. RLS — ticket_tags
-- ---------------------------------------------------------------------------
ALTER TABLE ticket_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_tags FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON ticket_tags
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- 8. RLS — assignment_groups
-- ---------------------------------------------------------------------------
ALTER TABLE assignment_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_groups FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON assignment_groups
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- 9. RLS — assignment_group_members
-- ---------------------------------------------------------------------------
ALTER TABLE assignment_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_group_members FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON assignment_group_members
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- 10. Grants to app_user
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON tags TO app_user;
GRANT SELECT, INSERT, DELETE         ON ticket_tags TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON assignment_groups TO app_user;
GRANT SELECT, INSERT, DELETE         ON assignment_group_members TO app_user;
