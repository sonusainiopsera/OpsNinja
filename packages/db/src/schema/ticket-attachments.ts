/**
 * ticket_attachments schema — WO-031.
 *
 * Module ownership: tickets
 *
 * Attachments may be linked to a specific comment or attached directly to the
 * ticket (commentId = null). The s3_key is an internal reference only and
 * must never be exposed in API responses; callers receive pre-signed URLs.
 */

import {
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

    ticketId: uuid('ticket_id').notNull(),

    /** Nullable — attachment may be ticket-level (no parent comment). */
    commentId: uuid('comment_id'),

    /** Denormalised for portal visibility check without a join. */
    organizationId: uuid('organization_id').notNull(),

    /** Original filename as uploaded by the user. */
    filename: text('filename').notNull(),

    mimeType: text('mime_type').notNull(),

    /** S3 object key; never exposed directly in API responses. */
    s3Key: text('s3_key').notNull(),

    /** File size in bytes. Null for legacy rows created before WO-031. */
    fileSizeBytes: integer('file_size_bytes'),                  // WO-031

    /** User who uploaded the attachment. Null for system-generated attachments. */
    uploadedByUserId: uuid('uploaded_by_user_id'),              // WO-031

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('ticket_attachments_tenant_id_idx').on(t.tenantId),
    ticketIdx: index('ticket_attachments_ticket_id_idx').on(t.tenantId, t.ticketId),
    commentIdx: index('ticket_attachments_comment_id_idx').on(t.commentId),
  }),
);

export type TicketAttachment = typeof ticketAttachments.$inferSelect;
export type NewTicketAttachment = typeof ticketAttachments.$inferInsert;
