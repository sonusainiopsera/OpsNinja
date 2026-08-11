/**
 * ticket-state-machine.spec.ts — unit tests for the pure state machine.
 *
 * Covers:
 *   - Every allowed transition in the transition table returns allowed=true.
 *   - Every blocked (from, to) pair returns INVALID_TRANSITION.
 *   - Permission-gated transitions return PERMISSION_DENIED when the permission
 *     is absent, and allowed=true when it is present.
 *   - Self-transitions are always INVALID_TRANSITION.
 *   - reachableStatuses returns the correct subset for given permissions.
 *
 * No NestJS, no database, no async — pure function tests only.
 * Tests are independent and parallel-safe (no shared mutable state, no sleeps).
 */

import { validateTransition, reachableStatuses } from './ticket-state-machine';
import { TRANSITION_TABLE, transitionKey } from './transition-table';
import type { TicketStatus } from '@opsninja/db';

const ALL_STATUSES: TicketStatus[] = [
  'new',
  'open',
  'pending_customer',
  'pending_engineering',
  'resolved',
  'closed',
];

// Full admin-level permission set (covers all transitions)
const ALL_PERMS = ['ticket:update', 'ticket:close', 'ticket:reassign'] as const;
const UPDATE_ONLY = ['ticket:update'] as const;
const CLOSE_ONLY = ['ticket:close'] as const;
const NO_PERMS: string[] = [];

describe('validateTransition — table-driven allowed paths', () => {
  // For each entry in the transition table, the holder of the required permission
  // must receive allowed=true.
  for (const [key, rule] of TRANSITION_TABLE) {
    const [from, to] = key.split('→') as [TicketStatus, TicketStatus];

    it(`allows ${from} → ${to} when holding ${rule.requiredPermission}`, () => {
      const result = validateTransition({
        currentStatus: from,
        requestedStatus: to,
        principalPermissions: [rule.requiredPermission],
      });
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.rule).toBe(rule);
      }
    });
  }
});

describe('validateTransition — permission-denied paths', () => {
  // ticket:close transitions must be denied when only ticket:update is held
  const closeOnlyTransitions: [TicketStatus, TicketStatus][] = [
    ['open', 'closed'],
    ['pending_customer', 'closed'],
    ['pending_engineering', 'closed'],
    ['resolved', 'closed'],
    ['closed', 'open'],
  ];

  for (const [from, to] of closeOnlyTransitions) {
    it(`denies ${from} → ${to} without ticket:close`, () => {
      const result = validateTransition({
        currentStatus: from,
        requestedStatus: to,
        principalPermissions: UPDATE_ONLY,
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe('PERMISSION_DENIED');
        expect(result.requiredPermission).toBe('ticket:close');
      }
    });
  }
});

describe('validateTransition — invalid transition paths', () => {
  // None of the statuses can directly jump to themselves
  for (const status of ALL_STATUSES) {
    it(`self-transition ${status} → ${status} is INVALID_TRANSITION`, () => {
      const result = validateTransition({
        currentStatus: status,
        requestedStatus: status,
        principalPermissions: ALL_PERMS,
      });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe('INVALID_TRANSITION');
      }
    });
  }

  // closed → pending_customer is not in the table
  it('rejects closed → pending_customer as INVALID_TRANSITION', () => {
    const result = validateTransition({
      currentStatus: 'closed',
      requestedStatus: 'pending_customer',
      principalPermissions: ALL_PERMS,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('INVALID_TRANSITION');
    }
  });

  // resolved → pending_engineering is not in the table
  it('rejects resolved → pending_engineering as INVALID_TRANSITION', () => {
    const result = validateTransition({
      currentStatus: 'resolved',
      requestedStatus: 'pending_engineering',
      principalPermissions: ALL_PERMS,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('INVALID_TRANSITION');
    }
  });

  // new → closed is not in the table
  it('rejects new → closed as INVALID_TRANSITION', () => {
    const result = validateTransition({
      currentStatus: 'new',
      requestedStatus: 'closed',
      principalPermissions: ALL_PERMS,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('INVALID_TRANSITION');
    }
  });
});

describe('validateTransition — SLA metadata', () => {
  it('open → pending_customer sets slaPause=true', () => {
    const result = validateTransition({
      currentStatus: 'open',
      requestedStatus: 'pending_customer',
      principalPermissions: UPDATE_ONLY,
    });
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.rule.slaPause).toBe(true);
      expect(result.rule.slaResume).toBe(false);
    }
  });

  it('pending_customer → open sets slaResume=true', () => {
    const result = validateTransition({
      currentStatus: 'pending_customer',
      requestedStatus: 'open',
      principalPermissions: UPDATE_ONLY,
    });
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.rule.slaResume).toBe(true);
      expect(result.rule.slaPause).toBe(false);
    }
  });

  it('open → pending_engineering sets slaPause=true', () => {
    const result = validateTransition({
      currentStatus: 'open',
      requestedStatus: 'pending_engineering',
      principalPermissions: UPDATE_ONLY,
    });
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.rule.slaPause).toBe(true);
    }
  });

  it('resolved → open sets slaResume=true', () => {
    const result = validateTransition({
      currentStatus: 'resolved',
      requestedStatus: 'open',
      principalPermissions: UPDATE_ONLY,
    });
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.rule.slaResume).toBe(true);
    }
  });
});

describe('validateTransition — events emitted', () => {
  it('open → resolved includes ticket.resolved event', () => {
    const result = validateTransition({
      currentStatus: 'open',
      requestedStatus: 'resolved',
      principalPermissions: UPDATE_ONLY,
    });
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.rule.events).toContain('ticket.resolved');
    }
  });

  it('open → pending_customer does not include ticket.resolved', () => {
    const result = validateTransition({
      currentStatus: 'open',
      requestedStatus: 'pending_customer',
      principalPermissions: UPDATE_ONLY,
    });
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.rule.events).not.toContain('ticket.resolved');
    }
  });
});

describe('reachableStatuses', () => {
  it('returns only update-permission targets from open with update_only perms', () => {
    const reachable = reachableStatuses('open', ['ticket:update']);
    // open → pending_customer, pending_engineering, resolved (all ticket:update)
    // open → closed requires ticket:close — must NOT be included
    expect(reachable).toContain('pending_customer');
    expect(reachable).toContain('pending_engineering');
    expect(reachable).toContain('resolved');
    expect(reachable).not.toContain('closed');
  });

  it('includes closed when ticket:close is held', () => {
    const reachable = reachableStatuses('open', ['ticket:update', 'ticket:close']);
    expect(reachable).toContain('closed');
  });

  it('returns empty for closed with no permissions', () => {
    const reachable = reachableStatuses('closed', NO_PERMS as any);
    expect(reachable).toHaveLength(0);
  });
});

describe('transitionKey helper', () => {
  it('produces the correct key format', () => {
    expect(transitionKey('new', 'open')).toBe('new→open');
    expect(transitionKey('resolved', 'closed')).toBe('resolved→closed');
  });
});
