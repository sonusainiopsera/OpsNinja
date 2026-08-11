-- Migration 0037: Enhance portal_signup_requests and add signup_blocked_domains
--
-- Adds columns required by the WO-086 self-service signup flow:
--   email_hash       — SHA-256 of the normalised email (PII-free audit/suppression)
--   full_name        — optional applicant display name (replaces applicant_name for new rows)
--   source_ip        — client IP at submission (text for portability)
--   user_agent       — client user-agent string for audit
--   expires_at       — when this signup request should be purged
--
-- Expands the status check constraint to include pending_admin_approval
-- (domain-unmatched submissions that require admin review).
--
-- Creates signup_blocked_domains for the in-process blocklist cache.

-- ---------------------------------------------------------------------------
-- Add new columns to portal_signup_requests
-- ---------------------------------------------------------------------------

ALTER TABLE portal_signup_requests
  ADD COLUMN IF NOT EXISTS email_hash TEXT,
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS source_ip TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- Expand status check constraint to include pending_admin_approval
-- ---------------------------------------------------------------------------

-- Drop existing inline constraint (PostgreSQL default name)
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
-- Partial unique index for pending_admin_approval
-- (pending_verification already has one from migration 0012)
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS portal_signup_requests_pending_approval_email_idx
  ON portal_signup_requests(email)
  WHERE status = 'pending_admin_approval';

-- ---------------------------------------------------------------------------
-- Composite index for approval queue and expiry purge job
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS portal_signup_requests_status_created_idx
  ON portal_signup_requests(status, created_at);

-- ---------------------------------------------------------------------------
-- signup_blocked_domains
-- No RLS: this is a cross-tenant operator table, readable by the app role.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS signup_blocked_domains (
  domain      TEXT PRIMARY KEY,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed a minimal set of common free/disposable providers.
-- Operators add rows directly; the app refreshes its in-process cache every 5 min.
INSERT INTO signup_blocked_domains (domain, reason) VALUES
  ('gmail.com',      'free_mail'),
  ('yahoo.com',      'free_mail'),
  ('hotmail.com',    'free_mail'),
  ('outlook.com',    'free_mail'),
  ('aol.com',        'free_mail'),
  ('icloud.com',     'free_mail'),
  ('live.com',       'free_mail'),
  ('me.com',         'free_mail'),
  ('protonmail.com', 'free_mail'),
  ('mailinator.com', 'disposable'),
  ('guerrillamail.com', 'disposable'),
  ('tempmail.com',   'disposable'),
  ('throwam.com',    'disposable'),
  ('yopmail.com',    'disposable')
ON CONFLICT (domain) DO NOTHING;
