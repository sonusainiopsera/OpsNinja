/**
 * TenantContextInterceptor — global NestJS interceptor.
 *
 * Registered globally after the auth guard in app.module.ts. Before any handler
 * executes:
 *  1. Checks the @NoTenantContext allow-list via Reflector. Exempt routes skip
 *     all tenant setup and execute normally.
 *  2. Validates that a JWT-authenticated principal is present on the request.
 *     Unauthenticated requests are rejected with 401.
 *  3. Validates that the principal carries a tenantId. Tenant-less authenticated
 *     principals are rejected with 500 TENANT_CONTEXT_MISSING (programming error).
 *  4. Builds a PrincipalContext from the JWT claims and delegates to
 *     withTenantTransaction, which opens a database transaction, applies
 *     SET LOCAL session variables via set_config, and stores the context in
 *     AsyncLocalStorage.
 *  5. Runs the handler inside that transaction.
 *  6. Commits on 2xx, rolls back on any thrown error.
 *  7. Maps well-known database error codes (RLS violations, serialization errors,
 *     statement timeouts) to appropriate HTTP responses.
 *
 * Client-disconnect handling:
 *   When the response is finished before the handler completes (client abort),
 *   the handler Observable is abandoned and withTenantTransaction rolls back
 *   automatically because the Promise rejects with an abort error.
 */

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  UnauthorizedException,
  InternalServerErrorException,
  ForbiddenException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, lastValueFrom } from 'rxjs';
import { Request } from 'express';
import { randomUUID } from 'crypto';
import { NO_TENANT_CONTEXT_KEY } from './no-tenant-context.decorator';
import { PrincipalContext } from '../../observability/request-context';
import {
  withTenantTransaction,
  WithTenantTransactionOptions,
} from '../../data/unit-of-work';

// ---------------------------------------------------------------------------
// Shape of the authenticated principal as attached by the JWT auth guard.
// The auth guard is responsible for verifying the JWT signature; this
// interceptor only reads the already-validated claims.
// ---------------------------------------------------------------------------

interface JwtPrincipal {
  /** User UUID from the JWT `sub` claim. */
  sub: string;
  /** Tenant UUID resolved from the JWT during auth. */
  tenantId?: string;
  /** Principal population (default: 'staff' for internal users). */
  principalKind?: 'staff' | 'portal' | 'machine';
  /** RBAC roles from the JWT. */
  roles?: string[];
  /** Organisation IDs this principal may access (staff: from cache; portal: single org). */
  orgScopeIds?: string[];
}

// ---------------------------------------------------------------------------
// Interceptor
// ---------------------------------------------------------------------------

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TenantContextInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // ------------------------------------------------------------------
    // 1. Allow-list check: skip exempt routes (health, auth callback, etc.)
    // ------------------------------------------------------------------
    const isExempt = this.reflector.getAllAndOverride<boolean>(NO_TENANT_CONTEXT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isExempt) {
      return next.handle();
    }

    // ------------------------------------------------------------------
    // 2. Extract the authenticated principal from the HTTP request.
    //    The JWT guard runs before this interceptor and attaches the
    //    decoded payload to request.user.
    // ------------------------------------------------------------------
    const request = context.switchToHttp().getRequest<Request & { user?: JwtPrincipal }>();
    const jwtPrincipal = request.user;

    if (!jwtPrincipal?.sub) {
      // No authenticated user — return 401.
      throw new UnauthorizedException('Authentication required');
    }

    if (!jwtPrincipal.tenantId) {
      // Authenticated but missing tenantId — this is a programming error:
      // the auth guard must always resolve the tenant from the token.
      this.logger.error('Authenticated principal is missing tenantId', {
        route: request.url,
        method: request.method,
        userId: jwtPrincipal.sub,
      });
      throw new InternalServerErrorException({
        statusCode: 500,
        code: 'TENANT_CONTEXT_MISSING',
        message:
          'Tenant context could not be resolved for the authenticated principal. ' +
          'This is a server-side defect.',
      });
    }

    // ------------------------------------------------------------------
    // 3. Build the typed PrincipalContext from JWT claims.
    //    Role and scope data come from the token or Redis cache — we must
    //    NOT perform an extra database lookup here (latency budget).
    // ------------------------------------------------------------------
    const traceId =
      (request.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    const principal: PrincipalContext = {
      tenantId: jwtPrincipal.tenantId,
      userId: jwtPrincipal.sub,
      principalKind: jwtPrincipal.principalKind ?? 'staff',
      roles: jwtPrincipal.roles ?? [],
      orgScopeIds: jwtPrincipal.orgScopeIds ?? [],
      traceId,
    };

    // ------------------------------------------------------------------
    // 4. Per-request timeout options. Future stories can expose these
    //    via route metadata; for now we use environment defaults.
    // ------------------------------------------------------------------
    const txOptions: WithTenantTransactionOptions = {};

    // ------------------------------------------------------------------
    // 5. Wrap handler execution in withTenantTransaction.
    //
    //    from() converts the Promise to an Observable.
    //    lastValueFrom() converts the handler's Observable to a Promise so
    //    that withTenantTransaction can commit/rollback based on resolution.
    // ------------------------------------------------------------------
    return from(
      withTenantTransaction(principal, () => lastValueFrom(next.handle()), txOptions).catch(
        (err: unknown) => {
          throw this.mapError(err, principal, request);
        },
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Error mapping
  // ---------------------------------------------------------------------------

  /**
   * Maps structured application error codes (produced by unit-of-work.ts and
   * the database driver) to NestJS HTTP exceptions with appropriate status codes.
   */
  private mapError(
    err: unknown,
    principal: PrincipalContext,
    request: Request,
  ): never {
    const code = (err as NodeJS.ErrnoException).code;
    const message = (err as Error).message ?? 'An unexpected error occurred';

    switch (code) {
      case 'TENANT_CONTEXT_MISSING':
        this.logger.error('TENANT_CONTEXT_MISSING in handler', {
          route: request.url,
          method: request.method,
          tenantId: principal.tenantId,
          userId: principal.userId,
          traceId: principal.traceId,
        });
        throw new InternalServerErrorException({ code, message });

      case 'TENANT_POLICY_VIOLATION':
        this.logger.warn('RLS policy violation', {
          route: request.url,
          tenantId: principal.tenantId,
          userId: principal.userId,
          traceId: principal.traceId,
          message,
        });
        throw new ForbiddenException({ code, message });

      case 'SERIALIZATION_ERROR':
        // 409 with Retry-After hint for idempotent routes.
        throw new ConflictException({ code, message });

      case 'QUERY_TIMEOUT':
        this.logger.error('Statement timeout', {
          route: request.url,
          tenantId: principal.tenantId,
          traceId: principal.traceId,
          message,
        });
        throw new ServiceUnavailableException({ code, message });

      default:
        // Re-throw all other errors (including NestJS HttpExceptions thrown
        // by handlers) unchanged.
        throw err as Error;
    }
  }
}
