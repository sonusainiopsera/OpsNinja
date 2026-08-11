/**
 * Stable application error codes.
 *
 * These codes are included in error response bodies and alert metrics.
 * They are intentionally stable – never rename a code once it has shipped.
 */

export const ErrorCode = {
  /** Tenant could not be resolved before handler execution (programming defect). */
  TENANT_CONTEXT_MISSING: 'TENANT_CONTEXT_MISSING',

  /** AuditContext was not set before a mutation attempted AuditWriter.append() (programming defect). */
  AUDIT_CONTEXT_MISSING: 'AUDIT_CONTEXT_MISSING',

  /** RLS policy blocked the query – the principal lacks access to the requested row. */
  TENANT_POLICY_VIOLATION: 'TENANT_POLICY_VIOLATION',

  /** Statement exceeded the per-request timeout budget. */
  QUERY_TIMEOUT: 'QUERY_TIMEOUT',

  /** Transaction was aborted due to a serialization failure; caller should retry. */
  SERIALIZATION_FAILURE: 'SERIALIZATION_FAILURE',

  /** The authenticated principal maps to a deactivated tenant. */
  TENANT_DEACTIVATED: 'TENANT_DEACTIVATED',

  // ── Auth / session error codes ───────────────────────────────────────────
  /** Refresh cookie is absent from the request. */
  AUTH_REFRESH_MISSING: 'AUTH_REFRESH_MISSING',
  /** Refresh token is malformed, not found, or already expired in Redis. */
  AUTH_REFRESH_INVALID: 'AUTH_REFRESH_INVALID',
  /** Refresh token's Redis TTL has expired. */
  AUTH_REFRESH_EXPIRED: 'AUTH_REFRESH_EXPIRED',
  /** A previously rotated refresh token was presented — session family revoked. */
  AUTH_REFRESH_REUSED: 'AUTH_REFRESH_REUSED',
  /** Redis is unavailable; client should retry with Retry-After. */
  AUTH_SESSION_STORE_UNAVAILABLE: 'AUTH_SESSION_STORE_UNAVAILABLE',
  /** Generic unauthenticated (missing Bearer token). */
  UNAUTHENTICATED: 'UNAUTHENTICATED',

  // ── Token error codes ────────────────────────────────────────────────────
  /** Bearer token is absent from the request. */
  AUTH_TOKEN_MISSING: 'AUTH_TOKEN_MISSING',
  /** Bearer token is syntactically valid but the exp claim is in the past. */
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  /** Bearer token signature, issuer, or claims are invalid. */
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',

  // ── Authorization error codes ────────────────────────────────────────────
  /** Principal lacks the required permission for this route. */
  AUTHZ_PERMISSION_DENIED: 'AUTHZ_PERMISSION_DENIED',
  /** Token audience does not match the permission tier required by the route. */
  AUTHZ_AUDIENCE_MISMATCH: 'AUTHZ_AUDIENCE_MISMATCH',

  // ── Portal error codes ────────────────────────────────────────────────────
  /** Portal client attempted to set a field reserved for internal/staff use. */
  PORTAL_FIELD_NOT_ALLOWED: 'PORTAL_FIELD_NOT_ALLOWED',

  // ── Org-scope error codes ─────────────────────────────────────────────────
  /**
   * Token's org_scope_version is behind the server-side counter.
   * Client should call POST /auth/refresh to obtain a token with the latest
   * scope version, then retry the original request.
   */
  SCOPE_VERSION_STALE: 'SCOPE_VERSION_STALE',

  /** Resource not found (also used for out-of-scope resources to mask existence). */
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// ─── PostgreSQL error codes ────────────────────────────────────────────────────
/** pg error code for statement_timeout */
export const PG_QUERY_TIMEOUT = '57014';
/** pg error code for serialization failure */
export const PG_SERIALIZATION_FAILURE = '40001';
/** pg error code for RLS policy violation (insufficient_privilege) */
export const PG_INSUFFICIENT_PRIVILEGE = '42501';
