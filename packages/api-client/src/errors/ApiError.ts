/**
 * ApiError — typed error class for all non-2xx API responses.
 *
 * Every error from the transport layer is an ApiError; nothing escapes untyped.
 * Consumers branch on the type-guard helpers rather than raw status literals.
 *
 * 404 discipline: a notFound error must never be presented to users as a
 * permission message — the backend intentionally returns 404 for out-of-scope
 * resources to avoid existence disclosure. Consumer code must never map
 * isNotFound() to "you don't have permission to view this".
 */

export interface ApiErrorOptions {
  status: number;
  code: string;
  message: string;
  details: unknown[];
  traceId: string;
  retryAfterMs?: number;
  /** For 409: server-supplied current entity version for optimistic-concurrency resolution. */
  currentVersion?: string | null;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown[];
  readonly traceId: string;
  readonly retryAfterMs: number;
  readonly currentVersion: string | null;

  constructor(opts: ApiErrorOptions) {
    super(opts.message);
    this.name = 'ApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.details = opts.details;
    this.traceId = opts.traceId;
    this.retryAfterMs = opts.retryAfterMs ?? 0;
    this.currentVersion = opts.currentVersion ?? null;
    // Maintain proper prototype chain in transpiled targets.
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  /** 400 — schema validation failure; details array carries field-level errors. */
  isValidationError(): boolean {
    return this.status === 400;
  }

  /**
   * 401 — unauthenticated.
   * NOTE: Use isExpiredToken() or isScopeChanged() for specific handling —
   * a generic 401 check is almost never sufficient.
   */
  isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /** 401 with expired access token code — safe to silently refresh and replay. */
  isExpiredToken(): boolean {
    return this.status === 401 && EXPIRED_TOKEN_CODES.has(this.code);
  }

  /**
   * 401 with scope-change code — MUST NOT be silently retried.
   * Forces re-authorization; stale org scope must never be honoured.
   */
  isScopeChanged(): boolean {
    return this.status === 401 && SCOPE_CHANGED_CODES.has(this.code);
  }

  /** 403 — authenticated but forbidden. */
  isForbidden(): boolean {
    return this.status === 403;
  }

  /**
   * 404 — resource not found OR out of scope.
   * NEVER render this as a permission error — the backend uses 404 for
   * out-of-scope resources to avoid revealing existence to unauthorised callers.
   */
  isNotFound(): boolean {
    return this.status === 404;
  }

  /** 409 — optimistic-concurrency conflict; currentVersion carries server state for reload-and-merge. */
  isConflict(): boolean {
    return this.status === 409;
  }

  /** 422 — business rule rejection. */
  isBusinessRule(): boolean {
    return this.status === 422;
  }

  /** 429 — rate limited; retryAfterMs carries the backoff duration. */
  isRateLimited(): boolean {
    return this.status === 429;
  }

  /** True for any server error (5xx). */
  isServerError(): boolean {
    return this.status >= 500;
  }
}

/** 401 codes that indicate an expired access token — safe to refresh and replay. */
export const EXPIRED_TOKEN_CODES = new Set([
  'AUTH_TOKEN_EXPIRED',
  'token_expired',
]);

/**
 * 401 codes that indicate a scope / org-scope version change.
 * These MUST NOT be silently retried — they require forced re-authorization.
 */
export const SCOPE_CHANGED_CODES = new Set([
  'AUTH_REAUTHORIZE_REQUIRED',
  'org_scope_changed',
  'scope_version_stale',
  'SCOPE_VERSION_STALE',
]);

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}
