/**
 * Audit schema module.
 *
 * `audit_logs` is an append-only, monthly range-partitioned table. The
 * application role has INSERT and SELECT only; UPDATE and DELETE are revoked
 * in migration 0001 and blocked by the audit_logs_block_mutation trigger
 * added in migration 0092.
 *
 * Hash chain: each row stores hash_prev (the hash of the previous row for
 * this tenant) and hash_self = SHA-256(hash_prev || canonical_json(row)).
 * AuditWriter in apps/api is the authoritative write path.
 *
 * occurred_at is the partition key and is also the "created_at" for retention
 * policy purposes.
 */
import {
  customType,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

// bytea custom type — stores raw binary hashes.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

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
     * actor_display: human-readable display name, never a raw email.
     */
    actorDisplay: text('actor_display'),
    /**
     * actor_role: role of the actor at time of action (e.g. support_admin).
     */
    actorRole: text('actor_role'),
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
     * after). Truncated to 32 KB by AuditWriter with a truncated=true marker.
     */
    beforeState: jsonb('before_state'),
    afterState: jsonb('after_state'),
    /**
     * changed_fields: array of field names that changed in an update event.
     */
    changedFields: text('changed_fields').array(),
    /**
     * source: origin of the event — api | webhook | worker | system.
     */
    source: text('source'),
    /**
     * trace_id: distributed tracing correlation identifier.
     */
    traceId: text('trace_id'),
    /**
     * request_id: HTTP request correlation ID from X-Request-Id header.
     */
    requestId: text('request_id'),
    /**
     * ip_hash: salted SHA-256 of the client IP (PII-safe forensics).
     */
    ipHash: text('ip_hash'),
    /**
     * user_agent: HTTP User-Agent header value.
     */
    userAgent: text('user_agent'),
    /**
     * hash_prev: hash_self of the previous record for this tenant.
     * Genesis value is Buffer.alloc(32) (32 zero bytes).
     */
    hashPrev: bytea('hash_prev'),
    /**
     * hash_self: SHA-256(hash_prev || canonical_json(record_without_hashes)).
     * Computed and stored by AuditWriter.
     */
    hashSelf: bytea('hash_self'),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.id, table.occurredAt] }),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
