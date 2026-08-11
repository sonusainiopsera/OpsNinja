/**
 * AuthAuditEmitter – single funnel for all identity-module security events.
 *
 * All identity services call through this emitter rather than constructing
 * audit rows ad hoc.  This guarantees:
 *  - Consistent field naming and outcome codes across all auth events.
 *  - PII is never present in logged metadata (email/IP fields are hashed
 *    before reaching here).
 *  - Every event has actor, tenant, operation, outcome and traceId.
 *  - Audit write failures emit an OPERATOR_ALERT log and a metric increment
 *    but never silently drop the event (see AuditWriter.appendAuthEvent).
 *
 * Supported event actions:
 *   auth.login_success          — successful token issuance
 *   auth.login_failure          — failed authentication (wrong creds, MFA fail, etc.)
 *   auth.token_refreshed        — refresh token rotated
 *   auth.refresh_reuse_detected — replay of an already-rotated refresh token
 *   auth.logout                 — session explicitly revoked
 *   auth.throttle_lockout       — subject locked out due to repeated failures
 *   auth.throttle_unlocked      — admin cleared a throttle lockout
 *   auth.scope_changed          — org scope assignment mutated
 *   auth.access_denied          — authorization denial (403/401 path)
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { DB_TOKEN } from '../../../data/db.module';
import type { DB } from '@opsninja/db';
import { AuditWriter } from '../../../common/audit/audit-writer';

export type AuthEventAction =
  | 'auth.login_success'
  | 'auth.login_failure'
  | 'auth.token_refreshed'
  | 'auth.refresh_reuse_detected'
  | 'auth.logout'
  | 'auth.throttle_lockout'
  | 'auth.throttle_unlocked'
  | 'auth.scope_changed'
  | 'auth.access_denied';

export type AuthEventOutcome = 'success' | 'failure' | 'blocked' | 'warning';

export interface AuthAuditEventParams {
  action: AuthEventAction;
  outcome: AuthEventOutcome;
  actorId?: string | null;
  actorType?: 'user' | 'system' | 'anonymous';
  tenantId?: string | null;
  /** Reason code (e.g. 'wrong_password', 'scope_changed', 'lockout'). */
  reason?: string;
  /** Low-cardinality context only — no PII. Hashes are acceptable. */
  metadata?: Record<string, unknown>;
  traceId?: string;
  requestId?: string;
}

@Injectable()
export class AuthAuditEmitter {
  private readonly logger = new Logger(AuthAuditEmitter.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: DB,
    private readonly auditWriter: AuditWriter,
  ) {}

  async emit(params: AuthAuditEventParams): Promise<void> {
    try {
      await this.auditWriter.appendAuthEvent(this.db, {
        action: params.action,
        actorType: params.actorType ?? 'user',
        actorId: params.actorId ?? null,
        tenantId: params.tenantId ?? null,
        outcome: params.outcome,
        traceId: params.traceId,
        requestId: params.requestId,
        metadata: params.reason
          ? { reason: params.reason, ...params.metadata }
          : params.metadata ?? null,
      });
    } catch (err) {
      this.logger.error('OPERATOR_ALERT: AuthAuditEmitter failed to persist event', {
        action: params.action,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Convenience: emit a lockout-triggered event. */
  async emitLockout(params: {
    subjectType: string;
    subjectHash: string;
    tenantId?: string;
    traceId?: string;
  }): Promise<void> {
    await this.emit({
      action: 'auth.throttle_lockout',
      outcome: 'blocked',
      tenantId: params.tenantId,
      traceId: params.traceId,
      metadata: {
        subjectType: params.subjectType,
        subjectHash: params.subjectHash,
      },
    });
  }

  /** Convenience: emit an admin-unlock event. */
  async emitAdminUnlock(params: {
    actorId: string;
    tenantId: string;
    subjectHash: string;
    traceId?: string;
  }): Promise<void> {
    await this.emit({
      action: 'auth.throttle_unlocked',
      outcome: 'success',
      actorId: params.actorId,
      tenantId: params.tenantId,
      traceId: params.traceId,
      metadata: { subjectHash: params.subjectHash },
    });
  }
}
