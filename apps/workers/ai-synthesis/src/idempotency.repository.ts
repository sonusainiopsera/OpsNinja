/**
 * IdempotencyRepository — dedup guard for the AI synthesis worker.
 *
 * Keyed on (tenant_id, event_id) with a 7-day TTL.
 * Uses INSERT ... ON CONFLICT DO NOTHING with RETURNING to achieve
 * compare-and-swap semantics without a separate SELECT.
 *
 * Returns true  → first time we see this (event_id, tenant_id) pair; process it.
 * Returns false → already processed; skip silently.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, and, lt } from 'drizzle-orm';
import { aiSynthesisIdempotency } from '@opsninja/db';

const TTL_DAYS = 7;

@Injectable()
export class IdempotencyRepository {
  private readonly logger = new Logger(IdempotencyRepository.name);

  constructor(private readonly pool: Pool) {}

  /**
   * Claim (tenant_id, event_id).
   * Must be called inside a tenant-bound transaction (SET LOCAL already set).
   *
   * @returns true if the claim was new (proceed), false if duplicate (skip).
   */
  async claim(
    client: import('pg').PoolClient,
    tenantId: string,
    eventId: string,
  ): Promise<boolean> {
    const tx = drizzle(client as never, { schema: { aiSynthesisIdempotency } });
    const expiresAt = new Date(Date.now() + TTL_DAYS * 86_400_000);

    const rows = await tx
      .insert(aiSynthesisIdempotency)
      .values({ tenantId, eventId, expiresAt })
      .onConflictDoNothing()
      .returning({ id: aiSynthesisIdempotency.id });

    return rows.length > 0;
  }

  /**
   * Delete expired rows older than TTL_DAYS.
   * Called opportunistically at worker startup; non-critical if it fails.
   */
  async pruneExpired(): Promise<void> {
    const client = await this.pool.connect();
    try {
      const tx = drizzle(client as never, { schema: { aiSynthesisIdempotency } });
      await tx
        .delete(aiSynthesisIdempotency)
        .where(lt(aiSynthesisIdempotency.expiresAt, new Date()));
    } catch (err) {
      this.logger.warn('Failed to prune expired idempotency rows', {
        error: (err as Error).message,
      });
    } finally {
      client.release();
    }
  }
}
