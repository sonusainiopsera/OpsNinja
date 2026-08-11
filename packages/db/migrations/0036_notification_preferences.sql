-- Migration 0036: notification_preferences table (WO-081)
--
-- Stores per-contact and per-organization notification channel preferences.
-- Scope 'contact' rows let a specific portal contact opt out of a category.
-- Scope 'organization' rows set the default for all contacts in that org.
--
-- Uniqueness is enforced by two partial unique indexes (COALESCE not supported in a
-- single unique index in older Postgres; partial indexes are equivalent here):
--   1. Contact-level: (tenant_id, contact_id, event_type, channel) WHERE scope = 'contact'
--   2. Org-level:    (tenant_id, organization_id, event_type, channel) WHERE scope = 'organization'
--
-- RLS: enabled + FORCE ROW LEVEL SECURITY so the application role cannot bypass
-- the tenant predicate even with SET LOCAL.

CREATE TABLE IF NOT EXISTS notification_preferences (
    id              uuid          NOT NULL DEFAULT gen_random_uuid(),
    tenant_id       uuid          NOT NULL,
    scope           text          NOT NULL CHECK (scope IN ('contact', 'organization')),
    contact_id      uuid,
    organization_id uuid          NOT NULL,
    event_type      text          NOT NULL,
    channel         text          NOT NULL DEFAULT 'email',
    mode            text          NOT NULL DEFAULT 'immediate' CHECK (mode IN ('immediate', 'off')),
    updated_by      uuid          NOT NULL,
    updated_at      timestamptz   NOT NULL DEFAULT now(),

    -- contact_id required when scope = 'contact', must be null for 'organization'
    CONSTRAINT notification_prefs_contact_scope_check
        CHECK (
            (scope = 'contact'       AND contact_id IS NOT NULL) OR
            (scope = 'organization'  AND contact_id IS NULL)
        ),

    PRIMARY KEY (tenant_id, id)
);

-- ── Partial unique indexes ──────────────────────────────────────────────────

-- One preference row per (contact, event_type, channel) pair.
CREATE UNIQUE INDEX IF NOT EXISTS notification_prefs_contact_uniq
    ON notification_preferences (tenant_id, contact_id, event_type, channel)
    WHERE scope = 'contact';

-- One preference row per (org, event_type, channel) pair for org defaults.
CREATE UNIQUE INDEX IF NOT EXISTS notification_prefs_org_uniq
    ON notification_preferences (tenant_id, organization_id, event_type, channel)
    WHERE scope = 'organization';

-- ── Supporting indexes ──────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS notification_prefs_tenant_contact_idx
    ON notification_preferences (tenant_id, contact_id);

CREATE INDEX IF NOT EXISTS notification_prefs_tenant_org_idx
    ON notification_preferences (tenant_id, organization_id);

CREATE INDEX IF NOT EXISTS notification_prefs_tenant_event_idx
    ON notification_preferences (tenant_id, event_type, channel);

-- ── Row-level security ──────────────────────────────────────────────────────

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;

CREATE POLICY notification_preferences_tenant_isolation
    ON notification_preferences
    USING (tenant_id = current_setting('app.current_tenant')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
