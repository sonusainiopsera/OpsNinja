import { describe, it, expect } from 'vitest';
import { decideAssignment, type AssignmentDecisionInput } from '../assignment.service.js';

const ACTOR_ID   = 'actor-uuid-0001';
const OTHER_ID   = 'other-uuid-0002';

function input(overrides: Partial<AssignmentDecisionInput> = {}): AssignmentDecisionInput {
  return {
    actorPermissions:  ['ticket:assign_self'],
    actorUserId:       ACTOR_ID,
    currentAssigneeId: null,
    targetAssigneeId:  ACTOR_ID,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// No permissions
// ---------------------------------------------------------------------------

describe('decideAssignment — no permissions', () => {
  it('denies when actor has neither permission', () => {
    const result = decideAssignment(input({ actorPermissions: [] }));
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('INSUFFICIENT_PERMISSION');
  });

  it('denies with only an unrelated permission', () => {
    const result = decideAssignment(input({ actorPermissions: ['ticket:read'] }));
    expect(result.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Self-assign
// ---------------------------------------------------------------------------

describe('decideAssignment — self-assign', () => {
  it('allows self-assign with assign_self permission', () => {
    const result = decideAssignment(input({
      actorPermissions: ['ticket:assign_self'],
      targetAssigneeId: ACTOR_ID,
    }));
    expect(result.allowed).toBe(true);
  });

  it('allows self-assign with reassign permission', () => {
    const result = decideAssignment(input({
      actorPermissions: ['ticket:reassign'],
      targetAssigneeId: ACTOR_ID,
    }));
    expect(result.allowed).toBe(true);
  });

  it('allows self-assign with both permissions', () => {
    const result = decideAssignment(input({
      actorPermissions: ['ticket:assign_self', 'ticket:reassign'],
      targetAssigneeId: ACTOR_ID,
    }));
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unassign
// ---------------------------------------------------------------------------

describe('decideAssignment — unassign', () => {
  it('allows unassign of self with assign_self when actor owns ticket', () => {
    const result = decideAssignment(input({
      actorPermissions:  ['ticket:assign_self'],
      currentAssigneeId: ACTOR_ID,
      targetAssigneeId:  null,
    }));
    expect(result.allowed).toBe(true);
  });

  it('denies unassign with assign_self when actor does not own ticket', () => {
    const result = decideAssignment(input({
      actorPermissions:  ['ticket:assign_self'],
      currentAssigneeId: OTHER_ID,
      targetAssigneeId:  null,
    }));
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('INSUFFICIENT_PERMISSION');
  });

  it('allows unassign of another agent with reassign permission', () => {
    const result = decideAssignment(input({
      actorPermissions:  ['ticket:reassign'],
      currentAssigneeId: OTHER_ID,
      targetAssigneeId:  null,
    }));
    expect(result.allowed).toBe(true);
  });

  it('allows unassign of unassigned ticket with reassign permission', () => {
    const result = decideAssignment(input({
      actorPermissions:  ['ticket:reassign'],
      currentAssigneeId: null,
      targetAssigneeId:  null,
    }));
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cross-agent reassignment
// ---------------------------------------------------------------------------

describe('decideAssignment — cross-agent reassignment', () => {
  it('denies reassignment to another agent with only assign_self', () => {
    const result = decideAssignment(input({
      actorPermissions: ['ticket:assign_self'],
      targetAssigneeId: OTHER_ID,
    }));
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('INSUFFICIENT_PERMISSION');
  });

  it('allows reassignment to another agent with reassign permission', () => {
    const result = decideAssignment(input({
      actorPermissions: ['ticket:reassign'],
      targetAssigneeId: OTHER_ID,
    }));
    expect(result.allowed).toBe(true);
  });

  it('allows reassignment from one agent to another with reassign', () => {
    const result = decideAssignment(input({
      actorPermissions:  ['ticket:reassign'],
      currentAssigneeId: 'previous-owner',
      targetAssigneeId:  OTHER_ID,
    }));
    expect(result.allowed).toBe(true);
  });

  it('denies agent reassigning another agent to a third party', () => {
    const result = decideAssignment(input({
      actorPermissions:  ['ticket:assign_self'],
      currentAssigneeId: OTHER_ID,
      targetAssigneeId:  'third-party-uuid',
    }));
    expect(result.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Manager role (all ticket permissions)
// ---------------------------------------------------------------------------

describe('decideAssignment — manager with all permissions', () => {
  const managerPerms = ['ticket:assign_self', 'ticket:reassign', 'ticket:update'];

  it('allows manager to self-assign', () => {
    expect(decideAssignment(input({ actorPermissions: managerPerms, targetAssigneeId: ACTOR_ID })).allowed).toBe(true);
  });

  it('allows manager to reassign to another agent', () => {
    expect(decideAssignment(input({ actorPermissions: managerPerms, targetAssigneeId: OTHER_ID })).allowed).toBe(true);
  });

  it('allows manager to unassign any ticket', () => {
    expect(decideAssignment(input({
      actorPermissions:  managerPerms,
      currentAssigneeId: OTHER_ID,
      targetAssigneeId:  null,
    })).allowed).toBe(true);
  });
});
