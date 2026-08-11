/**
 * AuditInterceptor – populates AuditContext for every authenticated request.
 *
 * Must be registered AFTER TenantContextInterceptor so the DB transaction is
 * already open when handler code calls AuditWriter.append().
 *
 * Execution order in the NestJS pipeline:
 *   AuthGuard
 *     → TenantContextInterceptor (outer APP_INTERCEPTOR, opens DB transaction)
 *       → AuditInterceptor       (inner APP_INTERCEPTOR, populates AuditContext)
 *         → Handler
 *
 * The interceptor resolves:
 *   tenantId   – from request.user (principal)
 *   actorType  – 'user' for staff/portal, 'machine' mapped to 'integration'
 *   actorId    – principal.userId
 *   actorRole  – first role in principal.roles (highest precedence)
 *   traceId    – x-trace-id header or principal.traceId
 *   requestId  – x-request-id header or randomUUID()
 *   hashedIp   – SHA-256 prefix of x-forwarded-for or socket remoteAddress
 *   userAgent  – user-agent header
 *
 * @NoTenantContext routes are exempted — they have no principal.
 */

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { randomUUID } from 'crypto';
import type { Request } from 'express';
import { AuditContext, AuditActorType } from './audit-context';
import { NO_TENANT_CONTEXT_KEY } from '../tenant/no-tenant-context.decorator';
import type { PrincipalContext } from '../../observability/request-context';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const isExempt = this.reflector.getAllAndOverride<boolean>(NO_TENANT_CONTEXT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isExempt) {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<Request & { user?: PrincipalContext }>();
    const principal = req.user;

    if (!principal) {
      // No principal means the request will be rejected by upstream guards.
      // Run without an audit context — the guard writes its own denial record.
      return next.handle();
    }

    const traceId =
      (req.headers['x-trace-id'] as string | undefined) ??
      principal.traceId ??
      randomUUID();

    const requestId =
      (req.headers['x-request-id'] as string | undefined) ??
      randomUUID();

    const rawIp =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      req.socket?.remoteAddress ??
      null;

    const hashedIp = rawIp ? AuditContext.hashIp(rawIp) : null;
    const userAgent = (req.headers['user-agent'] as string | undefined) ?? null;

    const actorType = resolveActorType(principal.principalKind);

    const auditCtx = {
      tenantId: principal.tenantId,
      actorType,
      actorId: principal.userId,
      actorRole: principal.roles[0] ?? null,
      traceId,
      requestId,
      hashedIp,
      userAgent,
      source: null,
    };

    return new Observable((subscriber) => {
      AuditContext.run(auditCtx, () =>
        new Promise<void>((resolve, reject) => {
          next.handle().subscribe({
            next: (value) => subscriber.next(value),
            error: (err) => {
              subscriber.error(err);
              reject(err);
            },
            complete: () => {
              subscriber.complete();
              resolve();
            },
          });
        }),
      ).catch((err) => {
        this.logger.error('AuditInterceptor: unhandled error in audit context', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });
  }
}

function resolveActorType(kind: string): AuditActorType {
  switch (kind) {
    case 'machine': return 'integration';
    case 'portal':
    case 'staff':
    default:
      return 'user';
  }
}
