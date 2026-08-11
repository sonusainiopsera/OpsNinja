-- Migration 0012: Portal signup requests, verification tokens, and portal users
--
-- Creates three tables for the self-service portal onboarding flow:
--   portal_signup_requests  — applicant record created when email submitted
--   portal_verification_tokens — single-use email verification tokens (hash-only)
--   portal_users            — activated portal contacts bound to tenant + org
--
-- All tables carry tenant_id and use ENABLE + FORCE ROW LEVEL SECURITY so
-- out-of-scope rows are invisible rather than forbidden.
--
-- portal_signup_requests has a bootstrap RLS branch (via pool directly, before
-- tenant context is set) identical to the CSAT token pattern: the verification
-- service reads by token_hash using SET LOCAL app.portal_verify_mode = 'bootstrap'.

-- ---------------------------------------------------------------------------
-- portal_signup_requests
-- ---------------------------------------------------------------------------
CREATE TABLE portal_signup_requests (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- null until organization is resolved during verification
    tenant_id                   UUID,
    organization_id             UUID,
    email                       TEXT NOT NULL,
    applicant_name              TEXT NOT NULL,
    status                      TEXT NOT NULL DEFAULT 'pending_verification'
                                    CHECK (status IN ('pending_verification','verified','rejected','expired')),
    -- populated on successful verification
    verified_at                 TIMESTAMPTZ,
    verification_email_status   TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one outstanding pending request per email
CREATE UNIQUE INDEX portal_signup_requests_pending_email_idx
    ON portal_signup_requests(email)
    WHERE status = 'pending_verification';

CREATE INDEX portal_signup_requests_tenant_idx
    ON portal_signup_requests(tenant_id)
    WHERE tenant_id IS NOT NULL;

ENABLE ROW LEVEL SECURITY ON portal_signup_requests;
ALTER TABLE portal_signup_requests FORCE ROW LEVEL SECURITY;

-- Policy: normal tenant access OR bootstrap lookup (used before tenant context is known)
CREATE POLICY portal_signup_requests_rls ON portal_signup_requests
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
        OR current_setting('app.portal_signup_bootstrap', true) = 'true'
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    );

-- ---------------------------------------------------------------------------
-- portal_verification_tokens
-- ---------------------------------------------------------------------------
CREATE TABLE portal_verification_tokens (
    token_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signup_request_id   UUID NOT NULL REFERENCES portal_signup_requests(id),
    -- mirrors the signup_request's tenant_id for RLS; null if not yet resolved
    tenant_id           UUID,
    -- SHA-256 hex of the full raw token (never stored raw)
    token_hash          TEXT NOT NULL UNIQUE,
    expires_at          TIMESTAMPTZ NOT NULL,
    consumed_at         TIMESTAMPTZ,
    attempt_count       INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensures at most one outstanding (unconsumed) token per signup request
CREATE UNIQUE INDEX portal_verification_tokens_outstanding_idx
    ON portal_verification_tokens(signup_request_id)
    WHERE consumed_at IS NULL;

ENABLE ROW LEVEL SECURITY ON portal_verification_tokens;
ALTER TABLE portal_verification_tokens FORCE ROW LEVEL SECURITY;

-- Bootstrap mode: allows hash-based lookup before tenant_id is known
CREATE POLICY portal_verification_tokens_rls ON portal_verification_tokens
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
        OR current_setting('app.portal_signup_bootstrap', true) = 'true'
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
        OR current_setting('app.portal_signup_bootstrap', true) = 'true'
    );

-- ---------------------------------------------------------------------------
-- portal_users
-- ---------------------------------------------------------------------------
CREATE TABLE portal_users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    organization_id     UUID NOT NULL,
    signup_request_id   UUID NOT NULL REFERENCES portal_signup_requests(id),
    email               TEXT NOT NULL,
    name                TEXT NOT NULL,
    role                TEXT NOT NULL DEFAULT 'portal_user',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One portal user per email per tenant
CREATE UNIQUE INDEX portal_users_tenant_email_idx ON portal_users(tenant_id, email);
CREATE INDEX portal_users_tenant_org_idx ON portal_users(tenant_id, organization_id);

ENABLE ROW LEVEL SECURITY ON portal_users;
ALTER TABLE portal_users FORCE ROW LEVEL SECURITY;

CREATE POLICY portal_users_rls ON portal_users
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
