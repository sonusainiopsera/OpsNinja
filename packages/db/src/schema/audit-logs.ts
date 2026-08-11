import { pgTable, uuid, text, timestamp, jsonb, customType } from 'drizzle-orm/pg-core';

const textArray = customType<{ data: string[]; driverData: string[] }>({
  dataType() { return 'text[]'; },
});

/**
 * audit_logs – append-only record of security-relevant events.
 *
 * Every 401 / 403 from the AuthGuard, plus explicit calls from domain services,
 * land here.  Rows are never updated or deleted.
 * No RLS policy: audit infrastructure writes bypass tenant policy.
 *
 * Extended by migration 003_audit_extension.sql:
 *   before_state / after_state / changed_fields – state diff for mutations
 *   actor_role / request_id                     – enriched attribution
 *   idempotency_key                              – dedup for worker retries
 */
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id'),
  actorId: uuid('actor_id'),
  actorKind: text('actor_kind'),
  actorRole: text('actor_role'),
  action: text('action').notNull(),
  resourceType: text('resource_type'),
  resourceId: text('resource_id'),
  requiredPermission: text('required_permission'),
  route: text('route'),
  outcome: text('outcome').notNull(),
  code: text('code'),
  traceId: text('trace_id'),
  requestId: text('request_id'),
  metadata: jsonb('metadata'),
  beforeState: jsonb('before_state'),
  afterState: jsonb('after_state'),
  changedFields: textArray('changed_fields'),
  idempotencyKey: text('idempotency_key'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
