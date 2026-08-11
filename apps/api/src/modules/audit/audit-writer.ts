/**
 * AuditWriter — writes mutation audit records inside the current tenant transaction.
 *
 * CRITICAL INVARIANT: This service always writes inside the existing
 * withTenantTransaction() handle. It MUST NOT use the global db instance.
 * Audit records commit/rollback atomically with the mutation.
 *
 * Fail-closed: append() throws on write failure, causing the enclosing
 * transaction to roll back. Silently losing an audit record violates policy.
 *
 * Worker idempotency: workers pass an idempotency_key derived from
 * (tenantId:eventId:action); the unique partial index on that column
 * silently ignores duplicate deliveries (ON CONFLICT DO NOTHING).
 */

import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type { TxHandle } from '@opsninja/db';
import { auditLogs } from '@opsninja/db';
import { getRawTxHandle } from '../../observability/request-context';
import { getAuditContextOrThrow } from './audit-context';
import { deriveChangedFields } from './diff.util';
import { RedactionPort, DefaultRedactor, REDACTION_PORT } from './redaction.port';
import { Inject, Optional } from '@nestjs/common';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MutationAuditRecord {
  /** The type of resource being mutated (e.g. 'ticket', 'ticket_comment'). */
  resourceType: string;
  /** UUID or other identifier of the specific resource instance. */
  resourceId?: string | null;
  /** The action performed (e.g. 'create', 'update', 'delete'). */
  action: string;
  /** Snapshot of the resource before the mutation. */
  beforeState?: Record<string, unknown> | null;
  /** Snapshot of the resource after the mutation. */
  afterState?: Record<string, unknown> | null;
  /**
   * Explicit idempotency key for worker retries.
   * Convention: SHA-256(tenantId + ':' + eventId + ':' + action)
   */
  idempotencyKey?: string | null;
  /** Additional structured metadata for this record. */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AuditWriter {
  private readonly logger = new Logger(AuditWriter.name);
  private readonly redactor: RedactionPort;

  constructor(@Optional() @Inject(REDACTION_PORT) redactor?: RedactionPort) {
    this.redactor = redactor ?? new DefaultRedactor();
  }

  /**
   * Append a mutation audit record inside the current tenant transaction.
   *
   * @throws AUDIT_CONTEXT_MISSING — code path is not wrapped
   * @throws Any DB error — causes transaction rollback (audit failure = mutation failure)
   */
  async append(record: MutationAuditRecord): Promise<void> {
    const auditCtx = getAuditContextOrThrow();
    const tx = getRawTxHandle() as TxHandle;

    const beforeRedacted = record.beforeState
      ? this.redactor.redact(record.beforeState)
      : null;
    const afterRedacted = record.afterState
      ? this.redactor.redact(record.afterState)
      : null;

    const changedFields = deriveChangedFields(
      record.beforeState ?? null,
      record.afterState ?? null,
    );

    // Skip emit if nothing actually changed (idempotent PATCH with identical values).
    if (record.beforeState != null && record.afterState != null && changedFields === null) {
      return;
    }

    try {
      await tx
        .insert(auditLogs)
        .values({
          tenantId: auditCtx.tenantId,
          actorId: auditCtx.actorId,
          actorKind: auditCtx.actorType,
          eventType: `${record.resourceType}.${record.action}`,
          outcome: 'success',
          traceId: auditCtx.traceId,
          // New mutation-specific columns
          resourceType: record.resourceType,
          resourceId: record.resourceId ?? null,
          action: record.action,
          beforeState: beforeRedacted,
          afterState: afterRedacted,
          changedFields: changedFields ?? [],
          source: auditCtx.source,
          idempotencyKey: record.idempotencyKey ?? null,
          requestId: auditCtx.requestId,
          ipHash: auditCtx.ipHash,
          userAgent: auditCtx.userAgent
            ? auditCtx.userAgent.substring(0, 512)
            : null,
          metadata: record.metadata ?? {},
        })
        .onConflictDoNothing();
    } catch (err) {
      this.logger.error('[audit-ALERT] Failed to write mutation audit record', {
        resourceType: record.resourceType,
        action: record.action,
        traceId: auditCtx.traceId,
        tenantId: auditCtx.tenantId,
        error: (err as Error).message,
      });
      // Re-throw: audit failure = mutation failure (fail-closed).
      throw err;
    }
  }

  /**
   * Append multiple audit records in a single batch.
   * Preserves insertion order (per-aggregate ordering requirement).
   */
  async appendBatch(records: MutationAuditRecord[]): Promise<void> {
    for (const record of records) {
      await this.append(record);
    }
  }

  /**
   * Derive the canonical idempotency key for a worker event.
   * SHA-256(tenantId + ':' + eventId + ':' + action) — hex encoded.
   */
  static deriveIdempotencyKey(tenantId: string, eventId: string, action: string): string {
    return createHash('sha256')
      .update(`${tenantId}:${eventId}:${action}`)
      .digest('hex');
  }
}
