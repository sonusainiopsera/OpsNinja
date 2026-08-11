/**
 * SlaTimersRepository — data access for sla_timers (WO-045).
 *
 * Extends TenantRepository so all queries run inside the RLS-bound tenant
 * transaction. insertTimer uses ON CONFLICT DO NOTHING so a retried
 * ticket-create cannot produce duplicate clocks.
 */

import { Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import {
  slaTimers,
  type SlaTimer,
  type NewSlaTimer,
} from '@opsninja/db';
import { TenantRepository } from '../../data/tenant-repository';

@Injectable()
export class SlaTimersRepository extends TenantRepository {

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  async findByTicketId(tenantId: string, ticketId: string): Promise<SlaTimer[]> {
    return this.tx
      .select()
      .from(slaTimers)
      .where(and(eq(slaTimers.tenantId, tenantId), eq(slaTimers.ticketId, ticketId)));
  }

  async findById(tenantId: string, id: string): Promise<SlaTimer | null> {
    const rows = await this.tx
      .select()
      .from(slaTimers)
      .where(and(eq(slaTimers.tenantId, tenantId), eq(slaTimers.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  // --------------------------------------------------------------------------
  // Writes
  // --------------------------------------------------------------------------

  /**
   * Insert a timer using ON CONFLICT DO NOTHING on (tenant_id, ticket_id, clock_type).
   * Returns null when the row already existed (idempotent retry path).
   */
  async insertTimer(data: NewSlaTimer): Promise<SlaTimer | null> {
    const rows = await this.tx
      .insert(slaTimers)
      .values(data)
      .onConflictDoNothing()
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Partial update for priority-recompute path.
   * Only updates the supplied columns; tenant_id guard enforces RLS in code.
   */
  async updateTimer(
    tenantId: string,
    id: string,
    patch: Partial<Pick<SlaTimer, 'slaPolicyId' | 'targetAt' | 'nextFireAt' | 'lastStateChangeAt' | 'updatedAt'>>,
  ): Promise<SlaTimer | null> {
    const rows = await this.tx
      .update(slaTimers)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(slaTimers.tenantId, tenantId), eq(slaTimers.id, id)))
      .returning();
    return rows[0] ?? null;
  }
}
