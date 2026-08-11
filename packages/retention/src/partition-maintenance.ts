/**
 * Partition maintenance — WO-085.
 *
 * For range-partitioned tables (notifications, webhook_deliveries):
 *   1. DETACH expired partitions in a separate transaction with a bounded
 *      lock_timeout so a long-running reporting query cannot block the detach.
 *   2. DROP detached partitions in a separate transaction.
 *   3. Pre-create the next N months' partitions to protect inserts at rollover.
 *
 * Two-step DETACH → DROP ensures the DROP never blocks under active queries:
 * DETACH acquires AccessShareLock briefly; DROP on a detached (independent)
 * table acquires no lock on the parent.
 *
 * If lock acquisition times out the partition is skipped with a warning metric
 * rather than failing the entire job.
 */

import { Pool, PoolClient } from 'pg';
import { expiredPartitionSuffixes, upcomingPartitionSuffixes } from './retention-registry';

/** Result for a single partition operation. */
export interface PartitionOpResult {
  partition:  string;
  outcome:    'dropped' | 'skipped_lock_timeout' | 'not_found';
  durationMs: number;
  error?:     string;
}

/** Summary returned by runPartitionMaintenance. */
export interface PartitionMaintenanceSummary {
  table:             string;
  partitionsDropped: number;
  partitionsSkipped: number;
  partitionsCreated: number;
  results:           PartitionOpResult[];
}

const LOCK_TIMEOUT_MS = 5_000; // 5s — skip rather than block

export async function runPartitionMaintenance(
  pool: Pool,
  tableName: string,
  horizonDays: number,
  now: Date = new Date(),
): Promise<PartitionMaintenanceSummary> {
  const cutoff   = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - horizonDays);
  cutoff.setUTCHours(0, 0, 0, 0);

  const expired  = expiredPartitionSuffixes(cutoff);
  const upcoming = upcomingPartitionSuffixes(3, now);

  const results: PartitionOpResult[] = [];
  let dropped = 0;
  let skipped = 0;

  // ── Step 1: DETACH + DROP expired partitions ───────────────────────────────
  for (const suffix of expired) {
    const partitionName = `${tableName}_${suffix}`;
    const t0 = Date.now();

    let client: PoolClient | null = null;
    try {
      client = await pool.connect();

      // Set a tight lock_timeout so a slow query cannot block us indefinitely.
      await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);

      // Check if partition exists before attempting detach.
      const exists = await client.query<{ relname: string }>(
        `SELECT relname FROM pg_class WHERE relname = $1 AND relkind = 'r'`,
        [partitionName],
      );

      if (exists.rows.length === 0) {
        results.push({
          partition:  partitionName,
          outcome:    'not_found',
          durationMs: Date.now() - t0,
        });
        continue;
      }

      // DETACH in its own transaction.
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
      await client.query(
        `ALTER TABLE ${tableName} DETACH PARTITION ${partitionName}`,
      );
      await client.query('COMMIT');

      // DROP in a new transaction (never blocks parent).
      await client.query('BEGIN');
      await client.query(`DROP TABLE IF EXISTS ${partitionName}`);
      await client.query('COMMIT');

      results.push({
        partition:  partitionName,
        outcome:    'dropped',
        durationMs: Date.now() - t0,
      });
      dropped++;
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      try { await client?.query('ROLLBACK'); } catch { /* ignore */ }

      // lock_timeout manifests as 55P03 (lock_not_available).
      const isLockTimeout =
        (err as { code?: string }).code === '55P03' ||
        msg.includes('lock_timeout') ||
        msg.includes('canceling statement');

      results.push({
        partition:  partitionName,
        outcome:    isLockTimeout ? 'skipped_lock_timeout' : 'dropped',
        durationMs: Date.now() - t0,
        error:      msg,
      });

      if (!isLockTimeout) {
        // Unexpected error — propagate so the job records a failure.
        throw err;
      }
      skipped++;
    } finally {
      client?.release();
    }
  }

  // ── Step 2: Pre-create upcoming partitions ─────────────────────────────────
  let created = 0;
  for (const suffix of upcoming) {
    const partitionName = `${tableName}_${suffix}`;
    // Parse suffix YYYY_MM
    const [yearStr, monthStr] = suffix.split('_');
    const year  = parseInt(yearStr!, 10);
    const month = parseInt(monthStr!, 10);

    const fromDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear  = month === 12 ? year + 1 : year;
    const toDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

    let client: PoolClient | null = null;
    try {
      client = await pool.connect();

      // Idempotent — only create if not already present.
      const exists = await client.query<{ relname: string }>(
        `SELECT relname FROM pg_class WHERE relname = $1 AND relkind = 'r'`,
        [partitionName],
      );

      if (exists.rows.length === 0) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${partitionName}
            PARTITION OF ${tableName}
            FOR VALUES FROM ('${fromDate}') TO ('${toDate}')
        `);
        created++;
      }
    } catch (err) {
      // Non-fatal: log but don't abort the job.
      console.warn(`[partition-maintenance] Failed to pre-create ${partitionName}:`, (err as Error).message);
    } finally {
      client?.release();
    }
  }

  return {
    table:             tableName,
    partitionsDropped: dropped,
    partitionsSkipped: skipped,
    partitionsCreated: created,
    results,
  };
}
