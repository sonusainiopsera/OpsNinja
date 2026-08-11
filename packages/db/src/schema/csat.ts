import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  smallint,
  integer,
  char,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';

import { tenants } from '../schema';

export const csatSurveys = pgTable(
  'csat_surveys',
  {
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    id: uuid('id').defaultRandom().notNull(),
    ticketId: uuid('ticket_id').notNull(),
    contactId: uuid('contact_id'),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    score: smallint('score'),
    comment: text('comment'),
    responseSource: text('response_source'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    delivered: boolean('delivered').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.id] }),
    tokenHashUniq: uniqueIndex('csat_surveys_token_hash_uniq').on(t.tokenHash),
    tenantTicketUniq: uniqueIndex('csat_surveys_tenant_ticket_uniq').on(t.tenantId, t.ticketId),
    tenantContactSentIdx: index('csat_surveys_tenant_contact_sent_idx').on(
      t.tenantId,
      t.contactId,
      t.sentAt,
    ),
    tenantCreatedIdx: index('csat_surveys_tenant_created_idx').on(t.tenantId, t.createdAt),
  }),
);

export type CsatSurvey = typeof csatSurveys.$inferSelect;
export type NewCsatSurvey = typeof csatSurveys.$inferInsert;

export type CsatResponseSource = 'one_click' | 'form';

export interface CsatSummary {
  averageScore: number | null;
  responseCount: number;
  sentCount: number;
  responseRate: number;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
}

/** Minimal fields returned by the bootstrap token lookup (no PII). */
export interface CsatTokenBootstrap {
  id: string;
  tenantId: string;
  ticketId: string;
  contactId: string | null;
  expiresAt: Date;
  respondedAt: Date | null;
  score: number | null;
  delivered: boolean;
}

/** Fields attached to request by CsatTokenGuard for use by controller/service. */
export interface CsatResolvedToken {
  rawTokenHash: string;
  survey: CsatTokenBootstrap;
}
