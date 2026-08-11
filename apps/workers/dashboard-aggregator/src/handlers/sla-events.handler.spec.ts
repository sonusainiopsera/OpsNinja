/**
 * Unit tests for SLA event handlers — pure function coverage.
 */

import {
  handleSlaTimerStarted,
  handleSlaTimerPaused,
  handleSlaTimerResumed,
  handleSlaThresholdReached,
  handleSlaBreached,
} from './sla-events.handler';
import {
  slaTimerStarted,
  slaTimerPaused,
  slaTimerResumed,
  slaThresholdReached,
  slaBreached,
  TENANT_A,
  TICKET_1,
} from '../../test/fixtures/outbox-events.fixtures';
import { Keys } from '../redis/keys';
import type { MutationCmd } from '../redis/aggregate.store';

function hincrBy(cmds: MutationCmd[], key: string, field: string): number {
  for (const cmd of cmds) {
    if (cmd[0] === 'HINCRBY' && cmd[1] === key && cmd[2] === field) return cmd[3] as number;
  }
  return 0;
}

describe('handleSlaTimerStarted', () => {
  it('increments running_slas', () => {
    const cmds = handleSlaTimerStarted(slaTimerStarted);
    expect(hincrBy(cmds, Keys.kpi(TENANT_A), 'running_slas')).toBe(1);
  });

  it('adds ticket to breach_risk with correct score', () => {
    const cmds = handleSlaTimerStarted(slaTimerStarted);
    const zadd = cmds.find((c) => c[0] === 'ZADD' && c[1] === Keys.breachRisk(TENANT_A));
    expect(zadd).toBeDefined();
    // Score should be epoch ms of 2026-01-01T01:00:00.000Z
    const expectedScore = new Date('2026-01-01T01:00:00.000Z').getTime();
    expect(zadd?.[4]).toBe(TICKET_1);
    expect(zadd?.[3]).toBe(expectedScore);
  });
});

describe('handleSlaTimerPaused', () => {
  it('decrements running_slas and removes from breach_risk', () => {
    const cmds = handleSlaTimerPaused(slaTimerPaused);
    expect(hincrBy(cmds, Keys.kpi(TENANT_A), 'running_slas')).toBe(-1);
    const zrem = cmds.find((c) => c[0] === 'ZREM');
    expect(zrem?.[2]).toBe(TICKET_1);
  });
});

describe('handleSlaTimerResumed', () => {
  it('re-adds to breach_risk with updated score', () => {
    const cmds = handleSlaTimerResumed(slaTimerResumed);
    const zadd = cmds.find((c) => c[0] === 'ZADD');
    expect(zadd).toBeDefined();
  });
});

describe('handleSlaThresholdReached', () => {
  it('increments approaching_breach', () => {
    const cmds = handleSlaThresholdReached(slaThresholdReached);
    expect(hincrBy(cmds, Keys.kpi(TENANT_A), 'approaching_breach')).toBe(1);
  });
});

describe('handleSlaBreached', () => {
  it('decrements running_slas and approaching_breach, removes from breach_risk', () => {
    const cmds = handleSlaBreached(slaBreached);
    expect(hincrBy(cmds, Keys.kpi(TENANT_A), 'running_slas')).toBe(-1);
    expect(hincrBy(cmds, Keys.kpi(TENANT_A), 'approaching_breach')).toBe(-1);
    const zrem = cmds.find((c) => c[0] === 'ZREM');
    expect(zrem?.[2]).toBe(TICKET_1);
  });
});
