/**
 * ticket_status_history + tenant_sequences schema — WO-031.
 *
 * Module ownership: tickets
 *
 * ticket_status_history: append-only audit trail of every ticket status
 * transition. No UPDATE or DELETE grants are issued to the application role.
 *
 * tenant_sequences: per-tenant atomic sequence counters used to generate
 * human-readable ticket numbers (e.g. ON-1042). The next_tenant_sequence()
 * SQL function atomically bumps last_value and returns the new value.
 */

import {
  bigint,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// ticket_status_history — append-only
// ---------------------------------------------------------------------------

export const ticketStatusHistory = pgTable(
  'ticket_status_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),

    ticketId: uuid('ticket_id').notNull(),

    fromStatus: text('from_status'),        // null for initial 'new' entry
    toStatus: text('to_status').notNull(),
    actorUserId: uuid('actor_user_id'),     // null for system transitions
    reason: text('reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('ticket_status_history_tenant_id_idx').on(t.tenantId),
    ticketIdx: index('ticket_status_history_ticket_id_idx').on(t.tenantId, t.ticketId, t.createdAt),
  }),
);

export type TicketStatusHistory = typeof ticketStatusHistory.$inferSelect;
export type NewTicketStatusHistory = typeof ticketStatusHistory.$inferInsert;

// ---------------------------------------------------------------------------
// tenant_sequences — per-tenant atomic counters for ticket numbers
//
// The next_tenant_sequence() function uses INSERT ... ON CONFLICT DO UPDATE
// to atomically increment last_value. Concurrent inserts within the same
// tenant never collide because the UPDATE locks only the matching row.
// ---------------------------------------------------------------------------

export const tenantSequences = pgTable(
  'tenant_sequences',
  {
    tenantId: uuid('tenant_id').notNull(),

    /** e.g. 'tickets' */
    sequenceName: text('sequence_name').notNull(),

    /** Current highest assigned value. Starts at 0; first ticket gets 1. */
    lastValue: bigint('last_value', { mode: 'number' }).notNull().default(0),
  },
  (t) => ({
    tenantIdx: index('tenant_sequences_tenant_id_idx').on(t.tenantId),
  }),
);

export type TenantSequence = typeof tenantSequences.$inferSelect;
export type NewTenantSequence = typeof tenantSequences.$inferInsert;
