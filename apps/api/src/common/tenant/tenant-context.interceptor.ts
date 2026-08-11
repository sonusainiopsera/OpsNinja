/**
 * TenantContextInterceptor – global NestJS interceptor that binds a tenant
 * transaction to every authenticated HTTP request.
 *
 * Execution order in the NestJS pipeline:
 *   AuthGuard (validates JWT, attaches principal to request.user)
 *     → TenantContextInterceptor  ← this file
 *       → Handler
 *
 * Responsibilities:
 *   1. Consult Reflector metadata to honour @NoTenantContext exemptions.
 *   2. Reject unauthenticated requests (no request.user) with 401.
 *   3. Reject authenticated-but-tenant-less principals with 500
 *      TENANT_CONTEXT_MISSING and log the defect at error level.
 *   4. Open a database transaction via UnitOfWork.withTenantTransaction(),
 *      which issues all four SET LOCAL session variables in a single round trip.
 *   5. Commit on 2xx; roll back on any thrown error.
 *   6. Apply per-request statement_timeout and idle_in_transaction_session_timeout.
 *   7. Roll back and return the connection to the pool when the client disconnects.
 */

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  Logger,
  NestInterceptor,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Observable, from } from 'rxjs';
import { lastValueFrom } from 'rxjs';
import type { Request, Response } from 'express';
import { UnitOfWork } from '../../data/unit-of-work';
import { PrincipalContext, RequestContextStore } from '../../observability/request-context';
import { ErrorCode } from '../errors/app-errors';
import { NO_TENANT_CONTEXT_KEY } from './no-tenant-context.decorator';

/** The property on `request` where the auth guard attaches the principal. */
const REQUEST_USER_KEY = 'user';

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TenantContextInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly unitOfWork: UnitOfWork,
    private readonly config: ConfigService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Only handle HTTP requests.  WebSocket and RPC contexts don't go through
    // this interceptor; they use their own entry points.
    if (context.getType() !== 'http') {
      return next.handle();
    }

    // ── Exemption check ────────────────────────────────────────────────────────
    // @NoTenantContext on either the handler or the controller exempts the route.
    const isExempt = this.reflector.getAllAndOverride<boolean>(NO_TENANT_CONTEXT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isExempt) {
      return next.handle();
    }

    // ── Principal resolution ───────────────────────────────────────────────────
    const req = context.switchToHttp().getRequest<Request & { [REQUEST_USER_KEY]?: PrincipalContext }>();
    const res = context.switchToHttp().getResponse<Response>();
    const principal = req[REQUEST_USER_KEY];

    if (!principal) {
      throw new UnauthorizedException({
        message: 'Authentication required.',
        code: 'UNAUTHENTICATED',
      });
    }

    if (!principal.tenantId) {
      // The auth guard produced a principal without a tenant ID.  This is a
      // programming defect, not a user error.
      this.logger.error('Authenticated principal is missing tenantId', {
        code: ErrorCode.TENANT_CONTEXT_MISSING,
        userId: principal.userId,
        principalKind: principal.principalKind,
        traceId: principal.traceId,
        path: (req as unknown as { path?: string }).path,
      });
      throw new InternalServerErrorException({
        message: 'Internal tenant resolution error.',
        code: ErrorCode.TENANT_CONTEXT_MISSING,
      });
    }

    // ── Timeout configuration ──────────────────────────────────────────────────
    const statementTimeoutMs = this.config.get<number>('DB_STATEMENT_TIMEOUT_MS', 5_000);
    const idleInTransactionTimeoutMs = this.config.get<number>(
      'DB_IDLE_IN_TRANSACTION_TIMEOUT_MS',
      5_000,
    );

    // ── Client-disconnect abort signal ─────────────────────────────────────────
    // We create a Promise that rejects when the response is closed by the
    // client before the handler completes.  Racing it against the handler lets
    // us propagate the disconnect into the transaction and trigger rollback.
    // The definite-assignment assertion (!) is safe: the Promise constructor
    // callback runs synchronously, so disconnectReject is always set before
    // onClose or the withTenantTransaction call can reference it.
    let disconnectReject!: (err: Error) => void;
    const disconnectPromise = new Promise<never>((_, reject) => {
      disconnectReject = reject;
    });

    const onClose = () => {
      disconnectReject(new Error('CLIENT_DISCONNECTED'));
    };
    res.once('close', onClose);

    // ── Transaction wrapper ────────────────────────────────────────────────────
    // Convert the Observable returned by next.handle() to a Promise so we can
    // race it against the disconnect signal inside a try/finally that commits
    // or rolls back.  We convert the Promise back to an Observable for NestJS.
    const transactionPromise = this.unitOfWork
      .withTenantTransaction(
        principal,
        async (_tx) => {
          // Propagate request metadata into the context store.
          RequestContextStore._set({
            requestId: (req.headers['x-request-id'] as string | undefined) ?? principal.traceId,
            requestStartedAt: process.hrtime.bigint(),
          });

          return Promise.race([
            lastValueFrom(next.handle()),
            disconnectPromise,
          ]);
        },
        { statementTimeoutMs, idleInTransactionTimeoutMs },
      )
      .finally(() => {
        res.removeListener('close', onClose);
      });

    return from(transactionPromise);
  }
}
