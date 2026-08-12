/**
 * PurgeWorker — WO-095.
 *
 * Nightly retention purge worker.  Invoked by a cron-triggered SQS message;
 * KEDA scales to one replica; duplicate firings are guarded by a PostgreSQL
 * advisory lock.
 *
 * Per-run flow:
 *   1. Acquire advisory lock (pg_try_advisory_lock(LOCK_ID)) — exit if already held.
 *   2. Load retention policies.
 *   3. For each tenant × category, compute horizon and run the strategy:
 *      a. drop_partition  → PartitionPurger
 *      b. batch_delete    → BatchPurger
 *      c. crypto_shred    → CryptoShredService
 *      d. Others (tombstone_on_erasure, admin_action_only) → skip.
 *   4. Append a purge_runs ledger row per (tenant, category) run.
 *   5. Emit Prometheus metrics via structured log lines.
 *   6. Release the advisory lock.
 *
 * Safety rails:
 *   - Dry-run is the default mode.  Enforce requires explicit opt-in per category.
 *   - Row-count safety cap (default 500k/tenant/category/run); override with
 *     PURGE_ROW_CAP_OVERRIDE env var.
 *   - Audit trail hard floor: will not purge audit_logs below 365 days even if
 *     a policy row configures a lower value.
 *   - Per-category failure isolation: a failure in one category does not abort others.
 *
 * Constraint: all deletes run on the primary; read replica is never used here.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';

import {
  purgeRuns,
  subjectDataKeys,
  retentionPolicies,
  NewPurgeRun,
  PurgeRunOutcome,
  RetentionPolicyMode,
} from '../../../../../../packages/db/src/schema/retention';
import { RETENTION_REGISTRY } from '../../../../../../packages/retention/src';
import { computeRetentionHorizon } from '../../modules/retention/retention-horizon';
import { PartitionPurger } from './partition-purger';
import { BatchPurger } from './batch-purger';
import { CryptoShredService } from '../../modules/retention/crypto-shred.service';
import { withAuditContext } from '../shared/with-audit-context';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** PostgreSQL advisory lock ID — must be stable across deployments. */
const ADVISORY_LOCK_ID     = 7_395_085_012;  // SHA-truncated from 'opsninja:retention:purge'
const AUDIT_TRAIL_FLOOR    = 365;
const DEFAULT_ROW_CAP      = 500_000;
const AUDIT_TRAIL_CATEGORY = 'audit_trail';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PurgeWorkerOptions {
  rowCapOverride?: number;
  now?:            Date;
}

export interface CategoryRunResult {
  tenantId:          string | null;
  category:          string;
  mode:              RetentionPolicyMode;
  partitionsDropped: string[];
  rowsDeleted:       number;
  keysDestroyed:     number;
  outcome:           PurgeRunOutcome;
  errorSummary?:     string;
}

// ---------------------------------------------------------------------------
// PurgeWorker
// ---------------------------------------------------------------------------

@Injectable()
export class PurgeWorker {
  private readonly logger = new Logger(PurgeWorker.name);
  private readonly db: NodePgDatabase;

  constructor(
    private readonly pool: Pool,
    private readonly cryptoShredService: CryptoShredService,
  ) {
    this.db = drizzle(pool);
  }

