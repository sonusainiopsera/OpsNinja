/**
 * Domain event recorder.
 *
 * The single authoritative API for writing to audit_logs and outbox_events.
 * Both writes are appended to the AMBIENT request transaction; calling this
 * outside a transaction scope throws TenantContextMissingError immediately.
 *
 * Module-boundary rule: feature modules MUST use this recorder instead of
 * writing directly to audit_logs or outbox_events. The recorder is the only
 * allowed path from feature code to those tables.
 *
 * Redaction: before and after payloads are passed through the shared redactor
 * before persistence, so PII is scrubbed at the point of write rather than
 * post-hoc.
 */

import type { Sql } from 'postgres';
import { redact } from '@opsninja/shared/privacy';
import { buildDiff } from './diff.js';
import {
  getTransactionContext,
  TenantContextMissingError,
} from '../transaction/transaction-context.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditEntry {
  /** Resource type, e.g. 'ticket', 'organization', 'comment'. */
  resourceType: string;
  /** UUID of the affected resource. */
  resourceId: string;
  /** Action performed, e.g. 'create', 'update', 'delete', 'access_denied'. */
  action: string;
  /** Full state before the mutation (null for creates). */
  before?: Record<string, unknown> | null;
  /** Full state after the mutation (null for deletes). */
  after?: Record<string, unknown> | null;
}

export interface OutboxEntry {
  /** Stable UUID used by consumers for at-least-once deduplication. */
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------

export class DomainEventRecorder {
  /**
   * Appends an immutable audit record to audit_logs within the ambient
   * request transaction.
   *
   * @throws TenantContextMissingError if called outside a transaction scope.
   */
  async recordAudit(entry: AuditEntry): Promise<void> {
    const ctx = getTransactionContext();
    await this.insertAuditLog(ctx.sql, {
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.id ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      diff: buildDiff(
        entry.resourceType,
        entry.before ?? null,
        entry.after ?? null,
      ),
      traceId: ctx.traceId ?? null,
    });
  }

  /**
   * Enqueues a domain event into outbox_events within the ambient request
   * transaction. The event is not published until the drain loop processes it.
   *
   * @throws TenantContextMissingError if called outside a transaction scope.
   */
  async enqueueEvent(entry: OutboxEntry): Promise<void> {
    const ctx = getTransactionContext();
    await this.insertOutboxEvent(ctx.sql, {
      tenantId: ctx.tenantId,
      id: entry.id,
      aggregateType: entry.aggregateType,
      aggregateId: entry.aggregateId,
      eventType: entry.eventType,
      payload: redact(entry.payload) as Record<string, unknown>,
    });
  }

  /**
   * Convenience method that writes both an audit record and an outbox event
   * in a single call. The operation is atomic: both rows land in the same
   * transaction or neither does.
   */
  async record(audit: AuditEntry, event: OutboxEntry): Promise<void> {
    await Promise.all([
      this.recordAudit(audit),
      this.enqueueEvent(event),
    ]);
  }

  // -------------------------------------------------------------------------
  // Raw SQL insertions (package-private for testing)
  // -------------------------------------------------------------------------

  private async insertAuditLog(
    sql: Sql,
    params: {
      tenantId: string;
      actorType: string;
      actorId: string | null;
      action: string;
      resourceType: string;
      resourceId: string;
      diff: { added: Record<string, unknown>; removed: Record<string, unknown>; changed: Record<string, { before: unknown; after: unknown }>; truncated?: boolean };
      traceId: string | null;
    },
  ): Promise<void> {
    const beforeState = Object.keys(params.diff.removed).length > 0 || Object.keys(params.diff.changed).length > 0
      ? { ...params.diff.removed, ...Object.fromEntries(Object.entries(params.diff.changed).map(([k, v]) => [k, v.before])) }
      : null;
    const afterState = Object.keys(params.diff.added).length > 0 || Object.keys(params.diff.changed).length > 0
      ? { ...params.diff.added, ...Object.fromEntries(Object.entries(params.diff.changed).map(([k, v]) => [k, v.after])) }
      : null;

    await sql`
      INSERT INTO audit_logs (
        tenant_id, id, occurred_at,
        actor_type, actor_id, action,
        resource_type, resource_id,
        before_state, after_state, trace_id
      ) VALUES (
        ${params.tenantId}::uuid,
        gen_random_uuid(),
        now(),
        ${params.actorType},
        ${params.actorId}::uuid,
        ${params.action},
        ${params.resourceType},
        ${params.resourceId}::uuid,
        ${beforeState ? JSON.stringify(beforeState) : null}::jsonb,
        ${afterState ? JSON.stringify(afterState) : null}::jsonb,
        ${params.traceId}
      )
    `;
  }

  private async insertOutboxEvent(
    sql: Sql,
    params: {
      tenantId: string;
      id: string;
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    await sql`
      INSERT INTO outbox_events (
        tenant_id, id,
        aggregate_type, aggregate_id,
        event_type, payload,
        status, created_at
      ) VALUES (
        ${params.tenantId}::uuid,
        ${params.id}::uuid,
        ${params.aggregateType},
        ${params.aggregateId}::uuid,
        ${params.eventType},
        ${JSON.stringify(params.payload)}::jsonb,
        'pending',
        now()
      )
    `;
  }
}

/** Singleton recorder instance for injection. */
export const domainEventRecorder = new DomainEventRecorder();

// Re-export error for convenience.
export { TenantContextMissingError };
