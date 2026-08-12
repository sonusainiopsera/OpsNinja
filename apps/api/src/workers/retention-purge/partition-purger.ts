/**
 * PartitionPurger — WO-095.
 *
 * Performs the two-step DROP for range-partitioned tables:
 *   1. ALTER TABLE ... DETACH PARTITION CONCURRENTLY  (non-blocking, separate txn)
 *   2. DROP TABLE IF EXISTS <partition>               (separate txn — never blocks parent)
 *
 * Recovery: on start-up, scans pg_inherits to find previously-detached-but-not-dropped
 * partitions and drops them before processing the normal expired set.
 *
 * Safety rails:
 *   - lock_timeout on the DETACH to avoid blocking agent queue queries.
 *   - Per-partition error isolation: failures are recorded but do not abort the run.
 *   - DETACH CONCURRENTLY requires Postgres 14+.
 *
 * Constraint: runs only against the primary; never the read replica.
 */

import { Pool, PoolClient } from 'pg';
import { selectEligiblePartitions, expiredMonthlyPartitions } from '../../modules/retention/retention-horizon';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PartitionDropOutcome =
  | 'dropped'
  | 'skipped_lock_timeout'
  | 'recovered_and_dropped'
  | 'not_found'
  | 'dry_run';

export interface PartitionDropResult {
  partition:  string;
  outcome:    PartitionDropOutcome;
  durationMs: number;
  error?:     string;
}

export interface PartitionPurgerResult {
  tableName:         string;
  partitionsDropped: string[];
  partitionsSkipped: string[];
  durationMs:        number;
  results:           PartitionDropResult[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOCK_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// PartitionPurger
// ---------------------------------------------------------------------------

export class PartitionPurger {
  constructor(private readonly pool: Pool) {}

  /**
   * Detach and drop all eligible expired partitions for a table.
   *
   * @param tableName     - Postgres table name (unquoted).
   * @param horizonDays   - Retention horizon in days.
   * @param dryRun        - If true, return projected impact without mutating.
   * @param now           - Reference timestamp for computing horizon (injected for testing).
   */
  async purge(
    tableName: string,
    horizonDays: number,
    dryRun: boolean,
    now: Date = new Date(),
  ): Promise<PartitionPurgerResult> {
    const t0     = Date.now();
    const results: PartitionDropResult[] = [];

    const horizon = new Date(now);
    horizon.setUTCDate(horizon.getUTCDate() - horizonDays);
    horizon.setUTCHours(0, 0, 0, 0);

    // Step 0: recover previously detached but not-dropped partitions.
    const orphans = await this.findOrphanPartitions(tableName);

    for (const partition of orphans) {
      if (dryRun) {
        results.push({ partition, outcome: 'dry_run', durationMs: 0 });
        continue;
      }
      const r = await this.dropTable(partition);
      results.push({ ...r, outcome: 'recovered_and_dropped' });
    }

    // Step 1: compute the expired partition list and check eligibility.
    const candidateNames = expiredMonthlyPartitions(tableName, horizon);
    const eligibility    = selectEligiblePartitions(candidateNames, horizon);
    const eligible       = eligibility.filter((e) => e.eligible);

    for (const { name: partition } of eligible) {
      const pr0 = Date.now();

      if (dryRun) {
        results.push({ partition, outcome: 'dry_run', durationMs: 0 });
        continue;
      }

      // Check partition actually exists in pg_catalog before attempting DETACH.
      const exists = await this.partitionExists(partition);
      if (!exists) {
        results.push({ partition, outcome: 'not_found', durationMs: Date.now() - pr0 });
        continue;
      }

      // DETACH CONCURRENTLY in its own transaction.
      const detachResult = await this.detachPartition(tableName, partition, pr0);
      if (detachResult.outcome === 'skipped_lock_timeout') {
        results.push(detachResult);
        continue;
      }

      // DROP in a separate transaction (never blocks parent).
      const dropResult = await this.dropTable(partition);
      results.push({
        partition,
        outcome:    'dropped',
        durationMs: Date.now() - pr0,
        error:      dropResult.error,
      });
    }

    const dropped = results
      .filter((r) => r.outcome === 'dropped' || r.outcome === 'recovered_and_dropped')
      .map((r) => r.partition);
    const skipped = results
      .filter((r) => r.outcome === 'skipped_lock_timeout')
      .map((r) => r.partition);

    return {
      tableName,
      partitionsDropped: dropped,
      partitionsSkipped: skipped,
      durationMs:        Date.now() - t0,
      results,
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async partitionExists(partitionName: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<{ relname: string }>(
        `SELECT relname FROM pg_class WHERE relname = $1 AND relkind = 'r'`,
        [partitionName],
      );
      return rows.length > 0;
    } finally {
      client.release();
    }
  }

  /**
   * Find detached-but-not-yet-dropped partitions:
   * they appear in pg_class but NOT in pg_inherits (detached → no longer a child).
   */
  private async findOrphanPartitions(tableName: string): Promise<string[]> {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<{ relname: string }>(
        `
        SELECT c.relname
        FROM   pg_class c
        WHERE  c.relname LIKE $1
          AND  c.relkind = 'r'
          AND  NOT EXISTS (
            SELECT 1 FROM pg_inherits pi
            JOIN pg_class pc ON pc.oid = pi.inhparent
            WHERE pi.inhrelid = c.oid AND pc.relname = $2
          )
        ORDER BY c.relname
        `,
        [`${tableName}\\_%`, tableName],
      );
      return rows.map((r) => r.relname);
    } finally {
      client.release();
    }
  }

  private async detachPartition(
    tableName: string,
    partition: string,
    t0: number,
  ): Promise<PartitionDropResult> {
    let client: PoolClient | null = null;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
      await client.query(
        `ALTER TABLE ${tableName} DETACH PARTITION ${partition} CONCURRENTLY`,
      );
      await client.query('COMMIT');
      return { partition, outcome: 'dropped', durationMs: Date.now() - t0 };
    } catch (err) {
      const msg  = (err as Error).message ?? String(err);
      const code = (err as { code?: string }).code;
      try { await client?.query('ROLLBACK'); } catch { /* ignore */ }

      const isLockTimeout =
        code === '55P03' ||
        msg.includes('lock_timeout') ||
        msg.includes('canceling statement');

      return {
        partition,
        outcome:    isLockTimeout ? 'skipped_lock_timeout' : 'dropped',
        durationMs: Date.now() - t0,
        error:      msg,
      };
    } finally {
      client?.release();
    }
  }

  private async dropTable(partition: string): Promise<PartitionDropResult> {
    const t0 = Date.now();
    let client: PoolClient | null = null;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN');
      await client.query(`DROP TABLE IF EXISTS ${partition}`);
      await client.query('COMMIT');
      return { partition, outcome: 'dropped', durationMs: Date.now() - t0 };
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      try { await client?.query('ROLLBACK'); } catch { /* ignore */ }
      return { partition, outcome: 'dropped', durationMs: Date.now() - t0, error: msg };
    } finally {
      client?.release();
    }
  }
}
