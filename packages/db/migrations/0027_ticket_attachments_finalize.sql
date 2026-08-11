-- WO-035: Attachment Upload Via Presigned S3 With MIME Verification
--
-- Adds columns to ticket_attachments to support the presign/finalize upload flow:
--   detected_mime  — true content type verified by magic-byte inspection
--   checksum       — SHA-256 hex of the uploaded object
--   is_finalized   — false until finalize endpoint confirms the upload
--   finalized_at   — timestamp when finalization completed

ALTER TABLE ticket_attachments
  ADD COLUMN IF NOT EXISTS detected_mime   text,
  ADD COLUMN IF NOT EXISTS checksum        text,
  ADD COLUMN IF NOT EXISTS is_finalized    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS finalized_at    timestamptz;

-- Index used by the orphan-reaper job to find stale unfinalized uploads.
CREATE INDEX IF NOT EXISTS ticket_attachments_unfinalized_idx
  ON ticket_attachments (is_finalized, created_at)
  WHERE is_finalized = false;
