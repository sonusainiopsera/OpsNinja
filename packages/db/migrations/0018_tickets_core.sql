-- Migration: 0018_tickets_core
-- WO-031: Ticketing Core Schema With Tenant RLS Policies
--
-- Expands the existing tickets / ticket_comments / ticket_attachments tables
-- with the columns required for the full ticketing domain, then creates the
-- new tables: tags, ticket_tags, assignment_groups, assignment_group_members,
-- ticket_status_history, tenant_sequences.
--
-- All new tables get ENABLE + FORCE ROW LEVEL SECURITY with a USING predicate
-- that binds rows to the session's app.current_tenant variable. The ::uuid
-- cast ensures that a missing or empty variable raises an error rather than
-- returning all rows (fail-closed).
--
-- Expand/contract discipline: only ADD COLUMN / CREATE TABLE / CREATE INDEX.
-- No existing columns are dropped or renamed.
-- ==========================================================================

-- ==========================================================================
-- 1. Extend tickets table (expand pattern)
-- ==========================================================================

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS requester_contact_id  UUID,
  ADD COLUMN IF NOT EXISTS assignment_group_id   UUID,
  ADD COLUMN IF NOT EXISTS category_id           UUID,
  ADD COLUMN IF NOT EXISTS description           TEXT,
  ADD COLUMN IF NOT EXISTS version               INTEGER  NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS ticket_number         INTEGER,
  ADD COLUMN IF NOT EXISTS custom_fields         JSONB    NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_status             TEXT;

-- Status constraint: valid lifecycle states.
ALTER TABLE tickets
  DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE tickets
  ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('new', 'open', 'pending_customer', 'pending_engineering', 'resolved', 'closed'));

-- Priority constraint: P1 = Critical … P4 = Low.
ALTER TABLE tickets
  DROP CONSTRAINT IF EXISTS tickets_priority_check;
ALTER TABLE tickets
  ADD CONSTRAINT tickets_priority_check
  CHECK (priority IN ('P1', 'P2', 'P3', 'P4'));

-- GIN index for JSONB containment queries on custom_fields.
CREATE INDEX IF NOT EXISTS tickets_custom_fields_gin
  ON tickets USING GIN (custom_fields);

-- Hot queue listing: (tenant_id, status, priority, updated_at DESC).
CREATE INDEX IF NOT EXISTS tickets_tenant_queue_idx
  ON tickets (tenant_id, status, priority, updated_at DESC);

-- Org-scoped agent queue.
CREATE INDEX IF NOT EXISTS tickets_tenant_org_status_idx
  ON tickets (tenant_id, organization_id, status);

-- My Assigned Tickets panel.
CREATE INDEX IF NOT EXISTS tickets_tenant_assignee_status_idx
  ON tickets (tenant_id, assignee_id, status);

-- Unique ticket number per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS tickets_tenant_ticket_number_uniq
  ON tickets (tenant_id, ticket_number)
  WHERE ticket_number IS NOT NULL;

-- RLS on tickets.
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_tickets ON tickets;
CREATE POLICY tenant_isolation_tickets ON tickets
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ==========================================================================
-- 2. Extend ticket_comments (expand pattern)
-- ==========================================================================

ALTER TABLE ticket_comments
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;

-- Composite tenant-leading index for ordered comment fetch.
CREATE INDEX IF NOT EXISTS ticket_comments_tenant_ticket_created_idx
  ON ticket_comments (tenant_id, ticket_id, created_at);

-- RLS on ticket_comments.
ALTER TABLE ticket_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_comments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_ticket_comments ON ticket_comments;
CREATE POLICY tenant_isolation_ticket_comments ON ticket_comments
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ==========================================================================
-- 3. Extend ticket_attachments (expand pattern)
-- ==========================================================================

ALTER TABLE ticket_attachments
  ADD COLUMN IF NOT EXISTS file_size_bytes     INTEGER,
  ADD COLUMN IF NOT EXISTS uploaded_by_user_id UUID;

-- Composite tenant-leading ticket index.
CREATE INDEX IF NOT EXISTS ticket_attachments_tenant_ticket_idx
  ON ticket_attachments (tenant_id, ticket_id);

-- RLS on ticket_attachments.
ALTER TABLE ticket_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_attachments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_ticket_attachments ON ticket_attachments;
CREATE POLICY tenant_isolation_ticket_attachments ON ticket_attachments
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ==========================================================================
-- 4. tags
-- ==========================================================================

CREATE TABLE IF NOT EXISTS tags (
  id          UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL,
  name        TEXT        NOT NULL,
  color       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- Case-insensitive unique tag name per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS tags_tenant_name_uniq
  ON tags (tenant_id, lower(name));

CREATE INDEX IF NOT EXISTS tags_tenant_id_idx
  ON tags (tenant_id);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_tags ON tags;
CREATE POLICY tenant_isolation_tags ON tags
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ==========================================================================
-- 5. ticket_tags
-- ==========================================================================

CREATE TABLE IF NOT EXISTS ticket_tags (
  tenant_id   UUID        NOT NULL,
  ticket_id   UUID        NOT NULL,
  tag_id      UUID        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, ticket_id, tag_id)
);

