-- =============================================================================
-- OpsNinja IdP Connection Config and User External-Subject Index
-- Version: 0010
-- Description:
--   1. Creates `idp_connections` table: per-tenant OIDC provider configuration
--      (issuer, client_id, client_secret_ref, scopes, allowed_email_domains,
--      redirect_uri, jwks_uri). client_secret_ref is a reference into Secrets
--      Manager; the raw secret value is never stored in the DB.
--   2. Adds a unique partial index on users(tenant_id, external_subject) to
--      support OIDC-subject-based user upsert without collisions.
--   3. Applies ENABLE + FORCE Row-Level Security on idp_connections.
--
-- Invariants:
--   - client_secret_ref is a reference path, NOT the secret value.
--   - Only one enabled connection per tenant (partial unique index).
--   - Expand-only; no destructive DDL.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. IDP CONNECTIONS TABLE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS idp_connections (
  tenant_id             uuid        NOT NULL REFERENCES tenants(id),
  id                    uuid        NOT NULL DEFAULT gen_random_uuid(),
  issuer                text        NOT NULL,
  client_id             text        NOT NULL,
  client_secret_ref     text        NOT NULL,
  scopes                text[]      NOT NULL DEFAULT ARRAY['openid', 'email', 'profile'],
  allowed_email_domains text[]      NOT NULL DEFAULT '{}',
  redirect_uri          text        NOT NULL,
  jwks_uri              text,
  discovery_url         text,
  enabled               boolean     NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

COMMENT ON TABLE idp_connections IS
  'Per-tenant enterprise OIDC provider configuration. '
  'client_secret_ref points to AWS Secrets Manager; raw secret is never stored here.';

COMMENT ON COLUMN idp_connections.client_secret_ref IS
  'Secret Manager reference path for the OIDC client secret; never the raw value.';

-- Only one active (enabled) connection per tenant at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_idp_connections_tenant_enabled
  ON idp_connections (tenant_id)
  WHERE enabled = true;

-- ---------------------------------------------------------------------------
-- 2. RLS on idp_connections
-- ---------------------------------------------------------------------------
ALTER TABLE idp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE idp_connections FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON idp_connections
  AS PERMISSIVE FOR ALL
  USING (tenant_id = app_current_tenant());

-- ---------------------------------------------------------------------------
-- 3. USERS: unique index on (tenant_id, external_subject)
--    Allows upsert on the stable OIDC sub claim instead of email.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_tenant_external_subject
  ON users (tenant_id, external_subject)
  WHERE external_subject IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. GRANTS
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON idp_connections TO app_user;

COMMIT;
