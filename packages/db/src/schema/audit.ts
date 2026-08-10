/**
 * Audit schema module.
 *
 * `audit_logs` is an append-only, monthly range-partitioned table. The
 * application role has INSERT and SELECT only; UPDATE and DELETE are revoked
 * in the migration.
 *
 * Columns align with the WOREF-007 audit contract:
 *   actor_type, actor_id, action, resource_type, resource_id,
 *   before_state (jsonb), after_state (jsonb), occurred_at, trace_id.
 *
 * occurred_at is the partition key and is also the "created_at" for retention
 * policy purposes.
 */
import {
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const auditLogs = pgTable(
  'audit_logs',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    id: uuid('id').notNull().defaultRandom(),
    /**
     * occurred_at is the partition key. Part of the PK to satisfy
     * PostgreSQL's requirement for partitioned tables.
     */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * actor_type: user | system | integration
     */
    actorType: text('actor_type').notNull(),
    /**
     * actor_id: UUID of the user/service that performed the action.
     * NULL for anonymous or system-triggered events.
     */
    actorId: uuid('actor_id'),
    /**
     * action: create | update | delete | access_denied | login | logout | etc.
     */
    action: text('action').notNull(),
    /**
     * resource_type: ticket | organization | user | comment | etc.
     */
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id').notNull(),
    /**
     * before_state / after_state: full JSONB snapshots of the record before
     * and after the mutation. NULL for creates (no before) and deletes (no
     * after).
     */
    beforeState: jsonb('before_state'),
    afterState: jsonb('after_state'),
    /**
     * trace_id: distributed tracing correlation identifier, propagated from
     * the incoming HTTP request X-Trace-Id header.
     */
    traceId: text('trace_id'),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.id, table.occurredAt] }),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
