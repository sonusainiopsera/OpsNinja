-- Migration: 0017_verified_domains_lifecycle
-- Adds lifecycle state machine columns to organization_verified_domains.
--
-- The table gains:
--   status              TEXT   'pending' | 'verified' | 'revoked'
--   include_subdomains  BOOL   wildcard policy
--   challenge_token_hash TEXT  SHA-256 hex of the 32-byte challenge token
--   verified_by         UUID   staff user who triggered verification
--   revoked_at          TIMESTAMPTZ  soft-revocation timestamp
--
-- The verified_via column (already present) is updated to also accept
-- 'admin_override' in addition to 'dns_txt'.
--
-- The existing per-tenant unique index on lower(domain) is retained.

ALTER TABLE organization_verified_domains
  ADD COLUMN IF NOT EXISTS status               TEXT        NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS include_subdomains   BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS challenge_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS verified_by          UUID,
  ADD COLUMN IF NOT EXISTS revoked_at           TIMESTAMPTZ;

-- Only 'pending', 'verified', 'revoked' are valid states.
ALTER TABLE organization_verified_domains
  DROP CONSTRAINT IF EXISTS org_verified_domains_status_check;
ALTER TABLE organization_verified_domains
  ADD CONSTRAINT org_verified_domains_status_check
  CHECK (status IN ('pending', 'verified', 'revoked'));

-- Only allow accepted verification methods.
ALTER TABLE organization_verified_domains
  DROP CONSTRAINT IF EXISTS org_verified_domains_via_check;
ALTER TABLE organization_verified_domains
  ADD CONSTRAINT org_verified_domains_via_check
  CHECK (verified_via IN ('dns_txt', 'admin_override'));

-- Index for status-filtered lookups (resolver queries active verified domains).
CREATE INDEX IF NOT EXISTS org_verified_domains_tenant_status_idx
  ON organization_verified_domains (tenant_id, status);

-- Index for wildcard resolver queries (include_subdomains lookups).
CREATE INDEX IF NOT EXISTS org_verified_domains_tenant_subdomain_idx
  ON organization_verified_domains (tenant_id, include_subdomains)
  WHERE status = 'verified';
