/**
 * ReplicaLagProbe
 *
 * Polls the replica every 15 seconds using pg_last_xact_replay_timestamp()
 * and caches the result so health endpoints can read it synchronously.
 *
 * Null guard: on a single-node Postgres instance (local dev / CI) the
 * pg_last_xact_replay_timestamp() function returns NULL because the node is
 * not in streaming recovery.  In that case lag is reported as 0 with
 * isStandalone = true so callers can distinguish "no lag" from "not a replica".
 *
 * The probe pool is dedicated (max = 1, outside the REPORTING_DB budget) so a
 * saturated reporting pool never prevents the health check from completing.
 */

import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';

export interface ReplicaFreshness {
  /** Replica lag in seconds (0 on a standalone non-replica node). */
  lagSeconds: number;
  /** True when pg_last_xact_replay_timestamp() returned NULL (single-node mode). */
  isStandalone: boolean;
  /** Epoch ms when this sample was taken. */
  sampledAt: number;
}

const LAG_QUERY = `
  SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::float AS lag_seconds
`;

const POLL_INTERVAL_MS = 15_000;

@Injectable()
export class ReplicaLagProbe implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ReplicaLagProbe.name);

  private intervalHandle: ReturnType<typeof setInterval> | undefined;
  private freshness: ReplicaFreshness = {
    lagSeconds: 0,
    isStandalone: true,
    sampledAt: 0,
  };

  constructor(private readonly probePool: Pool) {}

  onApplicationBootstrap(): void {
    this.intervalHandle = setInterval(() => {
      this.sample().catch((err) =>
        this.logger.warn('Replica lag sample failed', {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }, POLL_INTERVAL_MS);

    // Take an initial sample immediately (non-blocking).
    this.sample().catch(() => void 0);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.intervalHandle !== undefined) {
      clearInterval(this.intervalHandle);
    }
    await this.probePool.end();
  }

  /**
   * Returns the most recent cached freshness snapshot.
   * sampledAt === 0 means the probe has not yet completed its first poll.
   */
  getReplicaFreshness(): ReplicaFreshness {
    return this.freshness;
  }

  private async sample(): Promise<void> {
    const client = await this.probePool.connect();
    try {
      const result = await client.query<{ lag_seconds: number | null }>(LAG_QUERY);
      const row = result.rows[0];
      const raw = row?.lag_seconds ?? null;

      this.freshness = {
        lagSeconds: raw === null ? 0 : raw,
        isStandalone: raw === null,
        sampledAt: Date.now(),
      };
    } finally {
      client.release();
    }
  }
}
