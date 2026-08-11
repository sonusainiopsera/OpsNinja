/**
 * Unit tests for SchedulerService — WO-046 AC11.
 *
 * Tests tick orchestration logic without a real database.  All DB calls are
 * mocked via jest.fn(). The injectable clock lets us control "now" precisely.
 *
 * Covers:
 *  1. Happy path: reminder fires → outbox event written → timer advanced.
 *  2. Breach path: state transitions to 'breached', next_fire_at → null.
 *  3. Terminal ticket: timer transitioned to 'met', no outbox event.
 *  4. Policy not found: timer transitioned to 'cancelled'.
 *  5. Per-timer error isolation: one bad timer does not abort the batch.
 *  6. Consecutive-failure parking: after 5 failures, state→'error'.
 *  7. Lag computation exposed via getLagSeconds().
 *  8. Readiness probe returns false when lag exceeds threshold.
 *  9. Draining: onModuleDestroy stops scheduling new ticks.
 */

import { Test } from '@nestjs/testing';
import { PoolClient } from 'pg';
import { SchedulerService, LAG_READY_THRESHOLD_SECONDS } from './scheduler.service';
import { TimerClaimRepository, SLA_EVENT_TYPES } from './timer-claim.repository';
import type { ClaimableTimer, SlaBoundary } from './boundary-classifier';

// ---------------------------------------------------------------------------
// Shared timer fixture
// ---------------------------------------------------------------------------

const T0 = new Date('2026-08-11T10:00:00.000Z');
const T_TARGET = new Date('2026-08-11T14:00:00.000Z');

function makeTimer(overrides: Partial<ClaimableTimer> = {}): ClaimableTimer {
  return {
    id: 'timer-001',
    tenantId: 'tenant-001',
    ticketId: 'ticket-001',
    slaPolicyId: 'policy-001',
    clockType: 'response',
    state: 'running',
    pausedMs: 0,
    startedAt: T0,
    targetAt: T_TARGET,
    nextFireAt: new Date('2026-08-11T12:00:00.000Z'),
    ...overrides,
  };
}

const DEFAULT_THRESHOLDS = { reminderPctFirst: 50, reminderPctSecond: 75 };

// ---------------------------------------------------------------------------
// Mock builder helpers
// ---------------------------------------------------------------------------

function buildMockClaimRepo(timerOverrides: Partial<ClaimableTimer> = {}) {
  const mockClient = {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: jest.fn(),
  } as unknown as PoolClient;

  const timer = makeTimer(timerOverrides);

  const repo = {
    claimDueTimers: jest.fn().mockResolvedValue({
      timers: [timer],
      oldestNextFireAt: timer.nextFireAt,
      client: mockClient,
    }),
    advanceTimer: jest.fn().mockResolvedValue(undefined),
    recordFiredBoundary: jest.fn().mockResolvedValue(true),
    loadFiredBoundaries: jest.fn().mockResolvedValue(new Set<SlaBoundary>()),
    writeOutboxEvent: jest.fn().mockResolvedValue(undefined),
    onModuleDestroy: jest.fn(),
  } as unknown as TimerClaimRepository;

  return { repo, timer, mockClient };
}

function buildTicketChecker(isTerminal = false) {
  return { isTerminal: jest.fn().mockResolvedValue(isTerminal) };
}

function buildPolicyLoader(found = true) {
  return {
    loadThresholds: jest.fn().mockResolvedValue(found ? DEFAULT_THRESHOLDS : null),
  };
}

async function buildService(
  repo: TimerClaimRepository,
  ticketChecker = buildTicketChecker(),
  policyLoader = buildPolicyLoader(),
  clockMs?: number,
) {
  const service = new SchedulerService(repo, ticketChecker as never, policyLoader as never);
  // Prevent auto-tick in tests.
  service['scheduleTick'] = jest.fn();
  if (clockMs !== undefined) {
    service.setClock(() => new Date(clockMs));
  } else {
    // Default: clock is past the first reminder but before second.
    service.setClock(() => new Date('2026-08-11T12:30:00.000Z'));
  }
  return service;
}

// ---------------------------------------------------------------------------
// 1. Happy path: reminder_first fires
// ---------------------------------------------------------------------------

