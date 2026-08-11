import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core';

/**
 * audit_logs – append-only record of security-relevant events.
 *
 * Every 401 / 403 from the AuthGuard, plus explicit audit calls from domain
 * services, land here.  Rows are never updated or deleted.
 * No RLS policy: audit infrastructure writes bypass tenant policy.
 */
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id'),
  actorId: uuid('actor_id'),
  actorKind: text('actor_kind'),
  action: text('action').notNull(),
  resourceType: text('resource_type'),
  resourceId: text('resource_id'),
  requiredPermission: text('required_permission'),
  route: text('route'),
  outcome: text('outcome').notNull(),
  code: text('code'),
  traceId: text('trace_id'),
  metadata: jsonb('metadata'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
