/**
 * Unit tests for the payload projection module (WO-081).
 *
 * Snapshot tests ensure that any new ticket field added in the future
 * must be explicitly opted in to a projection before it can reach a customer.
 *
 * These snapshot tests serve as the "committed snapshot test" requirement
 * from the WO — failing the build if the projection shape changes.
 */

import {
  projectTicketPublic,
  projectTicketSla,
  projectCommentPublic,
  applyProjection,
} from './payload-projection';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const FULL_TICKET_PAYLOAD = {
  ticketId: 'ticket-001',
  reference: 'TKT-1001',
  subject: 'VPN connection failed',
  status: 'in_progress',
  priority: 'P2',
  categoryPath: 'Network > VPN',
  updatedAt: '2026-01-15T10:00:00Z',
  actorDisplayName: 'Alice Agent',
  // Internal fields that must NEVER appear in projections:
  actorId: 'agent-secret-id',
  assigneeId: 'agent-uuid',
  tenantId: 'tenant-uuid',
  internalNoteBody: 'Customer has outdated firmware — do not share',
  agentComments: ['internal note 1'],
};

const FULL_COMMENT_PAYLOAD = {
  ...FULL_TICKET_PAYLOAD,
  commentBody: 'We are looking into this issue.',
  visibility: 'public',
  internalNoteBody: 'INTERNAL: check Jira ticket XY-123',
};

const INTERNAL_COMMENT_PAYLOAD = {
  ...FULL_TICKET_PAYLOAD,
  commentBody: 'Internal investigation: firmware bug',
  visibility: 'internal',
};

const SLA_PAYLOAD = {
  ticketId: 'ticket-001',
  reference: 'TKT-1001',
  subject: 'VPN connection failed',
  priority: 'P1',
  slaType: 'resolution',
  threshold: 75,
  nextFireAt: '2026-01-15T12:00:00Z',
  breachedAt: null,
  // Internal fields:
  actorId: 'scheduler-id',
  tenantId: 'tenant-uuid',
};

// ---------------------------------------------------------------------------
// projectTicketPublic
// ---------------------------------------------------------------------------

describe('projectTicketPublic', () => {
  it('includes all allowed public fields', () => {
    const result = projectTicketPublic(FULL_TICKET_PAYLOAD);
    expect(result).toEqual({
      ticketId: 'ticket-001',
      reference: 'TKT-1001',
      subject: 'VPN connection failed',
      status: 'in_progress',
      priority: 'P2',
      categoryPath: 'Network > VPN',
      updatedAt: '2026-01-15T10:00:00Z',
      actorDisplayName: 'Alice Agent',
    });
  });

  it('excludes actorId (internal)', () => {
    const result = projectTicketPublic(FULL_TICKET_PAYLOAD);
    expect(result).not.toHaveProperty('actorId');
  });

  it('excludes assigneeId (internal)', () => {
    const result = projectTicketPublic(FULL_TICKET_PAYLOAD);
    expect(result).not.toHaveProperty('assigneeId');
  });

  it('excludes tenantId (internal)', () => {
    const result = projectTicketPublic(FULL_TICKET_PAYLOAD);
    expect(result).not.toHaveProperty('tenantId');
  });

  it('excludes internalNoteBody (internal)', () => {
    const result = projectTicketPublic(FULL_TICKET_PAYLOAD);
    expect(result).not.toHaveProperty('internalNoteBody');
  });

  it('returns null for missing optional fields', () => {
    const result = projectTicketPublic({ ticketId: 'ticket-001' });
    expect(result.reference).toBeNull();
    expect(result.subject).toBeNull();
    expect(result.status).toBeNull();
  });

  // Snapshot test — fails the build if the shape changes without approval
  it('matches snapshot (allow-list enforcement)', () => {
    const result = projectTicketPublic(FULL_TICKET_PAYLOAD);
    expect(Object.keys(result).sort()).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// projectCommentPublic
// ---------------------------------------------------------------------------

describe('projectCommentPublic', () => {
  it('includes publicCommentBody for public comments', () => {
    const result = projectCommentPublic(FULL_COMMENT_PAYLOAD);
    expect(result.publicCommentBody).toBe('We are looking into this issue.');
  });

  it('sets publicCommentBody to null for internal comments (visibility !== public)', () => {
    const result = projectCommentPublic(INTERNAL_COMMENT_PAYLOAD);
    expect(result.publicCommentBody).toBeNull();
  });

  it('excludes internalNoteBody regardless of visibility', () => {
    const result = projectCommentPublic(FULL_COMMENT_PAYLOAD);
    expect(result).not.toHaveProperty('internalNoteBody');
  });

  it('excludes actorId', () => {
    const result = projectCommentPublic(FULL_COMMENT_PAYLOAD);
    expect(result).not.toHaveProperty('actorId');
  });

  it('matches snapshot', () => {
    const result = projectCommentPublic(FULL_COMMENT_PAYLOAD);
    expect(Object.keys(result).sort()).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// projectTicketSla
// ---------------------------------------------------------------------------

describe('projectTicketSla', () => {
  it('includes SLA-specific fields', () => {
    const result = projectTicketSla(SLA_PAYLOAD);
    expect(result).toEqual({
      ticketId: 'ticket-001',
      reference: 'TKT-1001',
      subject: 'VPN connection failed',
      priority: 'P1',
      slaType: 'resolution',
      threshold: 75,
      nextFireAt: '2026-01-15T12:00:00Z',
      breachedAt: null,
    });
  });

  it('excludes actorId (internal)', () => {
    const result = projectTicketSla(SLA_PAYLOAD);
    expect(result).not.toHaveProperty('actorId');
  });

  it('excludes tenantId (internal)', () => {
    const result = projectTicketSla(SLA_PAYLOAD);
    expect(result).not.toHaveProperty('tenantId');
  });

  it('matches snapshot', () => {
    const result = projectTicketSla(SLA_PAYLOAD);
    expect(Object.keys(result).sort()).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// applyProjection router
// ---------------------------------------------------------------------------

describe('applyProjection', () => {
  it('routes ticket_public to projectTicketPublic', () => {
    const result = applyProjection('ticket_public', FULL_TICKET_PAYLOAD);
    expect(result).not.toHaveProperty('actorId');
    expect((result as Record<string, unknown>)['ticketId']).toBe('ticket-001');
  });

  it('routes ticket_sla to projectTicketSla', () => {
    const result = applyProjection('ticket_sla', SLA_PAYLOAD);
    expect((result as Record<string, unknown>)['slaType']).toBe('resolution');
    expect(result).not.toHaveProperty('actorId');
  });

  it('routes comment_public to projectCommentPublic', () => {
    const result = applyProjection('comment_public', FULL_COMMENT_PAYLOAD);
    expect((result as Record<string, unknown>)['publicCommentBody']).toBe(
      'We are looking into this issue.',
    );
  });

  it('comment_public with internal visibility returns null publicCommentBody', () => {
    const result = applyProjection('comment_public', INTERNAL_COMMENT_PAYLOAD);
    expect((result as Record<string, unknown>)['publicCommentBody']).toBeNull();
  });
});
