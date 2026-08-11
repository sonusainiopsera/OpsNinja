-- WO-089: Portal ticket submission with secure attachment uploads
-- Adds requested_priority to tickets and makes ticket_attachments.ticket_id nullable
-- so portal attachments can be presigned before a ticket exists.

-- 1. Add requested_priority to tickets (portal user's stated urgency, separate from
--    the SLA-resolved effective priority).
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS requested_priority text
    CHECK (requested_priority IN ('P1', 'P2', 'P3', 'P4'));

-- 2. Make ticket_id nullable on ticket_attachments so portal attachments can be
--    created before the parent ticket exists (pre-ticket upload workflow).
ALTER TABLE ticket_attachments
  ALTER COLUMN ticket_id DROP NOT NULL;

-- 3. Index for portal attachment ownership check:
--    (tenant_id, uploaded_by_user_id, is_finalized)
CREATE INDEX IF NOT EXISTS ticket_attachments_portal_owner_idx
  ON ticket_attachments (tenant_id, uploaded_by_user_id, is_finalized);

-- 4. Index for portal attachment-to-ticket linkage (linking confirmed attachments
--    when a portal ticket is created):
--    (tenant_id, organization_id, uploaded_by_user_id) WHERE ticket_id IS NULL
CREATE INDEX IF NOT EXISTS ticket_attachments_unlinked_idx
  ON ticket_attachments (tenant_id, organization_id, uploaded_by_user_id)
  WHERE ticket_id IS NULL;

-- RLS: existing policy on tenant_id already covers ticket_attachments rows.
