/**
 * In-process metrics for the outbox worker.
 *
 * Exposes counters and gauges that are served via the /metrics HTTP endpoint
 * and emitted as structured log lines for CloudWatch/SIEM ingestion.
 *
 * Alert thresholds (set in CloudWatch alarms or similar):
 *   - outbox_pending_count > 1000 for 5 minutes → PagerDuty P2
 *   - outbox_oldest_unpublished_seconds > 300 for 5 minutes → PagerDuty P1
 *   - outbox_dead_letter_count > 0 → PagerDuty P2
 */

export interface OutboxMetrics {
  /** Current count of rows in status='pending'. */
  outboxPendingCount: number;
  /** Seconds since the oldest pending row's created_at. */
  outboxOldestUnpublishedSeconds: number;
  /** Cumulative successful publishes since worker start. */
  publishSuccessTotal: number;
  /** Cumulative failed publish attempts since worker start. */
  publishFailureTotal: number;
  /** Cumulative drain loop iterations since worker start. */
  drainIterationsTotal: number;
  /** Duration of the last drain loop iteration in milliseconds. */
  lastDrainDurationMs: number;
  /** Current count of rows in status='dead_letter'. */
  outboxDeadLetterCount: number;
}

export class MetricsCollector {
  private _pendingCount = 0;
  private _oldestUnpublishedSeconds = 0;
  private _publishSuccessTotal = 0;
  private _publishFailureTotal = 0;
  private _drainIterationsTotal = 0;
  private _lastDrainDurationMs = 0;
  private _deadLetterCount = 0;

  recordDrainStart(): number {
    return Date.now();
  }

  recordDrainEnd(startMs: number, pendingCount: number, oldestUnpublishedSeconds: number, deadLetterCount: number): void {
    this._lastDrainDurationMs = Date.now() - startMs;
    this._drainIterationsTotal++;
    this._pendingCount = pendingCount;
    this._oldestUnpublishedSeconds = oldestUnpublishedSeconds;
    this._deadLetterCount = deadLetterCount;
  }

  recordPublishSuccess(count = 1): void {
    this._publishSuccessTotal += count;
  }

  recordPublishFailure(count = 1): void {
    this._publishFailureTotal += count;
  }

  snapshot(): OutboxMetrics {
    return {
      outboxPendingCount: this._pendingCount,
      outboxOldestUnpublishedSeconds: this._oldestUnpublishedSeconds,
      publishSuccessTotal: this._publishSuccessTotal,
      publishFailureTotal: this._publishFailureTotal,
      drainIterationsTotal: this._drainIterationsTotal,
      lastDrainDurationMs: this._lastDrainDurationMs,
      outboxDeadLetterCount: this._deadLetterCount,
    };
  }

  /** Emit metrics as a structured JSON heartbeat log. */
  emitHeartbeat(): void {
    const m = this.snapshot();
    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'outbox.worker.heartbeat',
        ...m,
        ts: new Date().toISOString(),
      }),
    );
  }
}

export const metrics = new MetricsCollector();
