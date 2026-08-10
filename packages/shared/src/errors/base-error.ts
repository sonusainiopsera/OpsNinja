/**
 * Base error class for OpsNinja application errors.
 * Framework-agnostic — no NestJS dependency.
 * Carries HTTP status, stable error code, and per-field details for API responses.
 */
export class BaseAppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number,
    public readonly details: Array<{ field: string; issue: string }> = [],
  ) {
    super(message);
    this.name = 'AppError';
    // Restore prototype chain (required for instanceof checks in transpiled TS)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Type guard — returns true if the thrown value is a BaseAppError instance.
 * Useful in exception filters that need to handle both apps/api errors and
 * shared package errors (e.g. TamperedCursorError).
 */
export function isBaseAppError(e: unknown): e is BaseAppError {
  return e instanceof BaseAppError;
}
