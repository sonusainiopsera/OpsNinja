/**
 * AuditWriter – transactional audit-record emitter.
 *
 * IMPORTANT: append() writes inside the CURRENT DATABASE TRANSACTION obtained
 * from RequestContextStore.getTx().  If called outside a transaction it throws
 * AuditContextMissingError.  This guarantees that an audit record exists if
 * and only if the mutation committed.
 *
 * Consumers must never call append() with an ambient connection (e.g. DB_TOKEN).
 * Worker paths use withAuditContext() which opens its own transaction.
 *
 * Idempotency: worker callers supply an idempotency_key; the unique partial
 * index on audit_logs(idempotency_key WHERE idempotency_key IS NOT NULL) plus
 * ON CONFLICT DO NOTHING silently deduplicates retried deliveries.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import { auditLogs } from '@opsninja/db';
import { RequestContextStore, TenantContextMissingError } from '../../observability/request-context';
import { AuditContext, AuditContextMissingError } from './audit-context';
import { deriveChangedFields } from './derive-changed-fields';
import { REDACTION_PORT, RedactionPort } from './redaction.port';

export interface AuditAppendParams {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome?: string;
  /** Entity snapshot BEFORE the mutation. Redacted before persistence. */
  beforeState?: Record<string, unknown> | null;
  /** Entity snapshot AFTER the mutation. Redacted before persistence. */
  afterState?: Record<string, unknown> | null;
  /** Explicit changed-fields override; derived automatically when omitted. */
  changedFields?: string[];
  /** Supplemental structured metadata (e.g. reason, target tenant). */
  metadata?: Record<string, unknown> | null;
  /**
   * Idempotency key for worker paths. Format: '{tenant_id}:{event_id}:{action}'.
   * HTTP requests leave this undefined.
   */
  idempotencyKey?: string | null;
  /**
   * Emit even when changedFields is empty (e.g. status transitions where we want
   * an explicit record regardless of field equality). Default: false.
   */
  forceEmit?: boolean;
}

export interface AuditAppendAuthParams {
  action: string;
  actorType?: 'user' | 'system' | 'integration' | 'anonymous';
  actorId?: string | null;
  tenantId?: string | null;
  outcome: string;
  metadata?: Record<string, unknown> | null;
  traceId?: string;
  requestId?: string;
}

@Injectable()
export class AuditWriter {
  private readonly logger = new Logger(AuditWriter.name);

  constructor(
    @Inject(REDACTION_PORT) private readonly redactor: RedactionPort,
  ) {}

  /**
   * Appends one audit record inside the current transaction.
   *
   * Returns null (and logs a warning) when the changedFields set is empty and
   * forceEmit is false — idempotent PATCHes that make no change produce no record.
   *
   * @throws {AuditContextMissingError} when called outside an AuditContext.
   * @throws {TenantContextMissingError} when called outside a DB transaction.
   */
  async append(params: AuditAppendParams): Promise<void> {
    const auditCtx = AuditContext.getOrThrow();

    const changedFields =
      params.changedFields ??
      deriveChangedFields(
        params.beforeState as Record<string, unknown> | null,
        params.afterState as Record<string, unknown> | null,
      );

    // Skip no-op mutations unless explicitly forced.
    if (
      !params.forceEmit &&
      changedFields.length === 0 &&
      params.beforeState != null &&
      params.afterState != null
    ) {
      return;
    }

    const tx = this.resolveHandle();

    const beforeState = this.redactor.redact(params.beforeState ?? null);
    const afterState = this.redactor.redact(params.afterState ?? null);

    try {
      await tx
        .insert(auditLogs)
        .values({
          id: randomUUID(),
          tenantId: auditCtx.tenantId,
          actorId: auditCtx.actorId,
          actorKind: auditCtx.actorType,
          actorRole: auditCtx.actorRole,
          action: params.action,
          resourceType: params.resourceType,
          resourceId: params.resourceId ?? null,
          outcome: params.outcome ?? 'success',
          code: params.action,
          traceId: auditCtx.traceId,
          requestId: auditCtx.requestId,
          metadata: params.metadata ?? null,
          beforeState: beforeState as Record<string, unknown> | null,
          afterState: afterState as Record<string, unknown> | null,
          changedFields: changedFields.length > 0 ? changedFields : null,
          idempotencyKey: params.idempotencyKey ?? null,
          occurredAt: new Date(),
        })
        .onConflictDoNothing({ target: sql`(idempotency_key) WHERE idempotency_key IS NOT NULL` });
    } catch (err) {
      this.logger.error('OPERATOR_ALERT: audit_log write failed', {
        action: params.action,
        tenantId: auditCtx.tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Re-throw so the mutation transaction rolls back — losing an audit record
      // violates policy.
      throw err;
    }
  }

  /**
   * Variant for authentication and authorization events that must be written
   * outside a tenant transaction (the auth guard runs before the tenant
   * interceptor).  Uses the global DB connection (not transactional).
   *
   * Note: this method is intentionally NOT transactional — auth events occur
   * before a transaction exists.  The existing AuditService.recordAccessDenial()
   * handles the 401/403 case; this method is for login/logout/refresh success.
   */
  async appendAuthEvent(
    db: import('@opsninja/db').DB,
    params: AuditAppendAuthParams,
  ): Promise<void> {
    try {
      await db.insert(auditLogs).values({
        id: randomUUID(),
        tenantId: params.tenantId ?? null,
        actorId: params.actorId ?? null,
        actorKind: params.actorType ?? 'user',
        action: params.action,
        outcome: params.outcome,
        code: params.action,
        traceId: params.traceId ?? null,
        requestId: params.requestId ?? null,
        metadata: params.metadata ?? null,
        occurredAt: new Date(),
      });
    } catch (err) {
      this.logger.error('OPERATOR_ALERT: auth audit event write failed', {
        action: params.action,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Batch-append: each item is an independent record within the same transaction. */
  async appendBatch(items: AuditAppendParams[]): Promise<void> {
    for (const item of items) {
      await this.append(item);
    }
  }

  private resolveHandle() {
    try {
      return RequestContextStore.getTx();
    } catch (err) {
      if (err instanceof TenantContextMissingError) {
        throw new AuditContextMissingError(
          'append() requires an active DB transaction — call append() inside a tenant-bound handler',
        );
      }
      throw err;
    }
  }
}
