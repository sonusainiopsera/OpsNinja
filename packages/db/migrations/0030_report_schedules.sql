-- WO-075: Scheduled Report Delivery With Idempotent Dispatch
--
-- report_schedules: durable Postgres-backed schedule rows claimed with
--   FOR UPDATE SKIP LOCKED (mirrors SLA timer scheduler pattern).
--
-- report_schedule_occurrences: one row per (tenant_id, schedule_id, fire_at)
--   protected by unique index — the idempotency gate that prevents duplicate
--   export + email dispatch regardless of crash, restart, or SQS redelivery.
--
-- external_recipient_allowlist: audited list of approved external email
--   addresses that bypass the verified-domain check. Defaults to deny.

-- ---------------------------------------------------------------------------
-- report_schedules
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS report_schedules (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL,
  report_definition_id  uuid        NOT NULL,
  cadence               text        NOT NULL CHECK (cadence IN ('daily', 'weekly', 'monthly', 'custom')),
  cron_expression       text        NOT NULL,
  timezone              text        NOT NULL DEFAULT 'UTC',
  format                text        NOT NULL DEFAULT 'csv' CHECK (format IN ('csv', 'pdf')),
  recipients            jsonb       NOT NULL DEFAULT '[]',
  enabled               boolean     NOT NULL DEFAULT true,
  next_fire_at          timestamptz,
  last_fired_at         timestamptz,
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_schedules FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON report_schedules
  USING (tenant_id::text = current_setting('app.current_tenant', true));

-- Claim scan: only enabled rows with a due next_fire_at (partial keeps it tiny).
CREATE INDEX IF NOT EXISTS report_schedules_claim_idx
  ON report_schedules (next_fire_at)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS report_schedules_tenant_id_idx
  ON report_schedules (tenant_id);

CREATE INDEX IF NOT EXISTS report_schedules_definition_id_idx
  ON report_schedules (tenant_id, report_definition_id);

-- ---------------------------------------------------------------------------
-- report_schedule_occurrences
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS report_schedule_occurrences (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  schedule_id     uuid        NOT NULL,
  fire_at         timestamptz NOT NULL,
  -- Deterministic key: sha256(tenant_id || ':' || schedule_id || ':' || trunc(fire_at, minute))
  -- Unique constraint is the idempotency gate.
  occurrence_key  text        NOT NULL,
  export_job_id   uuid,
  status          text        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'dispatched', 'completed', 'failed', 'skipped')),
  attempts        integer     NOT NULL DEFAULT 0,
  error_code      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE report_schedule_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_schedule_occurrences FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON report_schedule_occurrences
  USING (tenant_id::text = current_setting('app.current_tenant', true));

-- THE idempotency gate: ON CONFLICT DO NOTHING on this index prevents duplicate dispatch.
CREATE UNIQUE INDEX IF NOT EXISTS report_schedule_occurrences_key_uniq
  ON report_schedule_occurrences (occurrence_key);

CREATE INDEX IF NOT EXISTS report_schedule_occurrences_tenant_id_idx
  ON report_schedule_occurrences (tenant_id);

CREATE INDEX IF NOT EXISTS report_schedule_occurrences_schedule_idx
  ON report_schedule_occurrences (tenant_id, schedule_id, fire_at DESC);

-- ---------------------------------------------------------------------------
-- external_recipient_allowlist
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS external_recipient_allowlist (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  email        text        NOT NULL,
  -- approved_by is the user_id of the Lead who added this entry (audited).
  approved_by  uuid        NOT NULL,
  approved_at  timestamptz NOT NULL DEFAULT now(),
  note         text,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE external_recipient_allowlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_recipient_allowlist FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON external_recipient_allowlist
  USING (tenant_id::text = current_setting('app.current_tenant', true));

-- Active allowlist entries (non-revoked) deduplicated per email per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS external_recipient_allowlist_email_uniq
  ON external_recipient_allowlist (tenant_id, lower(email))
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS external_recipient_allowlist_tenant_idx
  ON external_recipient_allowlist (tenant_id);
