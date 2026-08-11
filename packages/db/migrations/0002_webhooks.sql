-- Migration 0002: Webhook Endpoints
-- Creates webhook_endpoints with RLS and FORCE ROW LEVEL SECURITY.

BEGIN;

-- ── webhook_endpoints ─────────────────────────────────────────────────────────

CREATE TYPE webhook_endpoint_status AS ENUM ('active', 'disabled', 'auto_disabled', 'deleted');

CREATE TABLE webhook_endpoints (
    tenant_id               uuid        NOT NULL,
    id                      uuid        NOT NULL DEFAULT gen_random_uuid(),
    url                     text        NOT NULL,
    description             text,
    event_types             text[]      NOT NULL,
    status                  webhook_endpoint_status NOT NULL DEFAULT 'active',
    secret_ciphertext       text        NOT NULL,
    secret_key_version      integer     NOT NULL DEFAULT 1,
    previous_secret_ciphertext text,
    previous_secret_expires_at timestamptz,
    consecutive_failures    integer     NOT NULL DEFAULT 0,
    last_success_at         timestamptz,
    created_by              uuid        NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    deleted_at              timestamptz,

    CONSTRAINT webhook_endpoints_pk PRIMARY KEY (tenant_id, id),
    -- event_types must never be empty (a webhook with zero subscriptions is useless)
    CONSTRAINT webhook_endpoints_event_types_nonempty CHECK (cardinality(event_types) > 0)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX webhook_endpoints_tenant_id_idx
    ON webhook_endpoints (tenant_id);

CREATE INDEX webhook_endpoints_tenant_status_idx
    ON webhook_endpoints (tenant_id, status);

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints FORCE ROW LEVEL SECURITY;

CREATE POLICY webhook_endpoints_tenant_isolation
    ON webhook_endpoints
    USING (tenant_id = current_setting('app.current_tenant')::uuid);

COMMIT;