describe('SchedulerService.runTick — reminder_first', () => {
  it('writes outbox event and advances timer', async () => {
    const { repo, mockClient } = buildMockClaimRepo();
    const service = await buildService(repo);

    // Clock: past 50% but before 75%
    service.setClock(() => new Date('2026-08-11T12:30:00.000Z'));

    await service.runTick();

    expect(repo.recordFiredBoundary).toHaveBeenCalledWith(
      mockClient, 'tenant-001', 'timer-001', 'reminder_first',
    );
    expect(repo.writeOutboxEvent).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({
        eventType: SLA_EVENT_TYPES.REMINDER_DUE,
        tenantId: 'tenant-001',
        aggregateId: 'timer-001',
      }),
    );
    expect(repo.advanceTimer).toHaveBeenCalledWith(
      mockClient,
      'timer-001',
      expect.objectContaining({ state: 'running', nextFireAt: expect.any(Date) }),
    );
    expect(mockClient.release).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. Breach path
// ---------------------------------------------------------------------------

describe('SchedulerService.runTick — breach', () => {
  it('transitions state to breached and sets nextFireAt=null', async () => {
    const { repo, mockClient } = buildMockClaimRepo();
    // All reminders already fired
    repo.loadFiredBoundaries = jest.fn().mockResolvedValue(
      new Set(['reminder_first', 'reminder_second']),
    );
    const service = await buildService(repo);
    // Clock: past target_at
    service.setClock(() => new Date('2026-08-11T14:30:00.000Z'));

    await service.runTick();

    expect(repo.writeOutboxEvent).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({ eventType: SLA_EVENT_TYPES.BREACHED }),
    );
    expect(repo.advanceTimer).toHaveBeenCalledWith(
      mockClient,
      'timer-001',
      expect.objectContaining({ state: 'breached', nextFireAt: null }),
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Terminal ticket
// ---------------------------------------------------------------------------

describe('SchedulerService.runTick — terminal ticket', () => {
  it('transitions timer to met and writes no outbox event', async () => {
    const { repo } = buildMockClaimRepo();
    const ticketChecker = buildTicketChecker(true); // isTerminal = true
    const service = await buildService(repo, ticketChecker);
    service.setClock(() => new Date('2026-08-11T14:30:00.000Z'));

    await service.runTick();

    expect(repo.writeOutboxEvent).not.toHaveBeenCalled();
    expect(repo.advanceTimer).toHaveBeenCalledWith(
      expect.anything(), 'timer-001',
      expect.objectContaining({ state: 'met', nextFireAt: null }),
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Policy not found
// ---------------------------------------------------------------------------

describe('SchedulerService.runTick — policy not found', () => {
  it('transitions timer to cancelled and writes no outbox event', async () => {
    const { repo } = buildMockClaimRepo();
    const policyLoader = buildPolicyLoader(false); // returns null
    const service = await buildService(repo, buildTicketChecker(), policyLoader);
    service.setClock(() => new Date('2026-08-11T12:30:00.000Z'));

    await service.runTick();

    expect(repo.writeOutboxEvent).not.toHaveBeenCalled();
    expect(repo.advanceTimer).toHaveBeenCalledWith(
      expect.anything(), 'timer-001',
      expect.objectContaining({ state: 'cancelled', nextFireAt: null }),
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Per-timer error isolation
// ---------------------------------------------------------------------------

describe('SchedulerService.runTick — per-timer error isolation', () => {
  it('continues processing after one timer throws', async () => {
    const timer1 = makeTimer({ id: 'timer-001' });
    const timer2 = makeTimer({ id: 'timer-002' });

    const mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    } as unknown as PoolClient;

    const repo = {
      claimDueTimers: jest.fn().mockResolvedValue({
        timers: [timer1, timer2],
        oldestNextFireAt: timer1.nextFireAt,
        client: mockClient,
      }),
      advanceTimer: jest.fn().mockResolvedValue(undefined),
      recordFiredBoundary: jest.fn()
        .mockRejectedValueOnce(new Error('DB error on timer-001'))
        .mockResolvedValue(true),
      loadFiredBoundaries: jest.fn().mockResolvedValue(new Set<SlaBoundary>()),
      writeOutboxEvent: jest.fn().mockResolvedValue(undefined),
      onModuleDestroy: jest.fn(),
    } as unknown as TimerClaimRepository;

    const service = await buildService(repo);
    service.setClock(() => new Date('2026-08-11T12:30:00.000Z'));

    await service.runTick();

    // timer-002 should still have been attempted.
    expect(repo.recordFiredBoundary).toHaveBeenCalledTimes(2);
    // Commit still called.
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });
});

// ---------------------------------------------------------------------------
// 6. Consecutive-failure parking
// ---------------------------------------------------------------------------

describe('SchedulerService — consecutive failure parking', () => {
  it('parks timer with state=error after 5 consecutive failures', async () => {
    const timer = makeTimer();
    const mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    } as unknown as PoolClient;

    let callCount = 0;
    const repo = {
      claimDueTimers: jest.fn().mockResolvedValue({
        timers: [timer],
        oldestNextFireAt: timer.nextFireAt,
        client: mockClient,
      }),
      advanceTimer: jest.fn().mockResolvedValue(undefined),
      recordFiredBoundary: jest.fn().mockRejectedValue(new Error('persistent DB error')),
      loadFiredBoundaries: jest.fn().mockRejectedValue(new Error('persistent DB error')),
      writeOutboxEvent: jest.fn().mockResolvedValue(undefined),
      onModuleDestroy: jest.fn(),
    } as unknown as TimerClaimRepository;

    const service = await buildService(repo);
    service.setClock(() => new Date('2026-08-11T12:30:00.000Z'));

    // Run 5 ticks — on the 5th, the timer should be parked.
    for (let i = 0; i < 5; i++) {
      await service.runTick();
    }

    // After 5 failures, should call UPDATE ... SET state = 'error'
    const parkCall = (mockClient.query as jest.Mock).mock.calls.find(
      (args: unknown[]) => typeof args[0] === 'string' && (args[0] as string).includes("'error'"),
    );
    expect(parkCall).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 7. Lag computation via getLagSeconds
// ---------------------------------------------------------------------------

describe('SchedulerService — lag computation', () => {
  it('getLagSeconds reflects the oldest overdue next_fire_at', async () => {
    const overdueAt = new Date('2026-08-11T12:00:00.000Z');
    const { repo } = buildMockClaimRepo();
    repo.claimDueTimers = jest.fn().mockResolvedValue({
      timers: [],
      oldestNextFireAt: overdueAt,
      client: {
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: jest.fn(),
      },
    });

    const nowMs = new Date('2026-08-11T12:01:00.000Z').getTime();
    const service = await buildService(repo, buildTicketChecker(), buildPolicyLoader(), nowMs);

    await service.runTick();

    expect(service.getLagSeconds()).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// 8. Readiness probe
// ---------------------------------------------------------------------------

describe('SchedulerService — readiness probe', () => {
  it('isReady() returns false when lag exceeds threshold', async () => {
    const { repo } = buildMockClaimRepo();
    const overdueAt = new Date('2026-08-11T10:00:00.000Z');
    repo.claimDueTimers = jest.fn().mockResolvedValue({
      timers: [],
      oldestNextFireAt: overdueAt,
      client: {
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: jest.fn(),
      },
    });

    // now = overdueAt + (threshold + 1) seconds
    const nowMs = overdueAt.getTime() + (LAG_READY_THRESHOLD_SECONDS + 1) * 1000;
    const service = await buildService(repo, buildTicketChecker(), buildPolicyLoader(), nowMs);

    await service.runTick();

    expect(service.isReady()).toBe(false);
  });

  it('isReady() returns true when lag is within threshold', async () => {
    const { repo } = buildMockClaimRepo();
    repo.claimDueTimers = jest.fn().mockResolvedValue({
      timers: [],
      oldestNextFireAt: null,
      client: {
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: jest.fn(),
      },
    });

    const service = await buildService(repo);
    await service.runTick();

    expect(service.isReady()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. Draining: onModuleDestroy stops scheduling
// ---------------------------------------------------------------------------

describe('SchedulerService.onModuleDestroy', () => {
  it('sets draining=true so no new ticks are scheduled', () => {
    const { repo } = buildMockClaimRepo();
    const service = new SchedulerService(
      repo,
      buildTicketChecker() as never,
      buildPolicyLoader() as never,
    );
    service['scheduleTick'] = jest.fn();

    service.onModuleDestroy();
    expect(service['draining']).toBe(true);
  });
});
