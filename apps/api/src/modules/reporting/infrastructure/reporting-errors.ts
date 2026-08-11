interface PgLikeError {
  code?: string;
  message: string;
}

function isPgLikeError(err: unknown): err is PgLikeError {
  return typeof err === 'object' && err !== null && 'message' in err;
}

export class StatementTimeoutError extends Error {
  readonly code = 'REPORT_QUERY_TIMEOUT';

  constructor() {
    super('Reporting query exceeded the 30-second statement timeout');
    this.name = 'StatementTimeoutError';
  }
}

export class ReplicaUnavailableError extends Error {
  readonly code = 'REPORTING_REPLICA_UNAVAILABLE';

  constructor(cause?: string) {
    super(
      cause
        ? `Reporting replica is unavailable: ${cause}`
        : 'Reporting replica is unavailable',
    );
    this.name = 'ReplicaUnavailableError';
  }
}

export class RowLimitExceededError extends Error {
  readonly code = 'REPORT_ROW_LIMIT_EXCEEDED';

  constructor(readonly cap: number) {
    super(`Report result exceeded the maximum row limit of ${cap}`);
    this.name = 'RowLimitExceededError';
  }
}

export function mapReplicaError(err: unknown): unknown {
  if (!isPgLikeError(err)) return err;

  // PostgreSQL statement_timeout cancellation
  if (err.code === '57014') {
    return new StatementTimeoutError();
  }

  // Network-level connection failures — fail fast, never fall back to primary
  const nodeCode = (err as NodeJS.ErrnoException).code;
  if (
    nodeCode === 'ECONNREFUSED' ||
    nodeCode === 'ETIMEDOUT' ||
    nodeCode === 'ENOTFOUND'
  ) {
    return new ReplicaUnavailableError();
  }

  return err;
}
