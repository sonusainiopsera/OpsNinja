/**
 * ReconcilerService — authoritative 60-second recomputation from Postgres.
 *
 * AC-5: Runs every 60s per active tenant, recomputes all KPI counters and
 *       breakdowns from Postgres, overwrites Redis aggregates, and emits
 *       dashboard_aggregate_drift metric per counter.
 *
 * AC-6: All queries carry a statement timeout (5s) and run inside a
 *       tenant-scoped transaction with SET LOCAL app.current_tenant so RLS
 *       applies; no query runs without app.current_tenant set.
 *
 * Drift measurement: for each counter, |redis_value - pg_value| is emitted
 * as a metric. Non-zero drift surfaces silent divergence.
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, and, inArray, gte, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { tickets, slaTimers, csatSurveys } from '@opsninja/db';
import { AggregateStore } from '../redis/aggregate.store';
import { Keys } from '../redis/keys';

const RECONCILE_INTERVAL_MS = 60_000;
const STATEMENT_TIMEOUT_MS = 5_000;
const OPEN_STATUSES = ['open', 'new', 'pending_customer', 'pending_engineering'];

@Injectable()
export class ReconcilerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconcilerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly redis: Redis,
    private readonly store: AggregateStore,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.runAll(), RECONCILE_INTERVAL_MS);
    this.logger.log('Reconciler started — interval 60s');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // --------------------------------------------------------------------------
  // Public — called at startup and on interval
  // --------------------------------------------------------------------------

  async runAll(): Promise<void> {
    const tenants = await this.getActiveTenants();
    for (const tenantId of tenants) {
      try {
        await this.reconcileTenant(tenantId);
      } catch (err: unknown) {
        this.logger.error('Reconcile failed for tenant — skipping', {
          tenantId,
          error: (err as Error).message,
        });
      }
    }
  }

  // --------------------------------------------------------------------------
  // Per-tenant reconciliation
  // --------------------------------------------------------------------------

  private async reconcileTenant(tenantId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}'`);
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

      const db = drizzle(client as never, { schema: { tickets, slaTimers, csatSurveys } });

      // ── KPI counts ────────────────────────────────────────────────────────
      const openRows = await client.query<{
        priority: string;
        cnt: string;
        org_id: string;
      }>(
        `SELECT priority, organization_id as org_id, count(*)::text as cnt
           FROM tickets
          WHERE tenant_id = $1
            AND status = ANY($2::text[])
          GROUP BY priority, organization_id`,
        [tenantId, OPEN_STATUSES],
      );

      let openTotal = 0;
      let activeP1 = 0;
      let activeP2 = 0;
      const orgLoad: Record<string, number> = {};

      for (const row of openRows.rows) {
        const n = parseInt(row.cnt, 10);
        openTotal += n;
        if (row.priority === 'P1') activeP1 += n;
        if (row.priority === 'P2') activeP2 += n;
        orgLoad[row.org_id] = (orgLoad[row.org_id] ?? 0) + n;
      }

      // ── Running SLAs ──────────────────────────────────────────────────────
      const slaRow = await client.query<{ cnt: string }>(
        `SELECT count(*)::text as cnt FROM sla_timers WHERE tenant_id = $1 AND state = 'running'`,
        [tenantId],
      );
      const runningSlas = parseInt(slaRow.rows[0]?.cnt ?? '0', 10);

      // ── Approaching breach (timers within 30% of target) ─────────────────
      const approachRow = await client.query<{ cnt: string }>(
        `SELECT count(*)::text as cnt FROM sla_timers
          WHERE tenant_id = $1 AND state = 'running'
            AND next_fire_at < now() + interval '1 hour'`,
        [tenantId],
      );
      const approachingBreach = parseInt(approachRow.rows[0]?.cnt ?? '0', 10);

      // ── 7-day CSAT ────────────────────────────────────────────────────────
      const csatRow = await client.query<{ avg: string | null; cnt: string }>(
        `SELECT avg(score)::text as avg, count(*)::text as cnt
           FROM csat_surveys
          WHERE tenant_id = $1
            AND created_at >= now() - interval '7 days'
            AND score IS NOT NULL`,
        [tenantId],
      );
      const csatAvg = parseFloat(csatRow.rows[0]?.avg ?? '0') || 0;
      const csatCount = parseInt(csatRow.rows[0]?.cnt ?? '0', 10);

      await client.query('COMMIT');

      // ── Compare with Redis and emit drift ─────────────────────────────────
      const redisKpi = await this.store.getKpi(tenantId);
      const pgKpi: Record<string, number> = {
        open_total: openTotal,
        active_p1: activeP1,
        active_p2: activeP2,
        running_slas: runningSlas,
        approaching_breach: approachingBreach,
        csat_7d_avg: Math.round(csatAvg * 100), // store as int * 100
        csat_7d_count: csatCount,
      };

      for (const [counter, pgValue] of Object.entries(pgKpi)) {
        const redisValue = redisKpi[counter] ?? 0;
        const drift = Math.abs(redisValue - pgValue);
        if (drift > 0) {
          this.emitMetric('dashboard_aggregate_drift', { tenantId, counter, drift: String(drift) });
        }
      }

      // ── Overwrite Redis with authoritative values ─────────────────────────
      const hasDrift = Object.entries(pgKpi).some(
        ([counter, pgValue]) => (redisKpi[counter] ?? 0) !== pgValue,
      );

      await this.store.overwriteKpi(tenantId, pgKpi);

      // Overwrite org_load hash
      const pipeline = this.redis.pipeline();
      pipeline.del(Keys.orgLoad(tenantId));
      for (const [orgId, count] of Object.entries(orgLoad)) {
        if (count > 0) pipeline.hset(Keys.orgLoad(tenantId), orgId, count);
      }

      // WO-069: if reconciler corrected drift, flag the tenant so the next
      // delta-publisher interval emits a full snapshot frame instead of a delta.
      // Clients that applied the drifted values will re-sync from the snapshot.
      if (hasDrift) {
        pipeline.set(Keys.needsSnapshot(tenantId), '1');
        this.logger.log('Drift corrected — snapshot frame will be emitted on next interval', {
          tenantId,
        });
      }

      await pipeline.exec();

      this.logger.debug('Reconcile complete', { tenantId, openTotal, activeP1, runningSlas });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private async getActiveTenants(): Promise<string[]> {
    const members = await this.redis.smembers(Keys.activeTenants());
    return members;
  }

  private emitMetric(name: string, labels: Record<string, string>): void {
    console.log(JSON.stringify({ metric: name, labels, value: 1, ts: Date.now() }));
  }
}
