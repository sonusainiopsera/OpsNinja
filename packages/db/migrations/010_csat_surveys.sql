-- Migration 010: CSAT surveys and per-organization configuration
-- Expand-only: no destructive DDL.

-- ── csat_surveys ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS csat_surveys (
  -- tenant_id is the leading key of every index (RLS + sharding compatibility)
  tenant_id          uuid            NOT NULL,
  id                 uuid            NOT NULL DEFAULT gen_random_uuid(),
  ticket_id          uuid            NOT NULL,
  contact_id         uuid            NOT NULL,
  -- SHA-256 hex of the raw base64url transport token (64 chars, lowercase)
  token_hash         char(64)        NOT NULL,
  -- 1..5 nullable until responded
  score              smallint        NULL      CHECK (score BETWEEN 1 AND 5),
  -- Confidential-tier free text; masked in logs, included in GDPR erasure
  comment            text            NULL,
  response_source    text            NULL      CHECK (response_source IN ('one_click', 'form')),
  sent_at            timestamptz     NOT NULL  DEFAULT now(),
  -- true only after delivery confirmation; false when bounced/suppressed
  delivered          boolean         NOT NULL  DEFAULT true,
  expires_at         timestamptz     NOT NULL,
  responded_at       timestamptz     NULL,
  reminder_sent_at   timestamptz     NULL,

  PRIMARY KEY (tenant_id, id)
);

-- Tenant-leading indexes (isolation and lookup performance)
CREATE UNIQUE INDEX IF NOT EXISTS csat_surveys_tenant_ticket_uidx
  ON csat_surveys (tenant_id, ticket_id);

CREATE UNIQUE INDEX IF NOT EXISTS csat_surveys_token_hash_uidx
  ON csat_surveys (token_hash);

-- Partial index for aggregation queries (only rows with responses)
CREATE INDEX IF NOT EXISTS csat_surveys_tenant_responded_idx
  ON csat_surveys (tenant_id, responded_at)
  WHERE responded_at IS NOT NULL;

-- Lookup index for fatigue-window check (most-recent survey per contact)
CREATE INDEX IF NOT EXISTS csat_surveys_tenant_contact_sent_idx
  ON csat_surveys (tenant_id, contact_id, sent_at DESC);

-- ── Row-level security ────────────────────────────────────────────────────────

ALTER TABLE csat_surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE csat_surveys FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS csat_surveys_tenant_isolation ON csat_surveys;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

CREATE POLICY csat_surveys_tenant_isolation ON csat_surveys
  AS PERMISSIVE
  FOR ALL
  USING     (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ── Organization CSAT configuration columns (expand-only) ────────────────────
-- These columns are added only if they do not already exist so that the
-- migration is idempotent on replayed runs.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS csat_enabled       boolean  NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS csat_fatigue_hours integer  NOT NULL DEFAULT 72,
  ADD COLUMN IF NOT EXISTS csat_expiry_days   integer  NOT NULL DEFAULT 14;
