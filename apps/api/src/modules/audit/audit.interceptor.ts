/**
 * AuditInterceptor — global NestJS interceptor that seeds AuditContext.
 *
 * Runs AFTER TenantContextInterceptor (registration order in app.module.ts
 * ensures this — NestJS executes APP_INTERCEPTOR providers in registration order).
 *
 * For each authenticated, tenant-scoped request, this interceptor:
 *  1. Reads the PrincipalContext (already bound by TenantContextInterceptor).
 *  2. Hashes the client IP with SHA-256 (never stores raw IP in audit).
 *  3. Binds AuditContext into AsyncLocalStorage via runWithAuditContext().
 *
 * Routes decorated with @NoTenantContext (auth endpoints) are skipped —
 * those events are handled by the AuditService for auth-specific records.
 */

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, lastValueFrom } from 'rxjs';
import { createHash } from 'crypto';
import { Request } from 'express';
import { NO_TENANT_CONTEXT_KEY } from '../../common/tenant/no-tenant-context.decorator';
import { getRequestContext } from '../../observability/request-context';
import { AuditContext, runWithAuditContext } from './audit-context';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Skip routes that run outside the tenant transaction (e.g. auth endpoints).
    const isExempt = this.reflector.getAllAndOverride<boolean>(NO_TENANT_CONTEXT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isExempt) {
      return next.handle();
    }

    const reqCtx = getRequestContext();
    if (!reqCtx?.principal) {
      // No principal bound yet — interceptor ran before tenant context; let it pass.
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const principal = reqCtx.principal;

    const rawIp =
      (request.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      request.socket?.remoteAddress ??
      '';

    const ipHash = rawIp
      ? createHash('sha256').update(rawIp).digest('hex')
      : null;

    const userAgent = (request.headers['user-agent'] as string | undefined) ?? null;

    const auditCtx: AuditContext = {
      tenantId: principal.tenantId,
      actorId: principal.userId,
      actorType: mapPrincipalKindToActorType(principal.principalKind),
      actorRole: principal.roles[0] ?? null,
      traceId: principal.traceId,
      requestId: (request.headers['x-request-id'] as string | undefined) ?? null,
      ipHash,
      userAgent,
      source: null,
    };

    return from(runWithAuditContext(auditCtx, () => lastValueFrom(next.handle())));
  }
}

function mapPrincipalKindToActorType(
  kind: 'staff' | 'portal' | 'machine',
): AuditContext['actorType'] {
  switch (kind) {
    case 'staff':
      return 'user';
    case 'portal':
      return 'user';
    case 'machine':
      return 'integration';
  }
}
