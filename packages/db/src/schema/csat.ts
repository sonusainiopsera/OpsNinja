// Data classification: Confidential (comment field = PII free text)
// Retention: erasure via GDPR deletion request; enumerated by ErasureOrchestrator
import {
  pgTable,
  uuid,
  text,
  boolean,
  smallint,
  timestamp,
  char,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const csatSurveys = pgTable(
  'csat_surveys',
  {
    tenantId: uuid('tenant_id').notNull(),
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id').notNull(),
    contactId: uuid('contact_id').notNull(),
    // SHA-256 hex of the raw base64url transport token
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    score: smallint('score'),
    // Confidential-tier: always rendered escaped; masked in all logs/traces
    comment: text('comment'),
    responseSource: text('response_source'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    delivered: boolean('delivered').notNull().default(true),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
  },
  (t) => ({
    tenantTicketUidx: uniqueIndex('csat_surveys_tenant_ticket_uidx').on(t.tenantId, t.ticketId),
    tokenHashUidx: uniqueIndex('csat_surveys_token_hash_uidx').on(t.tokenHash),
    tenantContactSentIdx: index('csat_surveys_tenant_contact_sent_idx').on(
      t.tenantId,
      t.contactId,
      t.sentAt,
    ),
  }),
);

export type CsatSurvey = typeof csatSurveys.$inferSelect;
export type NewCsatSurvey = typeof csatSurveys.$inferInsert;
