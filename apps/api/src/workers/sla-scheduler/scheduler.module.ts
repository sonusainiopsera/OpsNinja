/**
 * SchedulerModule — NestJS standalone module for the SLA scheduler worker (WO-046).
 *
 * Provides:
 *   - TimerClaimRepository backed by a dedicated pool for the scheduler claim role.
 *   - SchedulerService (tick orchestrator).
 *   - Default implementations of TicketStateChecker and PolicyThresholdsLoader
 *     that use raw SQL against the scheduler claim pool.
 */

import { Module, Provider } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { TimerClaimRepository } from './timer-claim.repository';
import {
  SchedulerService,
  TicketStateChecker,
  PolicyThresholdsLoader,
} from './scheduler.service';

// ---------------------------------------------------------------------------
// Injection tokens
// ---------------------------------------------------------------------------

export const CLAIM_POOL = 'CLAIM_POOL';

// ---------------------------------------------------------------------------
// Default TicketStateChecker — checks ticket status via raw SQL
// ---------------------------------------------------------------------------

class DefaultTicketStateChecker implements TicketStateChecker {
  private static readonly TERMINAL_STATUSES = new Set(['resolved', 'closed', 'cancelled']);

  async isTerminal(tenantId: string, ticketId: string, client: PoolClient): Promise<boolean> {
    const { rows } = await client.query<{ status: string }>(
      `SELECT status FROM tickets WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [ticketId, tenantId],
    );

    if (rows.length === 0) {
      // Ticket not found (deleted / purged) — treat as terminal.
      return true;
    }

    return DefaultTicketStateChecker.TERMINAL_STATUSES.has(rows[0]!.status);
  }
}

// ---------------------------------------------------------------------------
// Default PolicyThresholdsLoader — reads sla_policies via raw SQL
// ---------------------------------------------------------------------------

class DefaultPolicyThresholdsLoader implements PolicyThresholdsLoader {
  async loadThresholds(
    tenantId: string,
    slaPolicyId: string,
    client: PoolClient,
  ): Promise<{ reminderPctFirst: number; reminderPctSecond: number } | null> {
    const { rows } = await client.query<{
      reminder_pct_first: number;
      reminder_pct_second: number;
    }>(
      `SELECT reminder_pct_first, reminder_pct_second
       FROM sla_policies
       WHERE id = $1 AND tenant_id = $2
       LIMIT 1`,
      [slaPolicyId, tenantId],
    );

    if (rows.length === 0) return null;

    return {
      reminderPctFirst: rows[0]!.reminder_pct_first,
      reminderPctSecond: rows[0]!.reminder_pct_second,
    };
  }
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function createClaimPool(): Pool {
  return new Pool({
    connectionString: process.env['SCHEDULER_DATABASE_URL'] ?? process.env['DATABASE_URL'],
    // Additional connection parameter overrides can be passed via env vars.
    // The scheduler role credentials are embedded in the connection string.
    max: parseInt(process.env['SCHEDULER_POOL_SIZE'] ?? '5', 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // 60s statement timeout — ticks must complete well within this.
    statement_timeout: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const claimPoolProvider: Provider = {
  provide: CLAIM_POOL,
  useFactory: createClaimPool,
};

const timerClaimRepoProvider: Provider = {
  provide: TimerClaimRepository,
  useFactory: (pool: Pool) => new TimerClaimRepository(pool),
  inject: [CLAIM_POOL],
};

const ticketStateCheckerProvider: Provider = {
  provide: 'TicketStateChecker',
  useClass: DefaultTicketStateChecker,
};

const policyThresholdsLoaderProvider: Provider = {
  provide: 'PolicyThresholdsLoader',
  useClass: DefaultPolicyThresholdsLoader,
};

const schedulerServiceProvider: Provider = {
  provide: SchedulerService,
  useFactory: (
    claimRepo: TimerClaimRepository,
    ticketChecker: TicketStateChecker,
    policyLoader: PolicyThresholdsLoader,
  ) => new SchedulerService(claimRepo, ticketChecker, policyLoader),
  inject: [TimerClaimRepository, 'TicketStateChecker', 'PolicyThresholdsLoader'],
};

@Module({
  providers: [
    claimPoolProvider,
    timerClaimRepoProvider,
    ticketStateCheckerProvider,
    policyThresholdsLoaderProvider,
    schedulerServiceProvider,
  ],
  exports: [SchedulerService, TimerClaimRepository],
})
export class SchedulerModule {}
