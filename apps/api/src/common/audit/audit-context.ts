/**
 * AuditContext – per-request AsyncLocalStorage context for audit emission.
 *
 * Populated by AuditInterceptor for every authenticated HTTP request and by
 * withAuditContext() for SQS worker handlers.  Every call to AuditWriter.append()
 * reads the ambient context rather than requiring it to be threaded through every
 * service signature.
 *
 * Actor types:
 *   user        – authenticated staff or portal principal
 *   system      – scheduler, timer, or platform-initiated job
 *   integration – inbound Jira sync, webhook delivery, or third-party integration
 *   anonymous   – pre-authentication events (failed signup verification, etc.)
 */

import { AsyncLocalStorage } from 'async_hooks';
import { createHash } from 'crypto';
import { ErrorCode } from '../errors/app-errors';

export type AuditActorType = 'user' | 'system' | 'integration' | 'anonymous';

export interface AuditContextData {
  /** UUID of the owning tenant (null only for anonymous pre-auth events). */
  tenantId: string | null;
  /** Type of the actor performing the mutation. */
  actorType: AuditActorType;
  /** UUID of the actor (user id, worker name, etc.). */
  actorId: string | null;
  /** Highest role carried by the actor (for humans) or service name (for systems). */
  actorRole: string | null;
  /** Distributed trace identifier carried from the incoming request or SQS envelope. */
  traceId: string;
  /** HTTP request-id header or SQS message-id. */
  requestId: string;
  /** SHA-256 of the client IP, truncated to 16 hex chars for lightweight pseudonymisation. */
  hashedIp: string | null;
  /** Raw User-Agent header value (never PII). */
  userAgent: string | null;
  /** Source label for worker paths (e.g. "jira-sync-worker", "sla-timer-scheduler"). */
  source: string | null;
}

export class AuditContextMissingError extends Error {
  readonly code = 'AUDIT_CONTEXT_MISSING' as const;

  constructor(detail?: string) {
    super(
      `AUDIT_CONTEXT_MISSING${detail ? `: ${detail}` : ''}. ` +
        'Every mutating code path must run inside AuditContext.run() or withAuditContext().',
    );
    this.name = 'AuditContextMissingError';
  }
}

const _store = new AsyncLocalStorage<AuditContextData>();

export class AuditContext {
  private constructor() {}

  /** Execute fn inside an audit context. Returns the fn result. */
  static run<T>(ctx: AuditContextData, fn: () => Promise<T>): Promise<T> {
    return _store.run(ctx, fn);
  }

  /** Returns the ambient context or undefined if none is active. */
  static get(): AuditContextData | undefined {
    return _store.getStore();
  }

  /**
   * Returns the ambient context or throws AuditContextMissingError.
   * Called by AuditWriter to ensure audit emission is never silently skipped.
   */
  static getOrThrow(): AuditContextData {
    const ctx = _store.getStore();
    if (!ctx) throw new AuditContextMissingError();
    return ctx;
  }

  /**
   * Pseudonymise an IPv4/IPv6 address for storage.
   * Takes the first 16 hex chars of SHA-256(ip) — sufficient for rate analysis
   * without storing the raw address.
   */
  static hashIp(ip: string): string {
    return createHash('sha256').update(ip).digest('hex').slice(0, 16);
  }
}
