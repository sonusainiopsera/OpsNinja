/**
 * Unit tests for ticket event handlers.
 *
 * Pure functions — no Redis, no NestJS, no I/O.
 * AC-10: covers counter arithmetic, clamp-at-zero, priority-change paths.
 */

import {
  handleTicketCreated,
  handleTicketPriorityChanged,
  handleTicketClosedOrResolved,
  handleTicketReopened,
} from './ticket-events.handler';
import {
  ticketCreatedP1,
  ticketCreatedP2,
  ticketPriorityP1ToP3,
  ticketResolved,
  ticketReopened,
  ticketClosed,
  TENANT_A,
  TICKET_1,
  ORG_1,
} from '../../test/fixtures/outbox-events.fixtures';
import { Keys } from '../redis/keys';
import type { MutationCmd } from '../redis/aggregate.store';

// Helper: extract HINCRBY increment for a given key+field
function hincrBy(cmds: MutationCmd[], key: string, field: string): number {
  for (const cmd of cmds) {
    if (cmd[0] === 'HINCRBY' && cmd[1] === key && cmd[2] === field) {
      return cmd[3] as number;
    }
  }
  return 0;
}

describe('handleTicketCreated', () => {
  it('increments open_total and active_p1 for a P1 ticket', () => {
    const cmds = handleTicketCreated(ticketCreatedP1);
    expect(hincrBy(cmds, Keys.kpi(TENANT_A), 'open_total')).toBe(1);
    expect(hincrBy(cmds, Keys.kpi(TENANT_A), 'active_p1')).toBe(1);
    expect(hincrBy(cmds, Keys.kpi(TENANT_A), 'active_p2')).toBe(0);
  });

  it('increments open_total and active_p2 for a P2 ticket', () => {
    const cmds = handleTicketCreated(ticketCreatedP2);
    expect(hincrBy(cmds, Keys.kpi(TENANT_A), 'open_total')).toBe(1);
    expect(hincrBy(cmds, Keys.kpi(TENANT_A), 'active_p2')).toBe(1);
    expect(hincrBy(cmds, Keys.kpi(TENANT_A), 'active_p1')).toBe(0);
  });

  it('increments org_load for the organization', () => {
    const cmds = handleTicketCreated(ticketCreatedP1);
    expect(hincrBy(cmds, Keys.orgLoad(TENANT_A), ORG_1)).toBe(1);
  });

  it('appends a feed entry', () => {
    const cmds = handleTicketCreated(ticketCreatedP1);
    const lpush = cmds.find((c) => c[0] === 'LPUSH' && c[1] === Keys.feed(TENANT_A));
    expect(lpush).toBeDefined();
    const ltrim = cmds.find((c) => c[0] === 'LTRIM');
    expect(ltrim).toBeDefined();
  });
});

describe('handleTicketPriorityChanged', () => {
  it('decrements active_p1 and does not touch active_p2 when P1→P3', () => {
    const cmds = handleTicketPriorityChanged(ticketPriorityP1ToP3);
    expect(hincrBy(cmds, Keys.kpi(TENANT_A), 'active_p1')).toBe(-1); // decrement old
    // New priority P3 → no P2 increment
    const p2cmds = cmds.filter((c) => c[0] === 'HINCRBY' && c[2] === 'active_p2');
    expect(p2cmds.length).toBe(0);
  });

  it('produces net-zero when same priority (P2→P2)', () => {
    const event = {
      ...ticketCreatedP2,
      eventType: 'ticket.priority_changed',
      payload: { previousPriority: 'P2', newPriority: 'P2', organizationId: ORG_1 },
    };
    const cmds = handleTicketPriorityChanged(event);
    const net = cmds
      .filter((c) => c[0] === 'HINCRBY' && c[2] === 'active_p2')
      .reduce((s, c) => s + (c[3] as number), 0);
    expect(net).toBe(0);
  });
});

describe('handleTicketClosedOrResolved', () => {
  it('decrements open_total and active_p2 when closing an open P2 ticket', () => {
    const cmds = handleTicketClosedOrResolved(ticketClosed);
    expect(hincrBy(cmds, Keys.kpi(TENANT_A), 'open_total')).toBe(-1);
    expect(hincrBy(cmds, Keys.kpi(TENANT_A), 'active_p2')).toBe(-1);
  });

  it('removes ticket from breach_risk sorted set', () => {
    const cmds = handleTicketClosedOrResolved(ticketResolved);
    const zrem = cmds.find((c) => c[0] === 'ZREM' && c[1] === Keys.breachRisk(TENANT_A));
    expect(zrem).toBeDefined();
    expect(zrem?.[2]).toBe(TICKET_1);
  });

  it('does not decrement counters when previous status was already closed', () => {
    const event = { ...ticketClosed, payload: { ...ticketClosed.payload, previousStatus: 'closed' } };
    const cmds = handleTicketClosedOrResolved(event);
    const openDelta = hincrBy(cmds, Keys.kpi(TENANT_A), 'open_total');
    expect(openDelta).toBe(0);
  });
});

describe('handleTicketReopened', () => {
  it('increments open_total when reopened', () => {
    const cmds = handleTicketReopened(ticketReopened);
    expect(hincrBy(cmds, Keys.kpi(TENANT_A), 'open_total')).toBe(1);
  });
});
