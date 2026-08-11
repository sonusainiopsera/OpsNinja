-- Migration: 0001_notifications
-- Creates notification_templates, notifications (monthly-partitioned), and
-- notification_suppressions tables with RLS policies.
--
-- Each table has tenant_id as the leading key column.
-- FORCE ROW LEVEL SECURITY ensures the app role (NOSUPERUSER, NOBYPASSRLS) sees
-- only its tenant's rows. The RLS policy compares tenant_id to the session
-- variable app.current_tenant set by the worker before any query.

-- ---------------------------------------------------------------------------
-- notification_templates
-- ---------------------------------------------------------------------------

CREATE TABLE notification_templates (
  tenant_id           UUID        NOT NULL,
  key                 TEXT        NOT NULL,
  channel             TEXT        NOT NULL DEFAULT 'email',
  locale              TEXT        NOT NULL DEFAULT 'en',
  subject             TEXT        NOT NULL,
  body_template       TEXT        NOT NULL,
  text_template       TEXT        NOT NULL,
  version             INTEGER     NOT NULL DEFAULT 1,
  is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, key, channel, locale)
);

CREATE INDEX notification_templates_tenant_id_idx
  ON notification_templates (tenant_id);

ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_templates FORCE ROW LEVEL SECURITY;

CREATE POLICY notification_templates_tenant_isolation
  ON notification_templates
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- notifications  (RANGE-partitioned by created_at)
-- ---------------------------------------------------------------------------

CREATE TABLE notifications (
  id                    UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL,
  ticket_id             UUID,
  recipient_contact_id  UUID,
  recipient_email       TEXT        NOT NULL,
  channel               TEXT        NOT NULL DEFAULT 'email',
  template_key          TEXT        NOT NULL,
  payload               JSONB       NOT NULL DEFAULT '{}',
  dedupe_key            TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued','sent','failed','suppressed')),
  attempts              INTEGER     NOT NULL DEFAULT 0,
  provider_message_id   TEXT,
  error_code            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at               TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, id)
) PARTITION BY RANGE (created_at);

-- Unique idempotency index — duplicate SQS delivery returns conflict → zero-op.
CREATE UNIQUE INDEX notifications_dedupe_idx
  ON notifications (tenant_id, dedupe_key);

-- Partial index for efficient queued-count queries.
CREATE INDEX notifications_status_idx
  ON notifications (tenant_id, status);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

CREATE POLICY notifications_tenant_isolation
  ON notifications
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- Pre-create monthly partitions: current month (2026-08) + next 3 months
-- ---------------------------------------------------------------------------

CREATE TABLE notifications_2026_08 PARTITION OF notifications
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE TABLE notifications_2026_09 PARTITION OF notifications
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

CREATE TABLE notifications_2026_10 PARTITION OF notifications
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

CREATE TABLE notifications_2026_11 PARTITION OF notifications
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');

-- Apply RLS to each partition (required for partitioned tables in PostgreSQL)
ALTER TABLE notifications_2026_08 ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications_2026_08 FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications_2026_09 ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications_2026_09 FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications_2026_10 ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications_2026_10 FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications_2026_11 ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications_2026_11 FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- notification_suppressions
-- ---------------------------------------------------------------------------

CREATE TABLE notification_suppressions (
  tenant_id   UUID        NOT NULL,
  email_hash  TEXT        NOT NULL,
  reason      TEXT        NOT NULL CHECK (reason IN ('bounce','complaint')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, email_hash)
);

CREATE INDEX notification_suppressions_tenant_email_hash_idx
  ON notification_suppressions (tenant_id, email_hash);

ALTER TABLE notification_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_suppressions FORCE ROW LEVEL SECURITY;

CREATE POLICY notification_suppressions_tenant_isolation
  ON notification_suppressions
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
