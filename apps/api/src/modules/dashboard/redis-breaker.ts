/**
 * RedisBreakerService — WO-068.
 *
 * Simple consecutive-failure circuit breaker that prevents paying repeated
 * Redis timeouts on every snapshot request when Redis is unhealthy.
 *
 * States:
 *   CLOSED  — normal; every request attempts Redis.
 *   OPEN    — Redis was unhealthy; requests go straight to Postgres fallback
 *             until the cooldown window expires.
 *
 * Thresholds (configurable via env):
 *   DASHBOARD_BREAKER_THRESHOLD  — consecutive failures before opening (default 3)
 *   DASHBOARD_BREAKER_COOLDOWN_MS — ms to stay open before retrying (default 30000)
 *
 * Thread safety: single-process Node.js; no mutex needed.
 */

import { Injectable, Logger } from '@nestjs/common';

const THRESHOLD = parseInt(process.env['DASHBOARD_BREAKER_THRESHOLD'] ?? '3', 10);
const COOLDOWN_MS = parseInt(process.env['DASHBOARD_BREAKER_COOLDOWN_MS'] ?? '30000', 10);

export type BreakerState = 'CLOSED' | 'OPEN';

@Injectable()
export class RedisBreakerService {
  private readonly logger = new Logger(RedisBreakerService.name);

  private consecutiveFailures = 0;
  private openedAt: number | null = null;

  get state(): BreakerState {
    if (this.openedAt === null) return 'CLOSED';
    if (Date.now() - this.openedAt > COOLDOWN_MS) {
      // Cooldown expired — allow one probe attempt (half-open semantics)
      return 'CLOSED';
    }
    return 'OPEN';
  }

  /** Returns true if the breaker is open (Postgres fallback should be used). */
  get isOpen(): boolean {
    return this.state === 'OPEN';
  }

  /** Call after a successful Redis operation. Resets the failure counter. */
  recordSuccess(): void {
    if (this.consecutiveFailures > 0 || this.openedAt !== null) {
      this.logger.log('Redis circuit breaker: reset after success');
    }
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }

  /** Call after a Redis error or timeout. May trip the breaker. */
  recordFailure(error: string): void {
    this.consecutiveFailures++;
    this.logger.warn('Redis failure recorded', {
      consecutiveFailures: this.consecutiveFailures,
      threshold: THRESHOLD,
      error,
    });

    if (this.consecutiveFailures >= THRESHOLD && this.openedAt === null) {
      this.openedAt = Date.now();
      this.logger.warn('Redis circuit breaker OPENED — switching to Postgres fallback', {
        consecutiveFailures: this.consecutiveFailures,
        cooldownMs: COOLDOWN_MS,
      });
    }
  }

  /** Current breaker statistics for logging. */
  toLogContext(): Record<string, unknown> {
    return {
      breakerState:        this.state,
      consecutiveFailures: this.consecutiveFailures,
      openedAt:            this.openedAt,
    };
  }
}
