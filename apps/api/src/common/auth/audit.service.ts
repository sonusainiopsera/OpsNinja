/**
 * AuditService — writes immutable authorization audit records.
 *
 * The auth guard calls this service synchronously on every 401/403 so the
 * immutable record is captured before the denial is returned to the client.
 *
 * Design:
 *   - Writes directly to the audit_logs table via the Drizzle db instance,
 *     bypassing the per-request tenant transaction (the guard runs before the
 *     tenant-context interceptor opens a transaction).
 *   - A write failure logs an operator-level alert but NEVER suppresses the
 *     denial response — the security action always takes effect.
 *   - No token value, hash, or bearer credential is ever written to the log.
 */

import { Injectable, Logger } from '@nestjs/common';
import { db, auditLogs } from '@opsninja/db';

export interface AuthAuditEvent {
  /** null for token-missing (pre-authentication) failures */
  tenantId?: string | null;
  /** null for token-missing failures where actor is unknown */
  actorId?: string | null;
  actorKind?: 'staff' | 'portal' | 'machine' | null;
  /** Dot-separated event type: 'auth.token_missing' | 'authz.permission_denied' | etc. */
  eventType: string;
  /** 'denied' for guard failures — 'allowed' is also supported for allow-audit if needed */
  outcome: 'allowed' | 'denied';
  requiredPermission?: string | null;
  route?: string | null;
  ipAddress?: string | null;
  traceId: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  /**
   * Write an authorization audit record. Failures log an operator alert
   * but never throw — the calling guard must still return its denial.
   */
  async writeAuthEvent(event: AuthAuditEvent): Promise<void> {
    try {
      await db.insert(auditLogs).values({
        tenantId: event.tenantId ?? null,
        actorId: event.actorId ?? null,
        actorKind: event.actorKind ?? null,
        eventType: event.eventType,
        outcome: event.outcome,
        requiredPermission: event.requiredPermission ?? null,
        route: event.route ?? null,
        ipAddress: event.ipAddress ?? null,
        traceId: event.traceId,
        metadata: event.metadata ?? {},
      });
    } catch (err) {
      // OPERATOR ALERT: audit write failure. The denial is still returned.
      this.logger.error('[audit-ALERT] Failed to write auth audit record', {
        eventType: event.eventType,
        traceId: event.traceId,
        tenantId: event.tenantId,
        actorId: event.actorId,
        error: (err as Error).message,
      });
    }
  }
}
