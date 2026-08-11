/**
 * withAuditContext – wraps a SQS message handler in an AuditContext so that
 * AuditWriter.append() works inside worker code without requiring a HTTP request.
 *
 * Usage in a SQS handler:
 *
 *   await withAuditContext(
 *     {
 *       tenantId: envelope.tenantId,
 *       actorType: 'system',
 *       actorId: null,
 *       source: 'jira-sync-worker',
 *       traceId: envelope.correlationId ?? randomUUID(),
 *       requestId: message.MessageId ?? randomUUID(),
 *     },
 *     () => handler.process(envelope),
 *   );
 *
 * Design notes:
 *  - Workers do NOT use the HTTP TenantContextInterceptor; they open their own
 *    database transaction via UnitOfWork.withTenantTransaction().
 *  - Idempotency keys are derived from the SQS envelope: '{tenantId}:{eventId}:{action}'.
 *    AuditWriter performs ON CONFLICT DO NOTHING so retried deliveries are harmless.
 *  - The source field names the worker (e.g. 'jira-sync-worker') for operator queries.
 */

import { AuditContext, AuditContextData, AuditActorType } from '../../common/audit/audit-context';

export interface WorkerAuditContextInput {
  tenantId: string | null;
  actorType: AuditActorType;
  actorId?: string | null;
  actorRole?: string | null;
  traceId: string;
  requestId: string;
  source: string;
}

/**
 * Wraps fn inside an AuditContext and returns the result.
 * The context is seeded from the worker's SQS envelope metadata.
 */
export async function withAuditContext<T>(
  input: WorkerAuditContextInput,
  fn: () => Promise<T>,
): Promise<T> {
  const ctx: AuditContextData = {
    tenantId: input.tenantId,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    actorRole: input.actorRole ?? null,
    traceId: input.traceId,
    requestId: input.requestId,
    hashedIp: null,
    userAgent: null,
    source: input.source,
  };
  return AuditContext.run(ctx, fn);
}

/**
 * Derives an idempotency key for a worker audit record.
 * Format: '{tenantId}:{eventId}:{action}'
 *
 * Callers pass this as AuditAppendParams.idempotencyKey so that SQS at-least-once
 * delivery does not produce duplicate audit rows.
 */
export function deriveWorkerIdempotencyKey(
  tenantId: string,
  eventId: string,
  action: string,
): string {
  return `${tenantId}:${eventId}:${action}`;
}
