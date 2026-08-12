/**
 * Synthesis metrics — WO-064.
 *
 * Structured-log emission helpers that act as the metric source for
 * Prometheus/CloudWatch. Each call writes a single JSON line to stdout
 * which the collector scrapes via a log filter.
 *
 * Metric inventory (AC-6):
 *   ai_synthesis_attempts_total      — counter by outcome + error_code
 *   ai_synthesis_lag_seconds         — histogram (ticket resolved → summary written)
 *   ai_synthesis_dlq_depth           — gauge read from SQS
 *   ai_synthesis_stuck_total         — gauge from reconciliation job
 */

export type AttemptOutcome =
  | 'succeeded'
  | 'failed_retryable'
  | 'failed_permanent'
  | 'skipped'
  | 'idempotent_skip'
  | 'ticket_not_found';

export interface AttemptLabels {
  tenantId: string;
  outcome: AttemptOutcome;
  errorCode?: string;
}

export interface LagLabels {
  tenantId: string;
  /** ticket.resolved timestamp as ISO-8601 string */
  resolvedAt: string;
  /** summary generated_at as ISO-8601 string */
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Emitters
// ---------------------------------------------------------------------------

export function emitAttemptMetric(labels: AttemptLabels, attempt: number): void {
  console.log(JSON.stringify({
    metric:    'ai_synthesis_attempts_total',
    attempt,
    outcome:   labels.outcome,
    errorCode: labels.errorCode ?? null,
    tenantId:  labels.tenantId,
    ts:        Date.now(),
  }));
}

export function emitLagMetric(labels: LagLabels): void {
  const lagMs =
    new Date(labels.generatedAt).getTime() - new Date(labels.resolvedAt).getTime();
  const lagSeconds = lagMs / 1000;
  console.log(JSON.stringify({
    metric:       'ai_synthesis_lag_seconds',
    lagSeconds,
    tenantId:     labels.tenantId,
    ts:           Date.now(),
  }));
}

export function emitDlqDepthMetric(depth: number): void {
  console.log(JSON.stringify({
    metric: 'ai_synthesis_dlq_depth',
    depth,
    ts:     Date.now(),
  }));
}

export function emitStuckTotalMetric(count: number, tenantId?: string): void {
  console.log(JSON.stringify({
    metric:   'ai_synthesis_stuck_total',
    count,
    tenantId: tenantId ?? 'all',
    ts:       Date.now(),
  }));
}
