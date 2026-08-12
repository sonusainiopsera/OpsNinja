/**
 * SlaTimerEventsRepository — append-only access for sla_timer_events (WO-047).
 *
 * The underlying table is physically append-only (DB trigger raises on UPDATE/DELETE).
 * This repository therefore only exposes insert and read operations.
 */

import { Injectable } from '@nestjs/common';
import { eq, and, asc } from 'drizzle-orm';
import {
  slaTimerEvents,
  type SlaTimerEvent,
  type NewSlaTimerEvent,
} from '@opsninja/db';
import { TenantRepository } from '../../data/tenant-repository';

@Injectable()
export class SlaTimerEventsRepository extends TenantRepository {

  // --------------------------------------------------------------------------
  // Writes (append-only)
  // --------------------------------------------------------------------------

  /**
   * Append a state-transition event. The DB trigger prevents UPDATE/DELETE so
   * this is the only mutation path.
   */
  async appendEvent(data: NewSlaTimerEvent): Promise<SlaTimerEvent> {
    const rows = await this.tx
      .insert(slaTimerEvents)
      .values(data)
      .returning();
    const row = rows[0];
    if (!row) throw new Error('sla_timer_events insert returned no row');
    return row;
  }

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  /**
   * Return all events for a timer in ascending chronological order.
   * Used by the audit reconstruction helper and integration tests.
   */
  async findByTimerId(
    tenantId: string,
    timerId: string,
  ): Promise<SlaTimerEvent[]> {
    return this.tx
      .select()
      .from(slaTimerEvents)
      .where(
        and(
          eq(slaTimerEvents.tenantId, tenantId),
          eq(slaTimerEvents.timerId, timerId),
        ),
      )
      .orderBy(asc(slaTimerEvents.occurredAt));
  }

  /**
   * Return all events for a ticket (across all timers) in ascending order.
   */
  async findByTicketId(
    tenantId: string,
    ticketId: string,
  ): Promise<SlaTimerEvent[]> {
    return this.tx
      .select()
      .from(slaTimerEvents)
      .where(
        and(
          eq(slaTimerEvents.tenantId, tenantId),
          eq(slaTimerEvents.ticketId, ticketId),
        ),
      )
      .orderBy(asc(slaTimerEvents.occurredAt));
  }
}
