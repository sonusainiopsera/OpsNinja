/**
 * AuthAuditEmitter — single funnel for identity-module security events.
 *
 * All identity services call this instead of constructing audit rows ad-hoc.
 * This ensures:
 *   - Every identity security event produces a structured log entry.
 *   - Every event writes an immutable audit record via AuditService.
 *   - No service constructs AuthAuditEvent objects outside this module.
 *   - PII (email, IP) is never placed in the log; only hashed values appear.
 *
 * Event types emitted through this service:
 *   auth.login_success        — successful credential verification
 *   auth.login_failure        — failed credential attempt (with reason code)
 *   auth.logout               — session terminated by user
 *   auth.token_refresh        — access token rotated
 *   auth.refresh_reuse        — refresh token reuse detected (family revoked)
 *   auth.lockout_triggered    — account locked after failure threshold
 *   auth.lockout_cleared      — admin-initiated unlock
 *   authz.permission_denied   — authorization denial
 *   auth.scope_changed        — org scope set mutated
 *   auth.user_approved        — pending user approved
 *   auth.user_rejected        — pending user rejected
 */

import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

import { AuditService, type AuthAuditEvent } from '../../../common/auth/audit.service';

export type AuthEventType =
  | 'auth.login_success'
  | 'auth.login_failure'
  | 'auth.logout'
  | 'auth.token_refresh'
  | 'auth.refresh_reuse'
  | 'auth.lockout_triggered'
  | 'auth.lockout_cleared'
  | 'authz.permission_denied'
  | 'auth.scope_changed'
  | 'auth.user_approved'
  | 'auth.user_rejected';

export interface AuthAuditPayload {
  tenantId?: string | null;
  actorId?: string | null;
  actorKind?: 'staff' | 'portal' | 'machine' | null;
  eventType: AuthEventType;
  outcome: 'allowed' | 'denied';
  /** Raw IP — will be hashed before storage. Never stored in plaintext. */
  rawIp?: string | null;
  route?: string | null;
  traceId: string;
  requiredPermission?: string | null;
  /** Reason code for failures (e.g. 'invalid_credentials', 'account_locked'). */
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

@Injectable()
export class AuthAuditEmitter {
  private readonly logger = new Logger(AuthAuditEmitter.name);

  constructor(private readonly auditService: AuditService) {}

  /**
   * Emit a structured log entry and write an immutable audit record.
   * Never throws — failures are logged as operator alerts.
   */
  async emit(payload: AuthAuditPayload): Promise<void> {
    const ipHash = hashIp(payload.rawIp);

    const event: AuthAuditEvent = {
      tenantId: payload.tenantId ?? null,
      actorId: payload.actorId ?? null,
      actorKind: payload.actorKind ?? null,
      eventType: payload.eventType,
      outcome: payload.outcome,
      requiredPermission: payload.requiredPermission ?? null,
      route: payload.route ?? null,
      ipAddress: ipHash,
      traceId: payload.traceId,
      metadata: {
        ...(payload.metadata ?? {}),
        ...(payload.reason ? { reason: payload.reason } : {}),
      },
    };

    // Structured log — IP and email are never in the log body.
    this.logger.log({
      eventType: payload.eventType,
      outcome: payload.outcome,
      actorId: payload.actorId,
      tenantId: payload.tenantId,
      route: payload.route,
      traceId: payload.traceId,
      ipHash,
      reason: payload.reason,
    });

    // Write immutable audit record (fail never suppresses the security action).
    await this.auditService.writeAuthEvent(event);
  }
}
