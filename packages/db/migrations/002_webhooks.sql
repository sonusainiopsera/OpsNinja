-- Migration 002: Webhook Endpoints
-- Creates webhook_endpoints table with RLS, FORCE ROW LEVEL SECURITY,
-- status enum, non-empty event_types check, and indexes.

-- ── Enum ──────────────────────────────────────────────────────────────────────

CREATE TYPE webhook_endpoint_status AS ENUM (
  'active', 'disabled', 'auto_disabled', 'deleted'
);

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE webhook_endpoints (
  id                          UUID         NOT NULL DEFAULT gen_random_uuid(),
  tenant_id                   UUID         NOT NULL,
  url                         TEXT         NOT NULL,
  description                 TEXT,
  event_types                 TEXT[]       NOT NULL,
  status                      webhook_endpoint_status NOT NULL DEFAULT 'active',
  secret_ciphertext           BYTEA,
  secret_key_version          INTEGER      NOT NULL DEFAULT 1,
  previous_secret_ciphertext  BYTEA,
  previous_secret_expires_at  TIMESTAMPTZ,
  consecutive_failures        INTEGER      NOT NULL DEFAULT 0,
  last_success_at             TIMESTAMPTZ,
  created_by                  UUID         NOT NULL,
  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at                  TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT webhook_endpoints_event_types_not_empty
    CHECK (array_length(event_types, 1) > 0)
);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints FORCE ROW LEVEL SECURITY;

CREATE POLICY webhook_endpoints_tenant_isolation
  ON webhook_endpoints
  USING (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX webhook_endpoints_tenant_status_idx
  ON webhook_endpoints (tenant_id, status);

-- ── Grants ────────────────────────────────────────────────────────────────────
-- GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_endpoints TO opsninja_app;
