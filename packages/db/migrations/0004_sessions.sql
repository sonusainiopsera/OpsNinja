-- =============================================================================
-- WO-005: Refresh Sessions — family-based rotation tracking
-- Description:
--   Creates the refresh_sessions table with the full schema required for
--   rotating refresh-token sessions, including family_id and rotated_at
--   columns needed for reuse detection and family-level revocation.
--
--   This migration runs BEFORE 0009_identity_rls.sql (lexicographic order).
--   Migration 0009 uses CREATE TABLE IF NOT EXISTS refresh_sessions, which
--   will be a no-op once this migration has run. Migration 0009 then applies
--   RLS policies and grants — those statements are idempotent.
--
--   Schema:
--     tenant_id       — leading PK column (tenant-scoped access)
--     id              — session UUID
--     user_id         — owning user
--     family_id       — all rotated children share the same family_id;
--                       a single reuse event revokes the whole family
--     token_hash      — SHA-256(raw_refresh_token); plaintext never stored
--     issued_at       — when this session was created
--     expires_at      — absolute TTL (8 hours from issued_at)
--     rotated_at      — NULL = still active; non-NULL = superseded by a newer
--                       session; presenting a rotated token triggers family
--                       revocation (reuse detection)
--     revoked_at      — explicit revocation (logout / admin action)
--     user_agent_hash — SHA-256(User-Agent) for anomaly detection
--     ip_hash         — SHA-256(client IP) for anomaly detection
--
--   Indexes:
--     UNIQUE (token_hash)                  — fast O(1) token lookup
--     (tenant_id, user_id) WHERE active    — admin revocation query
--     (tenant_id, family_id)               — family revocation sweep
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS refresh_sessions (
  tenant_id       uuid        NOT NULL REFERENCES tenants(id),
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL,
  family_id       uuid        NOT NULL DEFAULT gen_random_uuid(),
  token_hash      text        NOT NULL,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  rotated_at      timestamptz,
  revoked_at      timestamptz,
  user_agent_hash text,
  ip_hash         text,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (token_hash),
  CONSTRAINT fk_sessions_user
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES users(tenant_id, id)
);

COMMENT ON TABLE  refresh_sessions IS
  'Server-tracked rotating refresh-token sessions. '
  'family_id groups all rotated children; reuse of a rotated token revokes the whole family.';
COMMENT ON COLUMN refresh_sessions.token_hash    IS 'SHA-256 of the raw refresh token. Plaintext must never be stored.';
COMMENT ON COLUMN refresh_sessions.family_id     IS 'Shared across all rotation children. Reuse detection revokes every row with this family_id.';
COMMENT ON COLUMN refresh_sessions.rotated_at    IS 'Set when this session is superseded by a rotation. NULL = still active.';
COMMENT ON COLUMN refresh_sessions.revoked_at    IS 'Set on explicit logout or admin revocation.';
COMMENT ON COLUMN refresh_sessions.user_agent_hash IS 'SHA-256(User-Agent) — anomaly detection without PII retention.';
COMMENT ON COLUMN refresh_sessions.ip_hash         IS 'SHA-256(client IP) — anomaly detection without PII retention.';

-- Active sessions: primary query path for token validation.
CREATE INDEX IF NOT EXISTS idx_refresh_sessions_active
  ON refresh_sessions (tenant_id, user_id)
  WHERE revoked_at IS NULL AND rotated_at IS NULL;

-- Token lookup by hash (fastest path: O(1) for any refresh/logout request).
CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_sessions_token_hash
  ON refresh_sessions (token_hash);

-- Family sweep: used when reuse is detected to revoke the entire family.
CREATE INDEX IF NOT EXISTS idx_refresh_sessions_family
  ON refresh_sessions (tenant_id, family_id);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- Note: app_current_tenant() is not yet defined at this point in the
-- migration sequence (it is created by 0009). We use the raw
-- current_setting() call here, consistent with migration 0002.
-- Migration 0009 drops and re-creates this policy using app_current_tenant().
-- ---------------------------------------------------------------------------
ALTER TABLE refresh_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON refresh_sessions;
CREATE POLICY tenant_isolation ON refresh_sessions
  USING      (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

COMMIT;
