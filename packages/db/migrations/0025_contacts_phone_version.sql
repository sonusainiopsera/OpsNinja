-- WO-027: Extend contacts table with phone PII column, optimistic-concurrency
-- version counter, and 'suspended' status value.  All changes are additive
-- (expand-only) to preserve backward compatibility.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS phone        TEXT,
  ADD COLUMN IF NOT EXISTS version      INTEGER NOT NULL DEFAULT 1;

-- Widen status CHECK to allow 'suspended' alongside existing 'active'/'inactive'.
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_status_check;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_status_check
    CHECK (status IN ('active', 'suspended', 'inactive'));
