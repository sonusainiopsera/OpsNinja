export type ErrorDetail = {
  field?: string;
  message?: string;
  [key: string]: unknown;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ErrorDetail[];
  readonly traceId: string;
  readonly retryAfterMs: number | undefined;

  constructor(params: {
    status: number;
    code: string;
    message: string;
    details?: ErrorDetail[];
    traceId?: string;
    retryAfterMs?: number;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.status = params.status;
    this.code = params.code;
    this.details = params.details ?? [];
    this.traceId = params.traceId ?? '';
    this.retryAfterMs = params.retryAfterMs;
    // Maintain prototype chain in transpiled environments
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

export function isValidationError(err: unknown): err is ApiError & { status: 400 } {
  return isApiError(err) && err.status === 400;
}

export function isUnauthenticated(err: unknown): err is ApiError & { status: 401 } {
  return isApiError(err) && err.status === 401;
}

export function isForbidden(err: unknown): err is ApiError & { status: 403 } {
  return isApiError(err) && err.status === 403;
}

export function isNotFound(err: unknown): err is ApiError & { status: 404 } {
  return isApiError(err) && err.status === 404;
}

export function isConflict(err: unknown): err is ApiError & { status: 409 } {
  return isApiError(err) && err.status === 409;
}

export function isBusinessRule(err: unknown): err is ApiError & { status: 422 } {
  return isApiError(err) && err.status === 422;
}

export function isRateLimited(err: unknown): err is ApiError & { status: 429 } {
  return isApiError(err) && err.status === 429;
}

export function isTransportError(err: unknown): err is ApiError & { status: 0 } {
  return isApiError(err) && err.status === 0;
}
