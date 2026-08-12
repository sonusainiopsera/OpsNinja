-- Migration 0044: Portal onboarding wizard state + organization change requests (WO-088)
--
-- Tables:
--   portal_onboarding_states   — per-user wizard progress, resumable across sessions.
--   organization_change_requests — admin-reviewable corrections submitted by portal users.

-- ---------------------------------------------------------------------------
-- portal_onboarding_states
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS portal_onboarding_states (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid          NOT NULL,
  user_id           uuid          NOT NULL,
  current_step      text          NOT NULL DEFAULT 'verify-organization',
  steps             jsonb         NOT NULL DEFAULT '{}',
  version           integer       NOT NULL DEFAULT 1,
  completed_at      timestamptz,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now()
);

-- One row per portal user (resumable).
CREATE UNIQUE INDEX IF NOT EXISTS portal_onboarding_states_user_uniq
  ON portal_onboarding_states (tenant_id, user_id);

-- Leading tenant_id index for RLS scan performance.
CREATE INDEX IF NOT EXISTS portal_onboarding_states_tenant_idx
  ON portal_onboarding_states (tenant_id);

ALTER TABLE portal_onboarding_states ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'portal_onboarding_states'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON portal_onboarding_states
      USING (tenant_id = current_setting('app.current_tenant')::uuid);
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- organization_change_requests
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS organization_change_requests (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL,
  organization_id      uuid        NOT NULL,
  requested_by_user_id uuid        NOT NULL,
  fields               jsonb       NOT NULL,
  status               text        NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'applied', 'rejected')),
  reviewer_user_id     uuid,
  decided_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Dedup index: prevent identical pending change requests from the same user.
-- Hashes the fields JSONB so structural equality is enforced without a full scan.
CREATE UNIQUE INDEX IF NOT EXISTS org_change_requests_dedup_idx
  ON organization_change_requests (tenant_id, organization_id, requested_by_user_id, (fields::text))
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS org_change_requests_tenant_org_idx
  ON organization_change_requests (tenant_id, organization_id);

CREATE INDEX IF NOT EXISTS org_change_requests_status_idx
  ON organization_change_requests (tenant_id, status);

ALTER TABLE organization_change_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'organization_change_requests'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON organization_change_requests
      USING (tenant_id = current_setting('app.current_tenant')::uuid);
  END IF;
END$$;
