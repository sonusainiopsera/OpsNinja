import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { isBaseAppError } from '@opsninja/shared';
import {
  AppError,
  RateLimitError,
  PayloadTooLargeError,
} from '../errors/app-error';
import { RequestContextService } from '../../observability/request-context';

/** Stable mapping from HTTP status codes to error codes for standard exceptions. */
const HTTP_STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  410: 'GONE',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMIT_EXCEEDED',
  500: 'INTERNAL_ERROR',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
};

/** Standard error response envelope — shape is frozen by WO-001. */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Array<{ field: string; issue: string }>;
    traceId: string;
  };
}

/**
 * Global exception filter — the single funnel for every error thrown in the application.
 *
 * Mapping rules (in evaluation order):
 * 1. BaseAppError / AppError subclasses → declared httpStatus + code
 * 2. Zod validation errors → 400 VALIDATION_ERROR with per-field details
 * 3. NestJS HttpException → HTTP status with a stable code mapping
 * 4. Express body-parser errors (entity.too.large) → 413 PAYLOAD_TOO_LARGE
 * 5. Unknown throwables → 500 INTERNAL_ERROR; stack is logged but never returned
 *
 * Stack traces, SQL fragments, and secrets are NEVER included in the response body
 * in any environment.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const traceId = RequestContextService.getTraceId();
    const extraHeaders: Record<string, string> = {};

    let httpStatus: number;
    let code: string;
    let message: string;
    let details: Array<{ field: string; issue: string }>;

    // ── 1. BaseAppError (covers AppError + TamperedCursorError from packages/shared) ──
    if (isBaseAppError(exception)) {
      httpStatus = exception.httpStatus;
      code = exception.code;
      message = exception.message;
      details = exception.details;

      // Attach Retry-After header for rate-limit errors
      if (exception instanceof RateLimitError) {
        extraHeaders['Retry-After'] = String(exception.retryAfter);
      }
    }

    // ── 2. Zod validation errors ──────────────────────────────────────────────
    else if (exception instanceof ZodError) {
      httpStatus = 400;
      code = 'VALIDATION_ERROR';
      message = 'Validation failed';
      details = exception.errors.map((e) => ({
        field: e.path.join('.') || '_root',
        issue: e.message,
      }));
    }

    // ── 3. NestJS HttpException ───────────────────────────────────────────────
    else if (exception instanceof HttpException) {
      httpStatus = exception.getStatus();
      code = HTTP_STATUS_CODES[httpStatus] ?? 'HTTP_ERROR';

      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
        details = [];
      } else if (typeof body === 'object' && body !== null) {
        const bodyObj = body as Record<string, unknown>;
        // NestJS ValidationPipe returns { message: string[] }
        if (Array.isArray(bodyObj['message'])) {
          message = 'Validation failed';
          details = (bodyObj['message'] as string[]).map((m) => ({
            field: '_root',
            issue: m,
          }));
        } else {
          message = typeof bodyObj['message'] === 'string'
            ? bodyObj['message']
            : exception.message;
          details = [];
        }
      } else {
        message = exception.message;
        details = [];
      }
    }

    // ── 4. Express body-parser error (entity.too.large) ──────────────────────
    else if (
      exception !== null &&
      typeof exception === 'object' &&
      'type' in exception &&
      (exception as Record<string, unknown>)['type'] === 'entity.too.large'
    ) {
      const payloadError = new PayloadTooLargeError();
      httpStatus = payloadError.httpStatus;
      code = payloadError.code;
      message = payloadError.message;
      details = [];
    }

    // ── 5. Unknown throwable — log internally, never leak details ─────────────
    else {
      httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
      code = 'INTERNAL_ERROR';
      message = 'An unexpected error occurred';
      details = [];

      // Log the full error with context so support can correlate via traceId
      this.logger.error(
        {
          traceId,
          err: exception instanceof Error
            ? {
                name: exception.name,
                message: exception.message,
                stack: exception.stack,
              }
            : String(exception),
        },
        `Unhandled exception [${traceId}]`,
      );
    }

    // ── Assemble and send envelope ─────────────────────────────────────────────
    Object.entries(extraHeaders).forEach(([key, value]) => {
      response.setHeader(key, value);
    });

    const envelope: ErrorEnvelope = {
      error: { code, message, details, traceId },
    };

    response.status(httpStatus).json(envelope);
  }

  /**
   * Maps an AppError instance to HTTP status + envelope for logging / auditing.
   * Exposed as a static helper so tests can call it without the full Nest context.
   */
  static toEnvelope(
    exception: unknown,
    traceId: string,
  ): { status: number; body: ErrorEnvelope } {
    let httpStatus: number;
    let code: string;
    let message: string;
    let details: Array<{ field: string; issue: string }>;

    if (isBaseAppError(exception)) {
      httpStatus = exception.httpStatus;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof ZodError) {
      httpStatus = 400;
      code = 'VALIDATION_ERROR';
      message = 'Validation failed';
      details = exception.errors.map((e) => ({
        field: e.path.join('.') || '_root',
        issue: e.message,
      }));
    } else if (exception instanceof HttpException) {
      httpStatus = exception.getStatus();
      code = HTTP_STATUS_CODES[httpStatus] ?? 'HTTP_ERROR';
      message = exception.message;
      details = [];
    } else {
      httpStatus = 500;
      code = 'INTERNAL_ERROR';
      message = 'An unexpected error occurred';
      details = [];
    }

    return {
      status: httpStatus,
      body: { error: { code, message, details, traceId } },
    };
  }
}
