-- Migration: 0010_csat_surveys
-- Creates csat_surveys table and adds CSAT configuration columns to organizations — WO-082.
--
-- Security design:
--   - RLS policy has two branches:
--     1. Normal: tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
--        Uses missing_ok variant so an absent setting returns NULL→FALSE rather than an error.
--     2. Bootstrap: token_hash = current_setting('app.csat_bootstrap_hash', true) when that
--        variable is a 64-char SHA-256 hex string. Used exclusively by CsatTokenGuard to
--        resolve tenant_id from a token before full tenant context is established.
--        The SET LOCAL scope ensures it never bleeds into the next transaction.
--     WITH CHECK only permits writes when the normal tenant context is set.
--   - FORCE ROW LEVEL SECURITY prevents table-owner bypass.
--   - token_hash char(64): stores SHA-256 hex of the raw token; raw token never persisted.
--   - unique index on token_hash (global — enables bootstrap lookup without tenant_id).
--   - unique index on (tenant_id, ticket_id) — at most one survey per resolved ticket.
--   - partial index on (tenant_id, contact_id, sent_at) WHERE responded_at IS NULL for fatigue.
--   - partial index on (tenant_id, responded_at) WHERE responded_at IS NOT NULL for aggregation.
--
-- Organization CSAT config columns (expand-only, backward compatible):
--   csat_enabled boolean default true
--   csat_fatigue_hours int default 72
--   csat_expiry_days int default 14

-- ==========================================================================
-- 1. csat_surveys table
-- ==========================================================================

CREATE TABLE IF NOT EXISTS csat_surveys (
  tenant_id       UUID          NOT NULL,
  id              UUID          NOT NULL DEFAULT gen_random_uuid(),
  ticket_id       UUID          NOT NULL,
  contact_id      UUID,
  token_hash      CHAR(64)      NOT NULL,
  score           SMALLINT,
  comment         TEXT,
  response_source TEXT,
  sent_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  delivered       BOOLEAN       NOT NULL DEFAULT false,
  expires_at      TIMESTAMPTZ   NOT NULL,
  responded_at    TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT csat_surveys_score_check
    CHECK (score IS NULL OR (score BETWEEN 1 AND 5)),
  CONSTRAINT csat_surveys_response_source_check
    CHECK (response_source IS NULL OR response_source IN ('one_click', 'form')),
  CONSTRAINT csat_surveys_token_hash_len_check
    CHECK (char_length(token_hash) = 64)
);

-- Global unique index on token_hash — enables bootstrap lookup across tenants.
CREATE UNIQUE INDEX IF NOT EXISTS csat_surveys_token_hash_uniq
  ON csat_surveys (token_hash);

-- At most one survey per ticket per tenant (idempotent dispatch).
CREATE UNIQUE INDEX IF NOT EXISTS csat_surveys_tenant_ticket_uniq
  ON csat_surveys (tenant_id, ticket_id);

-- Tenant-scoped index for fatigue check: recent surveys per contact.
CREATE INDEX IF NOT EXISTS csat_surveys_tenant_contact_sent_idx
  ON csat_surveys (tenant_id, contact_id, sent_at DESC)
  WHERE responded_at IS NULL;

-- Partial index for aggregation queries (only responded rows).
CREATE INDEX IF NOT EXISTS csat_surveys_tenant_responded_idx
  ON csat_surveys (tenant_id, responded_at)
  WHERE responded_at IS NOT NULL;

-- Tenant-scoped ordering index.
CREATE INDEX IF NOT EXISTS csat_surveys_tenant_created_idx
  ON csat_surveys (tenant_id, created_at DESC);

-- ==========================================================================
-- RLS for csat_surveys
-- ==========================================================================

ALTER TABLE csat_surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE csat_surveys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_csat_surveys ON csat_surveys;
CREATE POLICY tenant_isolation_csat_surveys ON csat_surveys
  USING (
    -- Normal tenant-context path: NULLIF prevents cast error when setting absent.
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    OR (
      -- Bootstrap path: CsatTokenGuard sets this within a SET LOCAL transaction
      -- so it is scoped to one request and cannot bleed across connections.
      -- length check ensures only SHA-256 hex strings (64 chars) trigger this branch.
      length(current_setting('app.csat_bootstrap_hash', true)) = 64
      AND token_hash = current_setting('app.csat_bootstrap_hash', true)
    )
  )
  WITH CHECK (
    -- Writes are always restricted to the normal tenant-context path.
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
  );

-- ==========================================================================
-- 2. Organization CSAT configuration columns (expand-only)
-- ==========================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS csat_enabled      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS csat_fatigue_hours INTEGER NOT NULL DEFAULT 72,
  ADD COLUMN IF NOT EXISTS csat_expiry_days  INTEGER NOT NULL DEFAULT 14;
