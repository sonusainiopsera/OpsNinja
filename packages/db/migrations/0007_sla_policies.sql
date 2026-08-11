-- Migration: 0007_sla_policies
-- Creates SLA policy, policy version, and calendar tables — WO-044.
--
-- RLS policies use:
--   USING       (tenant_id = current_setting('app.current_tenant')::uuid)
--   WITH CHECK  (tenant_id = current_setting('app.current_tenant')::uuid)
-- The ::uuid cast fails on an empty string (fail-closed behaviour).
--
-- sla_policy_versions is append-only; a trigger prevents UPDATE/DELETE.
--
-- Expand-only migration: additive DDL only, no destructive statements.

-- ==========================================================================
-- 1. sla_calendars
-- ==========================================================================

CREATE TABLE IF NOT EXISTS sla_calendars (
  id              UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL,
  name            TEXT        NOT NULL,
  calendar_type   TEXT        NOT NULL,
  timezone        TEXT        NOT NULL,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT sla_calendars_type_check
    CHECK (calendar_type IN ('business_hours', 'twenty_four_seven'))
);

CREATE INDEX IF NOT EXISTS sla_calendars_tenant_id_idx
  ON sla_calendars (tenant_id);

CREATE INDEX IF NOT EXISTS sla_calendars_tenant_name_idx
  ON sla_calendars (tenant_id, name);

ALTER TABLE sla_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_calendars FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_sla_calendars ON sla_calendars;
CREATE POLICY tenant_isolation_sla_calendars ON sla_calendars
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ==========================================================================
-- 2. sla_calendar_windows
-- ==========================================================================