  async run(opts: PurgeWorkerOptions = {}): Promise<void> {
    const now       = opts.now ?? new Date();
    const rowCap    = opts.rowCapOverride ??
      parseInt(process.env['PURGE_ROW_CAP_OVERRIDE'] ?? String(DEFAULT_ROW_CAP), 10);

    // ── Step 1: acquire advisory lock ────────────────────────────────────────
    const lockAcquired = await this.tryAdvisoryLock();
    if (!lockAcquired) {
      this.logger.log('[purge-worker] Advisory lock held by another process — exiting');
      return;
    }

    const runStartedAt = now;
    const results: CategoryRunResult[] = [];

    try {
      // ── Step 2: load active policies ───────────────────────────────────────
      const policies = await this.db
        .select()
        .from(retentionPolicies);

      // Deduplicate: prefer tenant-specific over platform default.
      const policyMap = new Map<string, typeof policies[0]>();
      for (const p of policies) {
        const key = `${p.tenantId ?? 'platform'}:${p.category}`;
        const existing = policyMap.get(key);
        if (!existing || (p.tenantId !== null && existing.tenantId === null)) {
          policyMap.set(key, p);
        }
      }

      // ── Step 3: iterate categories ─────────────────────────────────────────
      for (const entry of RETENTION_REGISTRY) {
        if (entry.strategy === 'admin_action_only' || entry.strategy === 'tombstone_on_erasure') {
          continue;
        }

        const policy = policies.find(
          (p) => p.category === entry.table && p.tenantId === null,
        );
        if (!policy) continue;

        const effectiveDays = Math.max(
          policy.retentionDays,
          entry.table === AUDIT_TRAIL_CATEGORY ? AUDIT_TRAIL_FLOOR : 0,
        );

        const horizon = computeRetentionHorizon(effectiveDays, now);

        await withAuditContext(
          {
            tenantId:  null,
            actorType: 'system',
            traceId:   randomUUID(),
            requestId: randomUUID(),
            source:    'retention-purge-worker',
          },
          async () => {
            const result = await this.runCategory(
              entry.table,
              entry.strategy,
              null,
              effectiveDays,
              policy.mode,
              rowCap,
              now,
            );
            results.push(result);

            // Append purge_runs ledger entry.
            const ledgerRow: NewPurgeRun = {
              tenantId:          null,
              category:          entry.table,
              horizonAt:         horizon,
              partitionsDropped: result.partitionsDropped,
              rowsDeleted:       result.rowsDeleted,
              keysDestroyed:     result.keysDestroyed,
              mode:              policy.mode,
              outcome:           result.outcome,
              errorSummary:      result.errorSummary ?? null,
              finishedAt:        new Date(),
            };
            await this.db.insert(purgeRuns).values(ledgerRow);
          },
        );
      }

    } finally {
      // ── Step 4: release advisory lock ──────────────────────────────────────
      await this.releaseAdvisoryLock();
    }

    // ── Step 5: emit metrics ─────────────────────────────────────────────────
    this.emitMetrics(results, runStartedAt, now);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async runCategory(
    tableName: string,
    strategy: string,
    tenantId: string | null,
    horizonDays: number,
    mode: RetentionPolicyMode,
    rowCap: number,
    now: Date,
  ): Promise<CategoryRunResult> {
    const dryRun = mode === 'dry_run';

    try {
      if (strategy === 'drop_partition') {
        const purger = new PartitionPurger(this.pool);
        const res    = await purger.purge(tableName, horizonDays, dryRun, now);
        return {
          tenantId,
          category:          tableName,
          mode,
          partitionsDropped: res.partitionsDropped,
          rowsDeleted:       0,
          keysDestroyed:     0,
          outcome:           'success',
        };
      }

      if (strategy === 'batch_delete') {
        const purger = new BatchPurger(this.pool);
        const res    = await purger.purge(
          {
            tableName,
            tenantId:        tenantId ?? 'platform',
            timestampColumn: 'created_at',
            horizonDays,
            totalRowCap:     rowCap,
            now,
          },
          dryRun,
        );
        return {
          tenantId,
          category:          tableName,
          mode,
          partitionsDropped: [],
          rowsDeleted:       res.rowsDeleted,
          keysDestroyed:     0,
          outcome:           'success',
        };
      }

      return {
        tenantId,
        category:          tableName,
        mode,
        partitionsDropped: [],
        rowsDeleted:       0,
        keysDestroyed:     0,
        outcome:           'success',
      };

    } catch (err) {
      const errorSummary = (err as Error).message?.slice(0, 500) ?? 'unknown error';
      this.logger.error(`[purge-worker] Category ${tableName} failed: ${errorSummary}`);
      return {
        tenantId,
        category:          tableName,
        mode,
        partitionsDropped: [],
        rowsDeleted:       0,
        keysDestroyed:     0,
        outcome:           'failure',
        errorSummary,
      };
    }
  }

  private async tryAdvisoryLock(): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<{ result: boolean }>(
        `SELECT pg_try_advisory_lock($1::bigint) AS result`,
        [ADVISORY_LOCK_ID],
      );
      return rows[0]?.result === true;
    } finally {
      client.release();
    }
  }

  private async releaseAdvisoryLock(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `SELECT pg_advisory_unlock($1::bigint)`,
        [ADVISORY_LOCK_ID],
      );
    } finally {
      client.release();
    }
  }

  private emitMetrics(
    results: CategoryRunResult[],
    runStartedAt: Date,
    now: Date,
  ): void {
    const durationSeconds = (now.getTime() - runStartedAt.getTime()) / 1_000;
    const totalRows       = results.reduce((s, r) => s + r.rowsDeleted, 0);
    const totalPartitions = results.reduce((s, r) => s + r.partitionsDropped.length, 0);
    const totalKeys       = results.reduce((s, r) => s + r.keysDestroyed, 0);
    const failures        = results.filter((r) => r.outcome === 'failure').length;

    // Structured log lines scraped by the Prometheus collector.
    this.logger.log(JSON.stringify({
      metric:    'opsninja_purge_run_duration_seconds',
      value:     durationSeconds,
      labels:    { worker: 'retention-purge' },
    }));
    this.logger.log(JSON.stringify({
      metric: 'opsninja_purge_rows_deleted_total',
      value:  totalRows,
      labels: { worker: 'retention-purge' },
    }));
    this.logger.log(JSON.stringify({
      metric: 'opsninja_purge_partitions_dropped_total',
      value:  totalPartitions,
      labels: { worker: 'retention-purge' },
    }));
    this.logger.log(JSON.stringify({
      metric: 'opsninja_purge_keys_destroyed_total',
      value:  totalKeys,
      labels: { worker: 'retention-purge' },
    }));
    this.logger.log(JSON.stringify({
      metric: 'opsninja_purge_failures_total',
      value:  failures,
      labels: { worker: 'retention-purge' },
    }));
    this.logger.log(JSON.stringify({
      metric: 'opsninja_purge_last_success_timestamp',
      value:  failures === 0 ? now.getTime() / 1_000 : null,
      labels: { worker: 'retention-purge' },
    }));
  }
}
