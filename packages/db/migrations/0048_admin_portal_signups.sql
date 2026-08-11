-- Migration 0048: Admin approval queue for pending portal signups (WO-091)
--
-- Adds decision columns to portal_signup_requests:
--   decided_by_user_id  — staff user who took the decision
--   decided_at          — when the decision was made
--   decision_reason     — allow-listed reason enum value
--   decision_note       — optional sanitised free-text note (max 500 chars)
--   expires_at          — already added by 0037, ensure default is set
--
-- Adds the 'expired' status guard and composite indexes for the admin queue
-- and expiry purge job.
--
-- Also ensures a unique index on organization_verified_domains (tenant_id, domain)
-- to enforce one-org-per-domain-per-tenant at the DB level (used by the
-- addVerifiedDomain promotion path).

-- ---------------------------------------------------------------------------
-- Decision columns
-- ---------------------------------------------------------------------------

ALTER TABLE portal_signup_requests
  ADD COLUMN IF NOT EXISTS decided_by_user_id  UUID,
  ADD COLUMN IF NOT EXISTS decided_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decision_reason     TEXT,
  ADD COLUMN IF NOT EXISTS decision_note       TEXT;

-- Enforce note length at DB level as a belt-and-suspenders check
ALTER TABLE portal_signup_requests
  DROP CONSTRAINT IF EXISTS portal_signup_requests_decision_note_len;
ALTER TABLE portal_signup_requests
  ADD CONSTRAINT portal_signup_requests_decision_note_len
    CHECK (decision_note IS NULL OR length(decision_note) <= 500);

-- Enforce allow-listed reason values
ALTER TABLE portal_signup_requests
  DROP CONSTRAINT IF EXISTS portal_signup_requests_decision_reason_chk;
ALTER TABLE portal_signup_requests
  ADD CONSTRAINT portal_signup_requests_decision_reason_chk
    CHECK (decision_reason IS NULL OR decision_reason IN (
      'not_a_customer',
      'unrecognised_domain',
      'duplicate_request',
      'security_concern',
      'other'
    ));

-- ---------------------------------------------------------------------------
-- Expand status constraint to include 'expired' (if not already present)
-- ---------------------------------------------------------------------------

ALTER TABLE portal_signup_requests
  DROP CONSTRAINT IF EXISTS portal_signup_requests_status_check;

ALTER TABLE portal_signup_requests
  ADD CONSTRAINT portal_signup_requests_status_check
    CHECK (status IN (
      'pending_verification',
      'pending_admin_approval',
      'verified',
      'rejected',
      'expired'
    ));

-- ---------------------------------------------------------------------------
-- Indexes for admin queue reads (tenant_id, status) and expiry purge
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS portal_signup_requests_tenant_status_idx
  ON portal_signup_requests(tenant_id, status, created_at);

-- expires_at index for the expiry worker
CREATE INDEX IF NOT EXISTS portal_signup_requests_expires_at_idx
  ON portal_signup_requests(expires_at)
  WHERE status IN ('pending_admin_approval', 'expired');

-- ---------------------------------------------------------------------------
-- Unique index on organization_verified_domains (tenant_id, domain)
-- Ensures only one organization per tenant can claim a given verified domain.
-- This is the DB-level guard for the addVerifiedDomain promotion path.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS organization_verified_domains_tenant_domain_uidx
  ON organization_verified_domains(tenant_id, domain)
  WHERE status = 'verified';
