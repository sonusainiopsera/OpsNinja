/**
 * Bounded batch-delete — WO-085.
 *
 * Deletes expired rows in small batches using a CTE + ctid approach so each
 * DELETE is bounded and relinquishes locks promptly.
 *
 * Loop exits when:
 *   a) zero rows remain before the cutoff, OR
 *   b) the hard wall-clock budget is exhausted, OR
 *   c) the total budget (totalRowCap) is exhausted.
 *
 * Per-batch statement_timeout prevents a single slow batch from blocking long.
 * The caller is responsible for opening / closing the pool connection.
 */

import { Pool, PoolClient } from 'pg';
import { computeHorizon } from './retention-registry';

export interface BatchDeleteOptions {
  /** Postgres table name (unquoted). */
  tableName: string;
  /** Column to compare against the cutoff (must be indexed). */
  timestampColumn: string;
  /** Horizon in days — rows older than this are eligible. */
  horizonDays: number;
  /** Number of rows per DELETE batch. Default 5000. */
  batchSize?: number;
  /** Hard wall-clock budget in milliseconds. Default 30 minutes. */
  wallClockBudgetMs?: number;
  /** Per-batch statement timeout in milliseconds. Default 10 s. */
  batchStatementTimeoutMs?: number;
  /** Optional total row cap to limit a single run. Default Infinity. */
  totalRowCap?: number;
  /** Optional WHERE clause fragment (no leading AND). E.g. "tenant_id = $2" */
  extraWhereClause?: string;
  /** Extra params corresponding to extraWhereClause placeholders starting at $2. */
  extraParams?: unknown[];
  /** Injected clock for testing. */
  now?: Date;
}

export interface BatchDeleteResult {
  tableName:    string;
  rowsDeleted:  number;
  batchCount:   number;
  exhausted:    'rows' | 'budget' | 'cap';
}

export async function runBatchDelete(
  pool: Pool,
  options: BatchDeleteOptions,
): Promise<BatchDeleteResult> {
  const {
    tableName,
    timestampColumn,
    horizonDays,
    batchSize                = 5_000,
    wallClockBudgetMs        = 30 * 60 * 1_000,
    batchStatementTimeoutMs  = 10_000,
    totalRowCap              = Infinity,
    extraWhereClause,
    extraParams              = [],
    now                      = new Date(),
  } = options;

  const cutoff    = computeHorizon(horizonDays, now);
  const deadline  = now.getTime() + wallClockBudgetMs;

  let totalDeleted = 0;
  let batchCount   = 0;
  let exhausted: BatchDeleteResult['exhausted'] = 'rows';

  while (true) {
    // Wall-clock budget check.
    if (Date.now() >= deadline) {
      exhausted = 'budget';
      break;
    }
    // Row cap check.
    if (totalDeleted >= totalRowCap) {
      exhausted = 'cap';
      break;
    }

    const thisBatch = Math.min(batchSize, totalRowCap - totalDeleted);

    let client: PoolClient | null = null;
    let rowsThisBatch = 0;

    try {
      client = await pool.connect();

      await client.query('BEGIN');
      await client.query(
        `SET LOCAL statement_timeout = ${batchStatementTimeoutMs}`,
      );

      const extraWhere = extraWhereClause ? ` AND ${extraWhereClause}` : '';
      const params: unknown[] = [cutoff.toISOString(), thisBatch, ...extraParams];

      // CTE selects ctid for the batch, DELETE uses ctid for exact row targeting.
      const sql = `
        WITH batch AS (
          SELECT ctid
          FROM   ${tableName}
          WHERE  ${timestampColumn} < $1${extraWhere}
          LIMIT  $2
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM ${tableName}
        WHERE ctid IN (SELECT ctid FROM batch)
      `;

      const result = await client.query(sql, params);
      await client.query('COMMIT');

      rowsThisBatch = result.rowCount ?? 0;
    } catch (err) {
      try { await client?.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client?.release();
    }

    totalDeleted += rowsThisBatch;
    batchCount++;

    // If the batch returned fewer rows than requested, we've exhausted the set.
    if (rowsThisBatch < thisBatch) {
      exhausted = 'rows';
      break;
    }

    // Short yield to avoid monopolising the connection pool.
    await new Promise<void>((r) => setTimeout(r, 50));
  }

  return { tableName, rowsDeleted: totalDeleted, batchCount, exhausted };
}
