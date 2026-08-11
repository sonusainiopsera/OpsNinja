-- Migration 0034: AI synthesis tables (WO-062)
--
-- Creates three tables for the AI Synthesis Worker:
--   ticket_ai_summaries       — one row per ticket, holds crux + resolution text
--   ticket_affected_areas     — zero-to-many area tags per summary
--   ai_synthesis_idempotency  — 7-day TTL dedup guard keyed on (tenant_id, event_id)
--
-- All tables carry RLS with the standard tenant_isolation policy.

-- ---------------------------------------------------------------------------
-- ticket_ai_summaries
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ticket_ai_summaries (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid          NOT NULL,
  ticket_id           uuid          NOT NULL,
  ai_status           text          NOT NULL DEFAULT 'pending',
  crux_summary        text,
  resolution_summary  text,
  model_id            text,
  prompt_version      text,
  generated_at        timestamptz,
  truncated           boolean       NOT NULL DEFAULT false,
  last_error_code     text,
  prompt_tokens       integer,
  completion_tokens   integer,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ticket_ai_summaries_tenant_ticket_uniq
  ON ticket_ai_summaries (tenant_id, ticket_id);

CREATE INDEX IF NOT EXISTS ticket_ai_summaries_tenant_status_idx
  ON ticket_ai_summaries (tenant_id, ai_status);

ALTER TABLE ticket_ai_summaries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ticket_ai_summaries'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON ticket_ai_summaries
      USING (tenant_id = current_setting('app.current_tenant')::uuid);
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- ticket_affected_areas
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ticket_affected_areas (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  ticket_id    uuid        NOT NULL,
  summary_id   uuid        NOT NULL REFERENCES ticket_ai_summaries(id) ON DELETE CASCADE,
  area_label   text        NOT NULL,
  confidence   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_affected_areas_ticket_idx
  ON ticket_affected_areas (tenant_id, ticket_id);

CREATE INDEX IF NOT EXISTS ticket_affected_areas_summary_idx
  ON ticket_affected_areas (summary_id);

ALTER TABLE ticket_affected_areas ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ticket_affected_areas'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON ticket_affected_areas
      USING (tenant_id = current_setting('app.current_tenant')::uuid);
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- ai_synthesis_idempotency
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_synthesis_idempotency (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  event_id      uuid        NOT NULL,
  processed_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_synthesis_idempotency_tenant_event_uniq
  ON ai_synthesis_idempotency (tenant_id, event_id);

CREATE INDEX IF NOT EXISTS ai_synthesis_idempotency_expires_at_idx
  ON ai_synthesis_idempotency (expires_at);

ALTER TABLE ai_synthesis_idempotency ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ai_synthesis_idempotency'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON ai_synthesis_idempotency
      USING (tenant_id = current_setting('app.current_tenant')::uuid);
  END IF;
END$$;
