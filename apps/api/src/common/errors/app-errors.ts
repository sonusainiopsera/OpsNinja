/**
 * Stable application error codes.
 *
 * These codes are included in error response bodies and alert metrics.
 * They are intentionally stable – never rename a code once it has shipped.
 */

export const ErrorCode = {
  /** Tenant could not be resolved before handler execution (programming defect). */
  TENANT_CONTEXT_MISSING: 'TENANT_CONTEXT_MISSING',

  /** RLS policy blocked the query – the principal lacks access to the requested row. */
  TENANT_POLICY_VIOLATION: 'TENANT_POLICY_VIOLATION',

  /** Statement exceeded the per-request timeout budget. */
  QUERY_TIMEOUT: 'QUERY_TIMEOUT',

  /** Transaction was aborted due to a serialization failure; caller should retry. */
  SERIALIZATION_FAILURE: 'SERIALIZATION_FAILURE',

  /** The authenticated principal maps to a deactivated tenant. */
  TENANT_DEACTIVATED: 'TENANT_DEACTIVATED',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// ─── PostgreSQL error codes ────────────────────────────────────────────────────
/** pg error code for statement_timeout */
export const PG_QUERY_TIMEOUT = '57014';
/** pg error code for serialization failure */
export const PG_SERIALIZATION_FAILURE = '40001';
/** pg error code for RLS policy violation (insufficient_privilege) */
export const PG_INSUFFICIENT_PRIVILEGE = '42501';
