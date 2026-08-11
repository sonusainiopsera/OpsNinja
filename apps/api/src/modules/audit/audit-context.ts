/**
 * AuditContext — request-scoped store for audit metadata.
 *
 * Seeded by AuditInterceptor for HTTP requests and by withAuditContext() for
 * worker-originated changes. Deep service code reads the context via
 * getAuditContext() without parameter threading.
 *
 * Fail-closed: getAuditContextOrThrow() throws AUDIT_CONTEXT_MISSING when
 * called outside a bound context — this surfaces unwrapped code paths as
 * operator-visible 500-class errors rather than silently skipping audit.
 */

import { AsyncLocalStorage } from 'async_hooks';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuditActorType = 'user' | 'system' | 'integration' | 'anonymous';

export interface AuditContext {
  /** Tenant UUID — always present (workers derive from SQS envelope). */
  tenantId: string;
  /** UUID of the acting user or worker identity. */
  actorId: string | null;
  actorType: AuditActorType;
  /** Primary RBAC role of the actor (for user actors). */
  actorRole: string | null;
  /** Distributed trace ID for correlation across services. */
  traceId: string;
  /** HTTP or SQS correlation / message ID. */
  requestId: string | null;
  /** SHA-256 hex of the client IP (never stored raw). */
  ipHash: string | null;
  /** User-Agent header value (truncated at 512 chars). */
  userAgent: string | null;
  /**
   * Source label for worker-originated records.
   * e.g. 'jira-sync-worker', 'sla-scheduler', 'notification-worker'.
   */
  source: string | null;
}

// ---------------------------------------------------------------------------
// AsyncLocalStorage singleton
// ---------------------------------------------------------------------------

export const auditContextStore = new AsyncLocalStorage<AuditContext>();

// ---------------------------------------------------------------------------
// Typed accessors
// ---------------------------------------------------------------------------

/** Returns the current AuditContext, or undefined when outside a bound context. */
export function getAuditContext(): AuditContext | undefined {
  return auditContextStore.getStore();
}

/**
 * Returns the current AuditContext.
 *
 * @throws Error with code AUDIT_CONTEXT_MISSING when called outside a bound
 *   context. This is a programming error indicating an unwrapped code path.
 */
export function getAuditContextOrThrow(): AuditContext {
  const ctx = auditContextStore.getStore();
  if (!ctx) {
    const err = new Error(
      'No AuditContext is bound to this execution. ' +
        'Ensure AuditInterceptor is registered globally and that worker handlers ' +
        'are wrapped in withAuditContext().',
    );
    (err as NodeJS.ErrnoException).code = 'AUDIT_CONTEXT_MISSING';
    throw err;
  }
  return ctx;
}

/**
 * Run fn inside an AuditContext scope.
 * Used by AuditInterceptor (HTTP) and withAuditContext (workers).
 */
export function runWithAuditContext<T>(ctx: AuditContext, fn: () => Promise<T>): Promise<T> {
  return auditContextStore.run(ctx, fn);
}
