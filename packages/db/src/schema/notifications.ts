import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

// ── Enums ─────────────────────────────────────────────────────────────────────

export const notificationChannelEnum = pgEnum('notification_channel', ['email']);

export const notificationStatusEnum = pgEnum('notification_status', [
  'queued',
  'sent',
  'failed',
  'suppressed',
]);

// ── Tables ────────────────────────────────────────────────────────────────────

/**
 * notification_templates – per-tenant Handlebars templates.
 *
 * Each (tenant_id, key, locale) triple is unique. A null tenant_id row
 * functions as the platform default fallback.
 */
export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    key: text('key').notNull(),
    channel: notificationChannelEnum('channel').notNull().default('email'),
    locale: text('locale').notNull().default('en'),
    subject: text('subject').notNull(),
    bodyTemplate: text('body_template').notNull(),
    textTemplate: text('text_template'),
    version: integer('version').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantKeyLocaleIdx: uniqueIndex('notification_templates_tenant_key_locale_idx').on(
      t.tenantId,
      t.key,
      t.locale,
    ),
  }),
);

/**
 * notifications – one row per delivery attempt envelope.
 *
 * Table is RANGE partitioned monthly on created_at (DDL in migration).
 * The unique (tenant_id, dedupe_key) index enforces idempotency across
 * SQS at-least-once redeliveries.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    ticketId: uuid('ticket_id'),
    recipientContactId: uuid('recipient_contact_id'),
    recipientEmail: text('recipient_email').notNull(),
    channel: notificationChannelEnum('channel').notNull().default('email'),
    templateKey: text('template_key').notNull(),
    payload: jsonb('payload'),
    dedupeKey: text('dedupe_key').notNull(),
    status: notificationStatusEnum('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    providerMessageId: text('provider_message_id'),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => ({
    dedupeIdx: uniqueIndex('notifications_tenant_dedupe_key_idx').on(t.tenantId, t.dedupeKey),
    statusIdx: index('notifications_tenant_status_idx')
      .on(t.tenantId, t.status)
      .where('status = \'queued\''),
  }),
);

/**
 * notification_suppressions – bounce/complaint suppression list.
 *
 * Keyed by SHA-256 of the lowercased email so no PII is stored at rest.
 */
export const notificationSuppressions = pgTable(
  'notification_suppressions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    emailHash: text('email_hash').notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantEmailHashIdx: index('notification_suppressions_tenant_email_hash_idx').on(
      t.tenantId,
      t.emailHash,
    ),
  }),
);

// ── Inferred types ────────────────────────────────────────────────────────────

export type NotificationTemplate = typeof notificationTemplates.$inferSelect;
export type NewNotificationTemplate = typeof notificationTemplates.$inferInsert;

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type NotificationStatus = typeof notificationStatusEnum.enumValues[number];

export type NotificationSuppression = typeof notificationSuppressions.$inferSelect;
export type NewNotificationSuppression = typeof notificationSuppressions.$inferInsert;
