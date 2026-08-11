/**
 * ticket_attachments schema — WO-031 + WO-035.
 *
 * Module ownership: tickets
 *
 * Attachments may be linked to a specific comment or attached directly to the
 * ticket (commentId = null). The s3_key is an internal reference only and
 * must never be exposed in API responses; callers receive pre-signed URLs.
 *
 * Upload flow (WO-035):
 *   1. POST presign  → creates row with isFinalized=false
 *   2. Client uploads directly to S3 via presigned POST policy
 *   3. POST finalize → verifies object, detects MIME, sets isFinalized=true
 *
 * Orphan reaper deletes rows with isFinalized=false older than 24h.
 */

import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const ticketAttachments = pgTable(
  'ticket_attachments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),

    /**
     * Nullable: set when a portal attachment is linked to a ticket.
     * Null = presigned but not yet associated with any ticket (WO-089 portal flow).
     */
    ticketId: uuid('ticket_id'),

    /** Nullable — attachment may be ticket-level (no parent comment). */
    commentId: uuid('comment_id'),

    /** Denormalised for portal visibility check without a join. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Sanitised original filename stored as display metadata only.
     * Path separators, traversal sequences, null bytes and leading dots
     * are stripped. Storage key NEVER derives from this value.
     */
    filename: text('filename').notNull(),

    /** Client-declared MIME type (may differ from detectedMime). */
    mimeType: text('mime_type').notNull(),

    /**
     * True content type confirmed by magic-byte inspection during finalize.
     * Null for rows created before WO-035.
     */
    detectedMime: text('detected_mime'),                           // WO-035

    /** S3 object key; server-generated, never derived from user input. */
    s3Key: text('s3_key').notNull(),

    /** File size in bytes. Populated during finalize. */
    fileSizeBytes: integer('file_size_bytes'),

    /** SHA-256 hex checksum of the object content, captured during finalize. */
    checksum: text('checksum'),                                    // WO-035

    /**
     * Whether finalization has been completed.
     * false = presign issued, upload not yet verified.
     * true  = object verified, MIME checked, attachment is visible.
     * Rows with false older than 24h are reaped by the orphan-reaper job.
     */
    isFinalized: boolean('is_finalized').notNull().default(false), // WO-035

    /** User who uploaded the attachment. Null for system-generated attachments. */
    uploadedByUserId: uuid('uploaded_by_user_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),// WO-035
  },
  (t) => ({
    tenantIdx: index('ticket_attachments_tenant_id_idx').on(t.tenantId),
    ticketIdx: index('ticket_attachments_ticket_id_idx').on(t.tenantId, t.ticketId),
    commentIdx: index('ticket_attachments_comment_id_idx').on(t.commentId),
    /** Orphan-reaper uses this index to find unfinalized rows. */
    unfinalizedIdx: index('ticket_attachments_unfinalized_idx').on(t.isFinalized, t.createdAt),
  }),
);

export type TicketAttachment = typeof ticketAttachments.$inferSelect;
export type NewTicketAttachment = typeof ticketAttachments.$inferInsert;
