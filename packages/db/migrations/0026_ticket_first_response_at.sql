-- WO-034: Ticket Comment Thread With Visibility Enforcement
--
-- Adds first_response_at to tickets so the SLA module can measure time-to-first-response.
-- The column is nullable: NULL means no public agent reply has been posted yet.
-- The application layer uses a conditional UPDATE ... WHERE first_response_at IS NULL
-- to stamp it atomically on the first public comment; concurrent stamps are benign
-- because only one UPDATE will match when the column is already set.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS first_response_at timestamptz;

-- Partial index for the SLA scheduler to efficiently find unresponded tickets.
CREATE INDEX IF NOT EXISTS tickets_unresponded_idx
  ON tickets (tenant_id, created_at)
  WHERE first_response_at IS NULL AND status NOT IN ('resolved', 'closed');
