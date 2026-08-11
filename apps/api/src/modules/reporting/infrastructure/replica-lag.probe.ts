/**
 * ReplicaLagProbe
 *
 * Polls pg_last_xact_replay_timestamp() every 15 seconds to track how far
 * behind the replica is from the primary. The result is:
 *  - Exposed via getReplicaFreshness() so report builders can surface
 *    data-as-of timestamps to analysts.
 *  - Used by the /health/reporting-replica endpoint to return 503 when
 *    lag exceeds the configurable threshold.
 *  - Emitted as a metric (opsninja_reporting_replica_lag_seconds) on
 *    each probe via the structured log entry below.
 *
 * Single-node / local-dev null guard:
 *   pg_last_xact_replay_timestamp() returns NULL when the connected node
 *   is not a standby (pg_is_in_recovery() = false). In that case lagSeconds
 *   is reported as 0 and isInRecovery is false, so the health probe passes.
 *
 * The probe uses a transient pool connection per interval rather than a
 * dedicated persistent connection. Each probe is brief (<1 ms) and returns
 * the connection immediately.
 */

import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';

import { REPORTING_DB } from './reporting-db.client';

export interface ReplicaFreshness {
  lagSeconds: number;
  isInRecovery: boolean;
  lastProbedAt: Date | null;
  probeError: string | null;
}

const PROBE_INTERVAL_MS = 15_000;
export const DEFAULT_LAG_THRESHOLD_SECONDS = 120;

@Injectable()
export class ReplicaLagProbe implements OnModuleInit, OnModuleDestroy {
  private freshness: ReplicaFreshness = {
    lagSeconds: 0,
    isInRecovery: false,
    lastProbedAt: null,
    probeError: 'Not yet probed',
  };

  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(@Inject(REPORTING_DB) private readonly pool: Pool) {}

  onModuleInit(): void {
    void this.probe();
    this.intervalHandle = setInterval(() => {
      void this.probe();
    }, PROBE_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async probe(): Promise<void> {
    let client;
    try {
      client = await this.pool.connect();
      const result = await client.query<{
        lag_seconds: string | null;
        is_in_recovery: boolean;
      }>(
        `SELECT
          EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::text AS lag_seconds,
          pg_is_in_recovery() AS is_in_recovery`,
      );
      const row = result.rows[0];
      const isInRecovery = row?.is_in_recovery ?? false;
      const rawLag = row?.lag_seconds;
      // For a primary/standalone node, pg_last_xact_replay_timestamp() is null.
      // Report lag as 0 so health probes pass in local dev.
      const lagSeconds =
        isInRecovery && rawLag !== null ? parseFloat(rawLag) : 0;

      this.freshness = {
        lagSeconds,
        isInRecovery,
        lastProbedAt: new Date(),
        probeError: null,
      };

      // Emit metric via structured log for OpenTelemetry scraper
      console.log('[metric] opsninja_reporting_replica_lag_seconds', {
        value: lagSeconds,
        isInRecovery,
      });
    } catch (err) {
      this.freshness = {
        ...this.freshness,
        lastProbedAt: new Date(),
        probeError: (err as Error).message,
      };
      console.error('[reporting-replica:lag-probe] Probe failed', {
        message: (err as Error).message,
      });
    } finally {
      client?.release();
    }
  }

  getReplicaFreshness(): ReplicaFreshness {
    return { ...this.freshness };
  }

  isHealthy(thresholdSeconds = DEFAULT_LAG_THRESHOLD_SECONDS): boolean {
    if (this.freshness.probeError !== null) return false;
    if (this.freshness.lastProbedAt === null) return false;
    return this.freshness.lagSeconds < thresholdSeconds;
  }
}