CREATE INDEX IF NOT EXISTS ticket_tags_tenant_id_idx
  ON ticket_tags (tenant_id);

CREATE INDEX IF NOT EXISTS ticket_tags_ticket_id_idx
  ON ticket_tags (tenant_id, ticket_id);

CREATE INDEX IF NOT EXISTS ticket_tags_tag_id_idx
  ON ticket_tags (tenant_id, tag_id);

ALTER TABLE ticket_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_tags FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_ticket_tags ON ticket_tags;
CREATE POLICY tenant_isolation_ticket_tags ON ticket_tags
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ==========================================================================
-- 6. assignment_groups
-- ==========================================================================

CREATE TABLE IF NOT EXISTS assignment_groups (
  id          UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL,
  name        TEXT        NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS assignment_groups_tenant_id_idx
  ON assignment_groups (tenant_id);

CREATE INDEX IF NOT EXISTS assignment_groups_tenant_name_idx
  ON assignment_groups (tenant_id, name);

ALTER TABLE assignment_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_groups FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_assignment_groups ON assignment_groups;
CREATE POLICY tenant_isolation_assignment_groups ON assignment_groups
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ==========================================================================
-- 7. assignment_group_members
-- ==========================================================================

CREATE TABLE IF NOT EXISTS assignment_group_members (
  id          UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL,
  group_id    UUID        NOT NULL,
  user_id     UUID        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT assignment_group_members_group_fk
    FOREIGN KEY (group_id) REFERENCES assignment_groups (id) ON DELETE CASCADE,
  -- Prevent duplicate membership.
  CONSTRAINT assignment_group_members_uniq
    UNIQUE (tenant_id, group_id, user_id)
);

CREATE INDEX IF NOT EXISTS assignment_group_members_tenant_id_idx
  ON assignment_group_members (tenant_id);

CREATE INDEX IF NOT EXISTS assignment_group_members_group_id_idx
  ON assignment_group_members (tenant_id, group_id);

CREATE INDEX IF NOT EXISTS assignment_group_members_user_id_idx
  ON assignment_group_members (tenant_id, user_id);

ALTER TABLE assignment_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_group_members FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_assignment_group_members ON assignment_group_members;
CREATE POLICY tenant_isolation_assignment_group_members ON assignment_group_members
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ==========================================================================
-- 8. ticket_status_history (append-only)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS ticket_status_history (
  id             UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL,
  ticket_id      UUID        NOT NULL,
  from_status    TEXT,           -- null for initial entry
  to_status      TEXT        NOT NULL,
  actor_user_id  UUID,           -- null for system transitions
  reason         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT ticket_status_history_ticket_fk
    FOREIGN KEY (ticket_id) REFERENCES tickets (id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ticket_status_history_tenant_id_idx
  ON ticket_status_history (tenant_id);

CREATE INDEX IF NOT EXISTS ticket_status_history_ticket_id_idx
  ON ticket_status_history (tenant_id, ticket_id, created_at);

ALTER TABLE ticket_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_status_history FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_ticket_status_history ON ticket_status_history;
CREATE POLICY tenant_isolation_ticket_status_history ON ticket_status_history
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ==========================================================================
-- 9. tenant_sequences — per-tenant atomic counters for ticket numbering
-- ==========================================================================

CREATE TABLE IF NOT EXISTS tenant_sequences (
  tenant_id     UUID   NOT NULL,
  sequence_name TEXT   NOT NULL,
  last_value    BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, sequence_name)
);

CREATE INDEX IF NOT EXISTS tenant_sequences_tenant_id_idx
  ON tenant_sequences (tenant_id);

ALTER TABLE tenant_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_sequences FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_tenant_sequences ON tenant_sequences;
CREATE POLICY tenant_isolation_tenant_sequences ON tenant_sequences
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ==========================================================================
-- 10. next_tenant_sequence() — atomic ticket number generator
--
-- Uses INSERT … ON CONFLICT DO UPDATE to atomically increment last_value.
-- Concurrent inserts for the same (tenant_id, sequence_name) are serialised
-- by the row-level lock; no gap-free guarantee but values are unique.
-- ==========================================================================

CREATE OR REPLACE FUNCTION next_tenant_sequence(
  p_tenant_id     UUID,
  p_sequence_name TEXT
)
RETURNS BIGINT
LANGUAGE sql
AS $$
  INSERT INTO tenant_sequences (tenant_id, sequence_name, last_value)
  VALUES (p_tenant_id, p_sequence_name, 1)
  ON CONFLICT (tenant_id, sequence_name) DO UPDATE
    SET last_value = tenant_sequences.last_value + 1
  RETURNING last_value;
$$;

-- ==========================================================================
-- 11. assign_ticket_number trigger — auto-populates ticket_number on INSERT
-- ==========================================================================

CREATE OR REPLACE FUNCTION assign_ticket_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ticket_number IS NULL THEN
    NEW.ticket_number := next_tenant_sequence(NEW.tenant_id, 'tickets');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_ticket_number ON tickets;
CREATE TRIGGER trg_assign_ticket_number
  BEFORE INSERT ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION assign_ticket_number();