CREATE TABLE IF NOT EXISTS sla_calendar_windows (
  id               UUID     NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        UUID     NOT NULL,
  calendar_id      UUID     NOT NULL,
  weekday          SMALLINT NOT NULL,
  start_local_time TIME     NOT NULL,
  end_local_time   TIME     NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT sla_calendar_windows_weekday_check
    CHECK (weekday BETWEEN 0 AND 6),
  CONSTRAINT sla_calendar_windows_time_order_check
    CHECK (start_local_time < end_local_time),
  CONSTRAINT sla_calendar_windows_calendar_fk
    FOREIGN KEY (tenant_id, calendar_id)
    REFERENCES sla_calendars (tenant_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS sla_calendar_windows_tenant_calendar_idx
  ON sla_calendar_windows (tenant_id, calendar_id);

ALTER TABLE sla_calendar_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_calendar_windows FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_sla_calendar_windows ON sla_calendar_windows;
CREATE POLICY tenant_isolation_sla_calendar_windows ON sla_calendar_windows
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ==========================================================================
-- 3. sla_calendar_holidays
-- ==========================================================================

CREATE TABLE IF NOT EXISTS sla_calendar_holidays (
  id            UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  calendar_id   UUID NOT NULL,
  holiday_date  DATE NOT NULL,
  label         TEXT NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT sla_calendar_holidays_calendar_fk
    FOREIGN KEY (tenant_id, calendar_id)
    REFERENCES sla_calendars (tenant_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS sla_calendar_holidays_tenant_calendar_idx
  ON sla_calendar_holidays (tenant_id, calendar_id);

CREATE UNIQUE INDEX IF NOT EXISTS sla_calendar_holidays_date_uniq
  ON sla_calendar_holidays (tenant_id, calendar_id, holiday_date);

ALTER TABLE sla_calendar_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_calendar_holidays FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_sla_calendar_holidays ON sla_calendar_holidays;
CREATE POLICY tenant_isolation_sla_calendar_holidays ON sla_calendar_holidays
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ==========================================================================
-- 4. sla_policies
-- ==========================================================================

CREATE TABLE IF NOT EXISTS sla_policies (
  id                      UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id               UUID        NOT NULL,
  scope_type              TEXT        NOT NULL DEFAULT 'tenant',
  scope_id                UUID,
  priority                TEXT        NOT NULL,
  response_target_mins    INTEGER     NOT NULL,
  resolution_target_mins  INTEGER     NOT NULL,
  calendar_id             UUID        NOT NULL,
  reminder_pct_first      INTEGER     NOT NULL DEFAULT 50,
  reminder_pct_second     INTEGER     NOT NULL DEFAULT 75,
  is_active               BOOLEAN     NOT NULL DEFAULT true,
  targets_ratified        BOOLEAN     NOT NULL DEFAULT false,
  version                 INTEGER     NOT NULL DEFAULT 1,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by              UUID,
  updated_by              UUID,
  PRIMARY KEY (id),
  CONSTRAINT sla_policies_priority_check
    CHECK (priority IN ('P1', 'P2', 'P3', 'P4')),
  CONSTRAINT sla_policies_scope_type_check
    CHECK (scope_type IN ('tenant', 'organization', 'custom')),
  CONSTRAINT sla_policies_response_target_check
    CHECK (response_target_mins > 0 AND response_target_mins <= 43200),
  CONSTRAINT sla_policies_resolution_target_check
    CHECK (resolution_target_mins > 0 AND resolution_target_mins <= 43200),
  CONSTRAINT sla_policies_reminder_order_check
    CHECK (reminder_pct_first < reminder_pct_second AND reminder_pct_second < 100),
  CONSTRAINT sla_policies_reminder_nonzero_check
    CHECK (reminder_pct_first > 0),
  CONSTRAINT sla_policies_calendar_fk
    FOREIGN KEY (tenant_id, calendar_id)
    REFERENCES sla_calendars (tenant_id, id)
);

-- Composite FK target on sla_calendars.
ALTER TABLE sla_calendars
  DROP CONSTRAINT IF EXISTS sla_calendars_tenant_id_id_uniq;
ALTER TABLE sla_calendars
  ADD CONSTRAINT sla_calendars_tenant_id_id_uniq
  UNIQUE (tenant_id, id);

CREATE INDEX IF NOT EXISTS sla_policies_tenant_id_idx
  ON sla_policies (tenant_id);

CREATE INDEX IF NOT EXISTS sla_policies_tenant_scope_priority_idx
  ON sla_policies (tenant_id, scope_type, scope_id, priority);

-- Unique partial index: exactly one active policy per (tenant, scope, priority).
CREATE UNIQUE INDEX IF NOT EXISTS sla_policies_active_scope_priority_uniq
  ON sla_policies (tenant_id, scope_type, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), priority)
  WHERE is_active = true;

ALTER TABLE sla_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_policies FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_sla_policies ON sla_policies;
CREATE POLICY tenant_isolation_sla_policies ON sla_policies
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ==========================================================================
-- 5. sla_policy_versions (append-only)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS sla_policy_versions (
  id          UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL,
  policy_id   UUID        NOT NULL,
  version     INTEGER     NOT NULL,
  payload     JSONB       NOT NULL,
  changed_by  UUID,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT sla_policy_versions_policy_fk
    FOREIGN KEY (policy_id)
    REFERENCES sla_policies (id)
);

CREATE INDEX IF NOT EXISTS sla_policy_versions_tenant_policy_idx
  ON sla_policy_versions (tenant_id, policy_id);

-- Unique version per policy.
CREATE UNIQUE INDEX IF NOT EXISTS sla_policy_versions_policy_version_uniq
  ON sla_policy_versions (policy_id, version);

ALTER TABLE sla_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_policy_versions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_sla_policy_versions ON sla_policy_versions;
CREATE POLICY tenant_isolation_sla_policy_versions ON sla_policy_versions
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ==========================================================================
-- 6. Append-only trigger on sla_policy_versions
-- ==========================================================================

CREATE OR REPLACE FUNCTION prevent_sla_policy_version_modification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'sla_policy_versions is append-only; UPDATE and DELETE are not permitted';
END;
$$;

DROP TRIGGER IF EXISTS sla_policy_versions_append_only ON sla_policy_versions;
CREATE TRIGGER sla_policy_versions_append_only
  BEFORE UPDATE OR DELETE ON sla_policy_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_sla_policy_version_modification();
