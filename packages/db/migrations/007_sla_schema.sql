-- Migration 007: SLA Policy and Business Calendar Schema
-- Expand-only migration: additive DDL only, no destructive statements.
-- All five tables carry tenant_id-leading keys, ENABLE + FORCE ROW LEVEL SECURITY
-- and a USING / WITH CHECK policy bound to app.current_tenant.

-- ── Enums ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sla_priority') THEN
    CREATE TYPE sla_priority AS ENUM ('P1', 'P2', 'P3', 'P4');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sla_calendar_type') THEN
    CREATE TYPE sla_calendar_type AS ENUM ('business_hours', 'twenty_four_seven');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sla_scope_type') THEN
    CREATE TYPE sla_scope_type AS ENUM ('tenant', 'organization', 'ticket_type');
  END IF;
END$$;

-- ── sla_calendars ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sla_calendars (
  id          UUID             NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   UUID             NOT NULL,
  name        TEXT             NOT NULL,
  calendar_type sla_calendar_type NOT NULL,
  timezone    TEXT             NOT NULL,
  is_active   BOOLEAN          NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ      NOT NULL DEFAULT now(),
  created_by  UUID             NOT NULL,
  updated_by  UUID             NOT NULL,

  CONSTRAINT sla_calendars_pkey PRIMARY KEY (id)
);

ALTER TABLE sla_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_calendars FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_sla_calendars
  ON sla_calendars
  AS PERMISSIVE FOR ALL
  USING  (tenant_id = current_setting('app.current_tenant', TRUE)::UUID)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);

CREATE INDEX IF NOT EXISTS sla_calendars_tenant_idx
  ON sla_calendars (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS sla_calendars_tenant_name_uidx
  ON sla_calendars (tenant_id, name)
  WHERE is_active = TRUE;

-- ── sla_calendar_windows ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sla_calendar_windows (
  id               UUID     NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        UUID     NOT NULL,
  calendar_id      UUID     NOT NULL,
  -- 0=Sunday, 1=Monday, ..., 6=Saturday (ISO-compatible with JS getDay())
  weekday          SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_local_time TIME     NOT NULL,
  end_local_time   TIME     NOT NULL,

  CONSTRAINT sla_calendar_windows_pkey PRIMARY KEY (id),
  CONSTRAINT sla_calendar_windows_time_order
    CHECK (start_local_time < end_local_time),
  CONSTRAINT sla_calendar_windows_calendar_fk
    FOREIGN KEY (calendar_id) REFERENCES sla_calendars (id) ON DELETE CASCADE
);

ALTER TABLE sla_calendar_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_calendar_windows FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_sla_calendar_windows
  ON sla_calendar_windows
  AS PERMISSIVE FOR ALL
  USING  (tenant_id = current_setting('app.current_tenant', TRUE)::UUID)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);

CREATE INDEX IF NOT EXISTS sla_calendar_windows_tenant_cal_idx
  ON sla_calendar_windows (tenant_id, calendar_id);

-- ── sla_calendar_holidays ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sla_calendar_holidays (
  id           UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  calendar_id  UUID NOT NULL,
  holiday_date DATE NOT NULL,
  label        TEXT NOT NULL,

  CONSTRAINT sla_calendar_holidays_pkey PRIMARY KEY (id),
  CONSTRAINT sla_calendar_holidays_calendar_fk
    FOREIGN KEY (calendar_id) REFERENCES sla_calendars (id) ON DELETE CASCADE
);

ALTER TABLE sla_calendar_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_calendar_holidays FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_sla_calendar_holidays
  ON sla_calendar_holidays
  AS PERMISSIVE FOR ALL
  USING  (tenant_id = current_setting('app.current_tenant', TRUE)::UUID)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);

CREATE INDEX IF NOT EXISTS sla_calendar_holidays_tenant_cal_idx
  ON sla_calendar_holidays (tenant_id, calendar_id);

CREATE UNIQUE INDEX IF NOT EXISTS sla_calendar_holidays_date_uidx
  ON sla_calendar_holidays (tenant_id, calendar_id, holiday_date);

