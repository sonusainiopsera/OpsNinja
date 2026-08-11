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

  // ── Rate-limiting / throttle error codes ─────────────────────────────────
  /**
   * Too many authentication attempts from this email or IP.
   * The client must honour the Retry-After response header.
   * Response body is identical for existing and non-existing accounts to
   * prevent account-enumeration.
   */
  AUTH_RATE_LIMITED: 'AUTH_RATE_LIMITED',

  // ── Org-scope error codes ─────────────────────────────────────────────────
  /**
   * Token's org_scope_version is behind the server-side counter.
   * Client should call POST /auth/refresh to obtain a token with the latest
   * scope version, then retry the original request.
   * @deprecated Use AUTH_REAUTHORIZE_REQUIRED — this alias is kept for backwards compatibility.
   */
  SCOPE_VERSION_STALE: 'SCOPE_VERSION_STALE',

  /**
   * Token claims are structurally valid but reflect an outdated authorization
   * state (e.g. org_scope_version is behind the server-side counter).
   * Client must call POST /auth/refresh to obtain a token embedding the latest
   * scope version, then retry the original request.
   * Response body: { code: AUTH_REAUTHORIZE_REQUIRED, details: [{ reason: 'scope_changed' }] }
   */
  AUTH_REAUTHORIZE_REQUIRED: 'AUTH_REAUTHORIZE_REQUIRED',

  /**
   * A PUT /users/:userId/org-scope body contained an organization_id that does
   * not belong to the caller's tenant. Cross-tenant scope assignments are rejected
   * with 422.
   */
  ORG_SCOPE_INVALID_ORGANIZATION: 'ORG_SCOPE_INVALID_ORGANIZATION',

  /** Resource not found (also used for out-of-scope resources to mask existence). */
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',

  // ── Portal verification error codes ──────────────────────────────────────
  /** Verification token signature or hash is invalid (potential tampering). */
  VERIFICATION_TOKEN_INVALID: 'VERIFICATION_TOKEN_INVALID',
  /** Verification token TTL has expired (24 hours). */
  VERIFICATION_TOKEN_EXPIRED: 'VERIFICATION_TOKEN_EXPIRED',
  /** Verification token was already consumed by a previous request. */
  VERIFICATION_TOKEN_CONSUMED: 'VERIFICATION_TOKEN_CONSUMED',
  /** Signup request's bound organization is inactive and cannot be activated. */
  ORGANIZATION_INACTIVE: 'ORGANIZATION_INACTIVE',

  // ── CSAT error codes ─────────────────────────────────────────────────────
  /** CSAT token is unknown — no survey row exists for this hash. */
  CSAT_TOKEN_UNKNOWN: 'CSAT_TOKEN_UNKNOWN',
  /** CSAT token is past its expires_at timestamp. */
  CSAT_TOKEN_EXPIRED: 'CSAT_TOKEN_EXPIRED',
  /** Survey has already been responded to; second submission rejected. */
  CSAT_ALREADY_RESPONDED: 'CSAT_ALREADY_RESPONDED',
  /** Request rate limit exceeded for this CSAT token or IP. */
  CSAT_RATE_LIMITED: 'CSAT_RATE_LIMITED',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// ─── PostgreSQL error codes ────────────────────────────────────────────────────
/** pg error code for statement_timeout */
export const PG_QUERY_TIMEOUT = '57014';
/** pg error code for serialization failure */
export const PG_SERIALIZATION_FAILURE = '40001';
/** pg error code for RLS policy violation (insufficient_privilege) */
export const PG_INSUFFICIENT_PRIVILEGE = '42501';
