/**
 * TenantErrorFilter – maps database and tenant-related errors to structured
 * HTTP responses.
 *
 * Error code → HTTP mapping:
 *   TENANT_CONTEXT_MISSING   → 500  (programming defect, logged at error)
 *   TENANT_POLICY_VIOLATION  → 403
 *   QUERY_TIMEOUT            → 503  (includes Retry-After hint)
 *   SERIALIZATION_FAILURE    → 409  (includes Retry-After hint)
 *   CLIENT_DISCONNECTED      → 499  (no body; connection already gone)
 */

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ErrorCode,
  PG_INSUFFICIENT_PRIVILEGE,
  PG_QUERY_TIMEOUT,
  PG_SERIALIZATION_FAILURE,
} from '../errors/app-errors';
import { TenantContextMissingError } from '../../observability/request-context';

interface PgError extends Error {
  code?: string;
}

@Catch()
export class TenantErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(TenantErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    if (res.headersSent) {
      return;
    }

    // ── Client disconnected ────────────────────────────────────────────────────
    if (exception instanceof Error && exception.message === 'CLIENT_DISCONNECTED') {
      res.status(499).end();
      return;
    }

    // ── Tenant context missing ─────────────────────────────────────────────────
    if (exception instanceof TenantContextMissingError) {
      this.logger.error('TENANT_CONTEXT_MISSING', exception.stack);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: ErrorCode.TENANT_CONTEXT_MISSING,
        message: 'Internal tenant resolution error.',
      });
      return;
    }

    // ── PostgreSQL errors ──────────────────────────────────────────────────────
    const pgError = exception as PgError;
    if (pgError?.code === PG_INSUFFICIENT_PRIVILEGE) {
      res.status(HttpStatus.FORBIDDEN).json({
        statusCode: HttpStatus.FORBIDDEN,
        code: ErrorCode.TENANT_POLICY_VIOLATION,
        message: 'Access denied by security policy.',
      });
      return;
    }

    if (pgError?.code === PG_QUERY_TIMEOUT) {
      res
        .status(HttpStatus.SERVICE_UNAVAILABLE)
        .setHeader('Retry-After', '5')
        .json({
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          code: ErrorCode.QUERY_TIMEOUT,
          message: 'Query exceeded the allowed execution time.',
        });
      return;
    }

    if (pgError?.code === PG_SERIALIZATION_FAILURE) {
      res
        .status(HttpStatus.CONFLICT)
        .setHeader('Retry-After', '1')
        .json({
          statusCode: HttpStatus.CONFLICT,
          code: ErrorCode.SERIALIZATION_FAILURE,
          message: 'Transaction conflict; please retry.',
        });
      return;
    }

    // ── Fall through to NestJS default exception handler ──────────────────────
    throw exception;
  }
}
