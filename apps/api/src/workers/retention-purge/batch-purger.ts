/**
 * BatchPurger — WO-095.
 *
 * Performs bounded, resumable physical deletes for non-partitioned categories.
 *
 * Each batch:
 *   - Uses a CTE + ctid approach so the DELETE is bounded.
 *   - Runs with FOR UPDATE SKIP LOCKED to allow graceful interruption without
 *     blocking concurrent reads.
 *   - Enforces a per-batch statement_timeout to protect agent queue latency.
 *   - Yields briefly between batches to protect the primary connection pool.
 *
 * Constraint: runs only against the primary DB; never the read replica.
 * The 300ms p95 agent queue budget is protected by the statement_timeout and
 * short sleep between batches.
 */

import { Pool, PoolClient } from 'pg';
import { computeRetentionHorizon } from '../../modules/retention/retention-horizon';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchPurgerOptions {
  tableName:              string;
  tenantId:               string;
  timestampColumn:        string;
  horizonDays:            number;
  batchSize?:             number;
  statementTimeoutMs?:    number;
  wallClockBudgetMs?:     number;
  totalRowCap?:           number;
  /** Injected clock for testing. */
  now?:                   Date;
}

export type BatchPurgerExhaustion = 'rows' | 'budget' | 'cap';

export interface BatchPurgerResult {
  tableName:    string;
  tenantId:     string;
  rowsDeleted:  number;
  batchCount:   number;
  exhausted:    BatchPurgerExhaustion;
  durationMs:   number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BATCH_SIZE          = 5_000;
const DEFAULT_STATEMENT_TIMEOUT   = 30_000;  // 30s
const DEFAULT_WALL_CLOCK_BUDGET   = 30 * 60 * 1_000;  // 30 min
const INTER_BATCH_SLEEP_MS        = 50;

// ---------------------------------------------------------------------------
// BatchPurger
// ---------------------------------------------------------------------------

export class BatchPurger {
  constructor(private readonly pool: Pool) {}

  /**
   * Delete expired rows in bounded batches.
   *
   * @param opts    - Configuration.
   * @param dryRun  - If true, count rows but do not delete.
   */
  async purge(opts: BatchPurgerOptions, dryRun: boolean): Promise<BatchPurgerResult> {
    const {
      tableName,
      tenantId,
      timestampColumn,
      horizonDays,
      batchSize             = DEFAULT_BATCH_SIZE,
      statementTimeoutMs    = DEFAULT_STATEMENT_TIMEOUT,
      wallClockBudgetMs     = DEFAULT_WALL_CLOCK_BUDGET,
      totalRowCap           = Infinity,
      now                   = new Date(),
    } = opts;

    const t0       = Date.now();
    const horizon  = computeRetentionHorizon(horizonDays, now);
    const deadline = now.getTime() + wallClockBudgetMs;

    let totalDeleted = 0;
    let batchCount   = 0;
    let exhausted: BatchPurgerExhaustion = 'rows';

    while (true) {
      if (Date.now() >= deadline) {
        exhausted = 'budget';
        break;
      }
      if (totalDeleted >= totalRowCap) {
        exhausted = 'cap';
        break;
      }

      const thisBatch = Math.min(batchSize, isFinite(totalRowCap) ? totalRowCap - totalDeleted : batchSize);

      if (dryRun) {
        // Count eligible rows without deleting.
        const count = await this.countEligible(tableName, tenantId, timestampColumn, horizon, statementTimeoutMs);
        totalDeleted = count;
        batchCount   = 1;
        exhausted    = 'rows';
        break;
      }

      const rowsThisBatch = await this.deleteBatch(
        tableName, tenantId, timestampColumn, horizon, thisBatch, statementTimeoutMs,
      );

      totalDeleted += rowsThisBatch;
      batchCount++;

      if (rowsThisBatch < thisBatch) {
        exhausted = 'rows';
        break;
      }

      // Yield between batches to protect the primary connection pool.
      await new Promise<void>((r) => setTimeout(r, INTER_BATCH_SLEEP_MS));
    }

    return {
      tableName,
      tenantId,
      rowsDeleted:  totalDeleted,
      batchCount,
      exhausted,
      durationMs:   Date.now() - t0,
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async countEligible(
    tableName: string,
    tenantId: string,
    timestampColumn: string,
    horizon: Date,
    statementTimeoutMs: number,
  ): Promise<number> {
    let client: PoolClient | null = null;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN');
      await client.query(`SET LOCAL statement_timeout = ${statementTimeoutMs}`);
      const { rows } = await client.query<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt
         FROM   ${tableName}
         WHERE  tenant_id = $1 AND ${timestampColumn} < $2`,
        [tenantId, horizon.toISOString()],
      );
      await client.query('COMMIT');
      return parseInt(rows[0]?.cnt ?? '0', 10);
    } catch (err) {
      try { await client?.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client?.release();
    }
  }

  private async deleteBatch(
    tableName: string,
    tenantId: string,
    timestampColumn: string,
    horizon: Date,
    batchSize: number,
    statementTimeoutMs: number,
  ): Promise<number> {
    let client: PoolClient | null = null;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN');
      await client.query(`SET LOCAL statement_timeout = ${statementTimeoutMs}`);

      const sql = `
        WITH batch AS (
          SELECT ctid
          FROM   ${tableName}
          WHERE  tenant_id = $1 AND ${timestampColumn} < $2
          LIMIT  $3
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM ${tableName}
        WHERE  ctid IN (SELECT ctid FROM batch)
      `;

      const result = await client.query(sql, [tenantId, horizon.toISOString(), batchSize]);
      await client.query('COMMIT');
      return result.rowCount ?? 0;
    } catch (err) {
      try { await client?.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client?.release();
    }
  }
}
