import { BaseAppError } from '@opsninja/shared';

// Re-export the base class so all errors in the app can be checked via
// `instanceof AppError` without importing from packages/shared directly.
export { BaseAppError };

/**
 * Application-level error base class.
 * All domain errors extend this, carrying a stable UPPER_SNAKE code,
 * an HTTP status, and optional per-field details for validation errors.
 *
 * The error envelope is frozen after WO-001:
 *   { error: { code, message, details, traceId } }
 */
export class AppError extends BaseAppError {}

// ─── HTTP 400 — Bad Request ────────────────────────────────────────────────────

/** Input failed schema validation; details array contains per-field issues. */
export class ValidationError extends AppError {
  constructor(details: Array<{ field: string; issue: string }>) {
    super('VALIDATION_ERROR', 'Validation failed', 400, details);
    this.name = 'ValidationError';
  }
}

// ─── HTTP 401 — Unauthenticated ────────────────────────────────────────────────

/** Request lacks valid authentication credentials. */
export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super('UNAUTHORIZED', message, 401, []);
    this.name = 'UnauthorizedError';
  }
}

// ─── HTTP 403 — Forbidden ─────────────────────────────────────────────────────

/** Authenticated principal lacks permission for the requested operation. */
export class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super('FORBIDDEN', message, 403, []);
    this.name = 'ForbiddenError';
  }
}

// ─── HTTP 404 — Not Found ─────────────────────────────────────────────────────

/** The requested resource does not exist (or is outside the caller's scope). */
export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    const msg = id ? `${resource} '${id}' not found` : `${resource} not found`;
    super('NOT_FOUND', msg, 404, []);
    this.name = 'NotFoundError';
  }
}

// ─── HTTP 409 — Conflict ──────────────────────────────────────────────────────

/** Optimistic-lock version conflict; client should refresh and retry. */
export class ConflictError extends AppError {
  constructor(message = 'Resource version conflict — refresh and retry') {
    super('CONFLICT', message, 409, []);
    this.name = 'ConflictError';
  }
}

// ─── HTTP 422 — Unprocessable Entity ─────────────────────────────────────────

/** Business-rule rejection; the input is well-formed but semantically invalid. */
export class UnprocessableEntityError extends AppError {
  constructor(message: string, details: Array<{ field: string; issue: string }> = []) {
    super('UNPROCESSABLE_ENTITY', message, 422, details);
    this.name = 'UnprocessableEntityError';
  }
}

// ─── HTTP 429 — Too Many Requests ────────────────────────────────────────────

/** Rate limit exceeded; includes Retry-After seconds. */
export class RateLimitError extends AppError {
  constructor(
    public readonly retryAfter: number,
    message = 'Rate limit exceeded',
  ) {
    super('RATE_LIMIT_EXCEEDED', message, 429, []);
    this.name = 'RateLimitError';
  }
}

// ─── HTTP 413 — Payload Too Large ─────────────────────────────────────────────

/** Request body exceeds the configured size limit. */
export class PayloadTooLargeError extends AppError {
  constructor(message = 'Request payload exceeds the maximum allowed size') {
    super('PAYLOAD_TOO_LARGE', message, 413, []);
    this.name = 'PayloadTooLargeError';
  }
}
