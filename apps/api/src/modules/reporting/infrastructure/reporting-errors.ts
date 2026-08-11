/**
 * Typed errors for the reporting read-replica data source.
 *
 * All errors carry a stable machine-readable code and never include SQL text,
 * connection strings, stack traces, or credentials in their public message.
 */

// ── Error codes ────────────────────────────────────────────────────────────────

export const ReportingErrorCode = {
  /** pg 57014: statement_timeout fired on the replica */
  REPORT_QUERY_TIMEOUT: 'REPORT_QUERY_TIMEOUT',
  /** Row cap of 500 000 was exceeded */
  REPORT_ROW_LIMIT_EXCEEDED: 'REPORT_ROW_LIMIT_EXCEEDED',
  /** Replica pool unreachable or connection failed */
  REPORTING_REPLICA_UNAVAILABLE: 'REPORTING_REPLICA_UNAVAILABLE',
  /** Caller attempted to run a replica query without a tenant context */
  TENANT_CONTEXT_MISSING: 'TENANT_CONTEXT_MISSING',
} as const;

export type ReportingErrorCode = (typeof ReportingErrorCode)[keyof typeof ReportingErrorCode];

/** pg error code for statement_timeout */
export const PG_STATEMENT_TIMEOUT = '57014';

// ── Error classes ─────────────────────────────────────────────────────────────

/**
 * Thrown when pg 57014 fires on the replica.
 * Surface as HTTP 504 with a retry hint.
 */
export class StatementTimeoutError extends Error {
  readonly code = ReportingErrorCode.REPORT_QUERY_TIMEOUT;

  constructor(
    public readonly traceId: string,
    public readonly durationMs: number,
  ) {
    super('Report query exceeded the 30-second time limit. Please narrow your filters and retry.');
    this.name = 'StatementTimeoutError';
  }
}

/**
 * Thrown when a result set would exceed 500 000 rows.
 * Surface as HTTP 422.
 */
export class RowLimitExceededError extends Error {
  readonly code = ReportingErrorCode.REPORT_ROW_LIMIT_EXCEEDED;
  readonly cap = ROW_CAP;

  constructor(public readonly traceId: string) {
    super(
      `Report result exceeds the maximum of ${ROW_CAP.toLocaleString()} rows. ` +
        'Apply additional filters to narrow the dataset.',
    );
    this.name = 'RowLimitExceededError';
  }
}

/**
 * Thrown when the replica pool is unreachable.
 * Surface as HTTP 503.
 */
export class ReplicaUnavailableError extends Error {
  readonly code = ReportingErrorCode.REPORTING_REPLICA_UNAVAILABLE;

  constructor(public readonly traceId: string) {
    super('The reporting data source is temporarily unavailable. Please retry in a moment.');
    this.name = 'ReplicaUnavailableError';
  }
}

/**
 * Thrown when a replica query is attempted without a resolved tenant.
 * Internal invariant violation — surface as HTTP 500 and alert operators.
 */
export class ReplicaTenantContextMissingError extends Error {
  readonly code = ReportingErrorCode.TENANT_CONTEXT_MISSING;

  constructor(detail?: string) {
    super(
      `TENANT_CONTEXT_MISSING on replica${detail ? `: ${detail}` : ''}. ` +
        'All replica queries must be initiated through TenantScopedReplicaRunner.',
    );
    this.name = 'ReplicaTenantContextMissingError';
  }
}

/** Maximum rows before RowLimitExceededError is raised. */
export const ROW_CAP = 500_000;

/** The LIMIT injected server-side to detect cap overflow: ROW_CAP + 1 */
export const ROW_CAP_LIMIT = ROW_CAP + 1;
