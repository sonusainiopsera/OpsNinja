/**
 * withAuditContext — wraps a worker handler in an AuditContext derived from
 * the SQS message envelope.
 *
 * Workers run as separate Node.js processes and do not share memory with the
 * API. This module maintains its own AsyncLocalStorage so that worker audit
 * code can call getAuditContextOrThrow() without importing from the API app.
 *
 * Usage pattern in worker handlers:
 *   await withAuditContext(envelope, async () => {
 *     const key = deriveWorkerIdempotencyKey(tenantId, message.messageId, 'transition');
 *     await auditWriter.append({ ..., idempotencyKey: key });
 *   });
 */

import { AsyncLocalStorage } from 'async_hooks';
import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Types (duplicated from API module — workers are separate processes)
// ---------------------------------------------------------------------------

export type AuditActorType = 'user' | 'system' | 'integration' | 'anonymous';

export interface AuditContext {
  tenantId: string;
  actorId: string | null;
  actorType: AuditActorType;
  actorRole: string | null;
  traceId: string;
  requestId: string | null;
  ipHash: string | null;
  userAgent: string | null;
  source: string | null;
}

export interface SqsEnvelope {
  messageId: string;
  tenantId: string;
  actorId?: string | null;
  actorType?: AuditActorType;
  source: string;
}

// ---------------------------------------------------------------------------
// AsyncLocalStorage singleton (worker-process scoped)
// ---------------------------------------------------------------------------

export const workerAuditContextStore = new AsyncLocalStorage<AuditContext>();

export function getWorkerAuditContext(): AuditContext | undefined {
  return workerAuditContextStore.getStore();
}

export function getWorkerAuditContextOrThrow(): AuditContext {
  const ctx = workerAuditContextStore.getStore();
  if (!ctx) {
    const err = new Error(
      'No AuditContext is bound to this worker execution. ' +
        'Wrap the handler in withAuditContext(envelope, fn).',
    );
    (err as NodeJS.ErrnoException).code = 'AUDIT_CONTEXT_MISSING';
    throw err;
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

export async function withAuditContext<T>(
  envelope: SqsEnvelope,
  fn: () => Promise<T>,
): Promise<T> {
  const ctx: AuditContext = {
    tenantId: envelope.tenantId,
    actorId: envelope.actorId ?? null,
    actorType: envelope.actorType ?? 'system',
    actorRole: null,
    traceId: envelope.messageId,
    requestId: envelope.messageId,
    ipHash: null,
    userAgent: null,
    source: envelope.source,
  };

  return workerAuditContextStore.run(ctx, fn);
}

// ---------------------------------------------------------------------------
// Idempotency key helper
// ---------------------------------------------------------------------------

/**
 * Derive the canonical idempotency key for a worker event.
 * SHA-256(tenantId:eventId:action) — hex encoded.
 */
export function deriveWorkerIdempotencyKey(
  tenantId: string,
  eventId: string,
  action: string,
): string {
  return createHash('sha256')
    .update(`${tenantId}:${eventId}:${action}`)
    .digest('hex');
}
