-- Migration 0046: AI summary human-edit columns (WO-065)
--
-- Additive only — expand-only migration discipline.
--
-- ticket_ai_summaries:
--   edited_by   — uuid of the agent who last edited the summary
--   edited_at   — timestamp of last human edit
--   skip_reason — human-readable reason when ai_status = 'skipped'
--   version     — optimistic-concurrency counter, default 1
--
-- ticket_affected_areas:
--   source      — 'ai' | 'human'; distinguishes model-generated from agent-edited areas

-- ---------------------------------------------------------------------------
-- ticket_ai_summaries additions
-- ---------------------------------------------------------------------------

ALTER TABLE ticket_ai_summaries
  ADD COLUMN IF NOT EXISTS edited_by   uuid,
  ADD COLUMN IF NOT EXISTS edited_at   timestamptz,
  ADD COLUMN IF NOT EXISTS skip_reason text,
  ADD COLUMN IF NOT EXISTS version     integer NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------------
-- ticket_affected_areas additions
-- ---------------------------------------------------------------------------

ALTER TABLE ticket_affected_areas
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'ai';
