-- Migration 012: Portal signup requests, portal users, and verification tokens
-- Depends on: 005_organization_registry.sql

-- ── Enums ─────────────────────────────────────────────────────────────────────

CREATE TYPE portal_signup_status AS ENUM (
  'pending_verification',
  'verified',
  'rejected'
);

CREATE TYPE portal_user_status AS ENUM (
  'active',
  'suspended',
  'deactivated'
);

-- ── portal_signup_requests ────────────────────────────────────────────────────
-- One row per applicant email address. Multiple tokens may be issued against a
-- single request (resend path), but only one token is active at a time.

CREATE TABLE portal_signup_requests (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  UUID        NOT NULL,
  email                      TEXT        NOT NULL,
  email_hash                 TEXT        NOT NULL,   -- SHA-256 of lower(email), no PII at rest
  applicant_name             TEXT,
  organization_id            UUID,                   -- resolved org; null until verification
  status                     portal_signup_status NOT NULL DEFAULT 'pending_verification',
  verified_at                TIMESTAMPTZ,
  verification_email_status  TEXT,                   -- 'sent' | 'bounced' | 'complaint'
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX portal_signup_requests_tenant_email_active_idx
  ON portal_signup_requests (tenant_id, email_hash)
  WHERE status = 'pending_verification';

CREATE INDEX portal_signup_requests_tenant_status_idx
  ON portal_signup_requests (tenant_id, status);

ALTER TABLE portal_signup_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_signup_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY portal_signup_requests_tenant_isolation
  ON portal_signup_requests
  AS PERMISSIVE
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ── portal_users ──────────────────────────────────────────────────────────────
-- Portal user accounts created upon successful verification.

CREATE TABLE portal_users (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL,
  organization_id     UUID,
  signup_request_id   UUID        NOT NULL REFERENCES portal_signup_requests(id),
  email               TEXT        NOT NULL,
  email_hash          TEXT        NOT NULL,
  roles               TEXT[]      NOT NULL DEFAULT ARRAY['portal_user'],
  status              portal_user_status NOT NULL DEFAULT 'active',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX portal_users_tenant_email_idx ON portal_users (tenant_id, email_hash);
CREATE INDEX portal_users_tenant_org_idx ON portal_users (tenant_id, organization_id);

ALTER TABLE portal_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_users FORCE ROW LEVEL SECURITY;

CREATE POLICY portal_users_tenant_isolation
  ON portal_users
  AS PERMISSIVE
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ── portal_verification_tokens ────────────────────────────────────────────────
-- Hash-only storage of single-use email verification tokens.
-- Raw tokens are NEVER persisted; only SHA-256(rawToken) is stored.
-- Nightly purge deletes rows with expires_at older than 7 days.

CREATE TABLE portal_verification_tokens (
  token_id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  signup_request_id   UUID        NOT NULL REFERENCES portal_signup_requests(id) ON DELETE CASCADE,
  tenant_id           UUID,
  token_hash          TEXT        NOT NULL UNIQUE,
  expires_at          TIMESTAMPTZ NOT NULL,
  consumed_at         TIMESTAMPTZ,
  attempt_count       INT         NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial index for fast "is there an outstanding token?" lookup
CREATE UNIQUE INDEX portal_verification_tokens_outstanding_idx
  ON portal_verification_tokens (signup_request_id)
  WHERE consumed_at IS NULL;

CREATE INDEX portal_verification_tokens_expires_idx
  ON portal_verification_tokens (expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE portal_verification_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_verification_tokens FORCE ROW LEVEL SECURITY;

CREATE POLICY portal_verification_tokens_tenant_isolation
  ON portal_verification_tokens
  AS PERMISSIVE
  FOR ALL
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.current_tenant', true)::uuid
  )
  WITH CHECK (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.current_tenant', true)::uuid
  );
