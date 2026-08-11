-- Migration 0013: pending_user_approvals
--
-- Created by: WO-014 Portal self-service signup with business email verification
--
-- Stores signup requests where the email domain did not match any
-- organization_verified_domains entry (zero matches) or matched more than one
-- organisation (ambiguous). Administrators review these and either approve
-- (binding the user to a specific organisation) or reject them.
--
-- Security notes:
--   - tenant_id is NULL until an administrator resolves the request by
--     selecting a target organisation. This is intentional: the applicant's
--     tenancy is unknown before approval.
--   - candidate_organization_ids is a JSONB array of
--     {tenantId, organizationId, organizationName} objects populated when
--     domain matching finds one or more candidates.
--   - RLS uses a bootstrap mode for creation (tenant_id is null at insert time)
--     and tenant-scoped reads after approval.
--   - Cross-tenant approval attempts are rejected at the service layer with
--     an elevated-severity audit record.

-- ---------------------------------------------------------------------------
-- pending_user_approvals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pending_user_approvals (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Null until administrator approves and selects a target organisation.
    -- After approval this carries the approving administrator's tenant_id.
    tenant_id                   UUID,
    signup_request_id           UUID NOT NULL REFERENCES portal_signup_requests(id),
    email                       TEXT NOT NULL,
    applicant_name              TEXT NOT NULL,
    status                      TEXT NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'approved', 'rejected')),
    -- JSONB array of {tenantId, organizationId, organizationName} candidates
    -- discovered by the domain resolver at verification time.
    candidate_organization_ids  JSONB,
    resolved_by                 UUID,
    resolved_at                 TIMESTAMPTZ,
    target_organization_id      UUID,
    rejection_reason            TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One pending approval record per email (prevents duplicate records from
-- email-client prefetch double-verification)
CREATE UNIQUE INDEX IF NOT EXISTS pending_user_approvals_email_pending_idx
    ON pending_user_approvals(email)
    WHERE status = 'pending';

-- Lookup by signup_request_id
CREATE INDEX IF NOT EXISTS pending_user_approvals_signup_request_idx
    ON pending_user_approvals(signup_request_id);

-- Tenant-scoped reads after approval
CREATE INDEX IF NOT EXISTS pending_user_approvals_tenant_idx
    ON pending_user_approvals(tenant_id)
    WHERE tenant_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE pending_user_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_user_approvals FORCE ROW LEVEL SECURITY;

-- Policy:
--   - Bootstrap mode: allows insert/select before tenant_id is known
--     (initial creation at verification time when tenant is not yet resolved)
--   - Normal tenant access: after approval, tenant-scoped visibility
CREATE POLICY pending_user_approvals_rls ON pending_user_approvals
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
        OR current_setting('app.portal_signup_bootstrap', true) = 'true'
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
        OR current_setting('app.portal_signup_bootstrap', true) = 'true'
    );