-- ── sla_policies ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sla_policies (
  id                    UUID           NOT NULL DEFAULT gen_random_uuid(),
  tenant_id             UUID           NOT NULL,
  scope_type            sla_scope_type NOT NULL DEFAULT 'tenant',
  scope_id              UUID,
  priority              sla_priority   NOT NULL,
  response_target_mins  INTEGER        NOT NULL,
  resolution_target_mins INTEGER       NOT NULL,
  calendar_id           UUID           NOT NULL,
  reminder_pct_first    INTEGER        NOT NULL,
  reminder_pct_second   INTEGER        NOT NULL,
  is_active             BOOLEAN        NOT NULL DEFAULT TRUE,
  targets_ratified      BOOLEAN        NOT NULL DEFAULT FALSE,
  version               INTEGER        NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ    NOT NULL DEFAULT now(),
  created_by            UUID           NOT NULL,
  updated_by            UUID           NOT NULL,

  CONSTRAINT sla_policies_pkey PRIMARY KEY (id),
  CONSTRAINT sla_policies_response_positive
    CHECK (response_target_mins > 0 AND response_target_mins <= 43200),
  CONSTRAINT sla_policies_resolution_positive
    CHECK (resolution_target_mins > 0 AND resolution_target_mins <= 43200),
  CONSTRAINT sla_policies_reminder_order
    CHECK (reminder_pct_first > 0
       AND reminder_pct_first < reminder_pct_second
       AND reminder_pct_second < 100),
  CONSTRAINT sla_policies_resolution_gte_response
    CHECK (resolution_target_mins >= response_target_mins),
  CONSTRAINT sla_policies_calendar_fk
    FOREIGN KEY (calendar_id) REFERENCES sla_calendars (id)
);

ALTER TABLE sla_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_sla_policies
  ON sla_policies
  AS PERMISSIVE FOR ALL
  USING  (tenant_id = current_setting('app.current_tenant', TRUE)::UUID)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);

CREATE INDEX IF NOT EXISTS sla_policies_tenant_idx
  ON sla_policies (tenant_id);

-- Unique active policy per (tenant, scope_type, scope_id, priority)
-- scope_id may be NULL for tenant-level policies; NULL IS NOT DISTINCT FROM NULL applies.
CREATE UNIQUE INDEX IF NOT EXISTS sla_policies_tenant_scope_priority_uidx
  ON sla_policies (tenant_id, scope_type, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), priority)
  WHERE is_active = TRUE;

-- ── sla_policy_versions (append-only snapshot) ────────────────────────────────

CREATE TABLE IF NOT EXISTS sla_policy_versions (
  id          UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL,
  policy_id   UUID        NOT NULL,
  version     INTEGER     NOT NULL,
  payload     JSONB       NOT NULL,
  changed_by  UUID        NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT sla_policy_versions_pkey PRIMARY KEY (id),
  CONSTRAINT sla_policy_versions_unique_version
    UNIQUE (policy_id, version),
  CONSTRAINT sla_policy_versions_policy_fk
    FOREIGN KEY (policy_id) REFERENCES sla_policies (id) ON DELETE CASCADE
);

ALTER TABLE sla_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_policy_versions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_sla_policy_versions
  ON sla_policy_versions
  AS PERMISSIVE FOR ALL
  USING  (tenant_id = current_setting('app.current_tenant', TRUE)::UUID)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE)::UUID);

CREATE INDEX IF NOT EXISTS sla_policy_versions_policy_idx
  ON sla_policy_versions (tenant_id, policy_id);

-- Append-only enforcement: no UPDATE or DELETE on sla_policy_versions
CREATE OR REPLACE FUNCTION sla_policy_versions_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'sla_policy_versions is append-only: UPDATE and DELETE are forbidden';
END;
$$;

DROP TRIGGER IF EXISTS trg_sla_policy_versions_append_only ON sla_policy_versions;

CREATE TRIGGER trg_sla_policy_versions_append_only
  BEFORE UPDATE OR DELETE ON sla_policy_versions
  FOR EACH ROW EXECUTE FUNCTION sla_policy_versions_append_only();
