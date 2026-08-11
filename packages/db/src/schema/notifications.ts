/**
 * Notification schema — tenant-scoped tables for transactional email delivery.
 *
 * notification_templates  — per-tenant, per-key Handlebars template registry
 * notifications           — every delivery attempt; RANGE-partitioned monthly
 * notification_suppressions — bounce/complaint suppression list keyed by SHA-256
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// notification_templates
// ---------------------------------------------------------------------------

export const notificationTemplates = pgTable(
  'notification_templates',
  {
    tenantId: uuid('tenant_id').notNull(),
    key: text('key').notNull(),
    channel: text('channel').notNull().default('email'),
    locale: text('locale').notNull().default('en'),
    subject: text('subject').notNull(),
    /** Handlebars HTML template (MJML pre-compiled at build time). */
    bodyTemplate: text('body_template').notNull(),
    /** Handlebars plain-text fallback. */
    textTemplate: text('text_template').notNull(),
    version: integer('version').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.key, t.channel, t.locale] }),
    tenantIdx: index('notification_templates_tenant_id_idx').on(t.tenantId),
  }),
);

export type NotificationTemplate = typeof notificationTemplates.$inferSelect;
export type NewNotificationTemplate = typeof notificationTemplates.$inferInsert;

// ---------------------------------------------------------------------------
// notifications  (partitioned by created_at — parent table definition)
// ---------------------------------------------------------------------------

export type NotificationStatus = 'queued' | 'sent' | 'failed' | 'suppressed';

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().notNull(),
    tenantId: uuid('tenant_id').notNull(),
    ticketId: uuid('ticket_id'),
    recipientContactId: uuid('recipient_contact_id'),
    recipientEmail: text('recipient_email').notNull(),
    channel: text('channel').notNull().default('email'),
    templateKey: text('template_key').notNull(),
    payload: jsonb('payload').notNull().default({}),
    /** Stable idempotency key derived from the source outbox event. */
    dedupeKey: text('dedupe_key').notNull(),
    status: text('status').$type<NotificationStatus>().notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    /** SES MessageId returned on successful delivery. */
    providerMessageId: text('provider_message_id'),
    /** Structured error code for failed/suppressed rows. */
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.id] }),
    tenantIdx: index('notifications_tenant_id_idx').on(t.tenantId),
    // Idempotency: duplicate outbox delivery returns conflict — zero-op.
    dedupeIdx: uniqueIndex('notifications_dedupe_idx').on(t.tenantId, t.dedupeKey),
    // Partial index for efficient queued-count queries.
    statusIdx: index('notifications_status_idx').on(t.tenantId, t.status),
  }),
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

// ---------------------------------------------------------------------------
// notification_suppressions
// ---------------------------------------------------------------------------

export type SuppressionReason = 'bounce' | 'complaint';

export const notificationSuppressions = pgTable(
  'notification_suppressions',
  {
    tenantId: uuid('tenant_id').notNull(),
    /** SHA-256 hex of the lowercased recipient email address. Never store PII. */
    emailHash: text('email_hash').notNull(),
    reason: text('reason').$type<SuppressionReason>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.emailHash] }),
    tenantHashIdx: index('notification_suppressions_tenant_email_hash_idx').on(
      t.tenantId,
      t.emailHash,
    ),
  }),
);

export type NotificationSuppression = typeof notificationSuppressions.$inferSelect;
export type NewNotificationSuppression = typeof notificationSuppressions.$inferInsert;
