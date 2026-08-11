-- Migration 001: Notification Engine Schema
-- Creates notification_templates, notifications (monthly partitioned), and
-- notification_suppressions with RLS policies, indexes, and pre-created partitions.
--
-- Run as a database superuser or owner; the application role (opsninja_app)
-- needs INSERT/UPDATE/SELECT on all three tables.

-- ── Enums ─────────────────────────────────────────────────────────────────────

CREATE TYPE notification_channel AS ENUM ('email');
CREATE TYPE notification_status  AS ENUM ('queued', 'sent', 'failed', 'suppressed');

-- ── notification_templates ────────────────────────────────────────────────────

CREATE TABLE notification_templates (
  id           UUID         NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    UUID         NOT NULL,
  key          TEXT         NOT NULL,
  channel      notification_channel NOT NULL DEFAULT 'email',
  locale       TEXT         NOT NULL DEFAULT 'en',
  subject      TEXT         NOT NULL,
  body_template TEXT        NOT NULL,
  text_template TEXT,
  version      INTEGER      NOT NULL DEFAULT 1,
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_templates FORCE ROW LEVEL SECURITY;

CREATE POLICY notification_templates_tenant_isolation
  ON notification_templates
  USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);

CREATE UNIQUE INDEX notification_templates_tenant_key_locale_idx
  ON notification_templates (tenant_id, key, locale);

-- ── notifications (RANGE partitioned by created_at) ───────────────────────────

CREATE TABLE notifications (
  id                   UUID         NOT NULL DEFAULT gen_random_uuid(),
  tenant_id            UUID         NOT NULL,
  ticket_id            UUID,
  recipient_contact_id UUID,
  recipient_email      TEXT         NOT NULL,
  channel              notification_channel NOT NULL DEFAULT 'email',
  template_key         TEXT         NOT NULL,
  payload              JSONB,
  dedupe_key           TEXT         NOT NULL,
  status               notification_status  NOT NULL DEFAULT 'queued',
  attempts             INTEGER      NOT NULL DEFAULT 0,
  provider_message_id  TEXT,
  error_code           TEXT,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  sent_at              TIMESTAMPTZ
) PARTITION BY RANGE (created_at);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

CREATE POLICY notifications_tenant_isolation
  ON notifications
  USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);

CREATE UNIQUE INDEX notifications_tenant_dedupe_key_idx
  ON notifications (tenant_id, dedupe_key);

CREATE INDEX notifications_tenant_status_queued_idx
  ON notifications (tenant_id, status)
  WHERE status = 'queued';

-- ── Monthly partitions: current month + next 3 ───────────────────────────────
-- The partition maintenance story (WOREF-073) will handle future partitions.
-- These four cover the near-term window and serve as the pre-created set.

DO $$
DECLARE
  base_month DATE := date_trunc('month', now())::DATE;
  m          DATE;
  tbl        TEXT;
  start_dt   TEXT;
  end_dt     TEXT;
BEGIN
  FOR i IN 0..3 LOOP
    m        := base_month + make_interval(months => i);
    tbl      := 'notifications_' || to_char(m, 'YYYY_MM');
    start_dt := m::TEXT;
    end_dt   := (m + INTERVAL '1 month')::TEXT;

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF notifications
       FOR VALUES FROM (%L::TIMESTAMPTZ) TO (%L::TIMESTAMPTZ)',
      tbl, start_dt, end_dt
    );
  END LOOP;
END
$$;

-- ── notification_suppressions ─────────────────────────────────────────────────

CREATE TABLE notification_suppressions (
  id         UUID         NOT NULL DEFAULT gen_random_uuid(),
  tenant_id  UUID         NOT NULL,
  email_hash TEXT         NOT NULL,  -- SHA-256 of lowercased email (no PII at rest)
  reason     TEXT         NOT NULL,  -- 'bounce_permanent' | 'complaint' | 'manual'
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

ALTER TABLE notification_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_suppressions FORCE ROW LEVEL SECURITY;

CREATE POLICY notification_suppressions_tenant_isolation
  ON notification_suppressions
  USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);

CREATE INDEX notification_suppressions_tenant_email_hash_idx
  ON notification_suppressions (tenant_id, email_hash);

-- ── Grants ────────────────────────────────────────────────────────────────────
-- Replace 'opsninja_app' with your application role name.

-- GRANT SELECT, INSERT, UPDATE ON notification_templates TO opsninja_app;
-- GRANT SELECT, INSERT, UPDATE ON notifications TO opsninja_app;
-- GRANT SELECT, INSERT ON notification_suppressions TO opsninja_app;
