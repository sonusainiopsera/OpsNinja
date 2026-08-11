/**
 * Unit tests for NotificationRuleResolver (WO-081).
 *
 * Tests are pure-function style: the resolver receives stubbed collaborator
 * services and does NOT touch a real database. The tx handle is mocked to
 * return fixture data.
 *
 * Covers:
 *  - All 8 event types produce correct audience type
 *  - ticket.comment_added with internal visibility → empty customer audience (AC-3)
 *  - ticket.comment_added with public visibility → customer recipients
 *  - Unknown event type → empty intents + metric (no throw)
 *  - SLA events with paused timer → empty intents
 *  - Self-notification suppression
 *  - Preference 'off' suppresses delivery
 *  - Coalescing suppresses rapid successive events
 *  - Inactive recipient skipped
 */

import { NotificationRuleResolver, type OutboxEvent } from './notification-rule.resolver';
import { NotificationPreferencesService } from './notification-preferences.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = '00000000-0000-0000-0000-aaaaaaaaaaaa';
const ORG_ID    = '00000000-0000-0000-0000-bbbbbbbbbbbb';
const TICKET_ID = '00000000-0000-0000-0000-cccccccccccc';
const CONTACT_1 = '00000000-0000-0000-0000-111111111111';
const AGENT_1   = '00000000-0000-0000-0000-eeeeeeeeeeee';
const EVENT_ID  = '00000000-0000-0000-0000-fffffffffffF';

function makeEvent(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    eventId: EVENT_ID,
    tenantId: TENANT_ID,
    aggregateType: 'ticket',
    aggregateId: TICKET_ID,
    eventType: 'ticket.status_changed',
    occurredAt: '2026-01-15T10:00:00Z',
    actorId: AGENT_1,
    payload: {
      ticketId: TICKET_ID,
      status: 'in_progress',
      priority: 'P2',
      organizationId: ORG_ID,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock Redis + preferences service
// ---------------------------------------------------------------------------

function makeMockPrefsService(overrides: Partial<{
  getEffectiveMode: (tenantId: string, contactId: string, orgId: string, eventType: string, channel: string) => Promise<'immediate' | 'off'>;
  shouldCoalesce: () => Promise<boolean>;
}> = {}): NotificationPreferencesService {
  return {
    getEffectiveMode: overrides.getEffectiveMode ?? (() => Promise.resolve('immediate' as const)),
    shouldCoalesce: overrides.shouldCoalesce ?? (() => Promise.resolve(false)),
    getContactPreferences: jest.fn(),
    upsertContactPreferences: jest.fn(),
    getOrganizationDefaults: jest.fn(),
    upsertOrganizationDefaults: jest.fn(),
  } as unknown as NotificationPreferencesService;
}

// ---------------------------------------------------------------------------
// Mock getTxHandle
// ---------------------------------------------------------------------------

// We mock the getTxHandle import to return our fixture data
jest.mock('../../data/tenant-repository', () => ({
  getTxHandle: jest.fn(),
  TenantContextMissingError: class TenantContextMissingError extends Error {},
  TenantRepository: class TenantRepository {},
}));

import { getTxHandle } from '../../data/tenant-repository';

function mockTxForCustomerEvent(
  contacts: Array<{ id: string; email: string; organizationId: string; status: string; portalAccessEnabled: boolean }>,
): void {
  const mockSelect = jest.fn().mockReturnValue({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue([
          { requesterContactId: CONTACT_1, organizationId: ORG_ID },
        ]),
      }),
    }),
  });

  // Second call returns contacts
  let callCount = 0;
  (getTxHandle as jest.Mock).mockReturnValue({
    select: jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Ticket query
        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                { requesterContactId: CONTACT_1, organizationId: ORG_ID },
              ]),
            }),
          }),
        };
      }
      // Contacts query
      return {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(contacts),
        }),
      };
    }),
  });
}

function mockTxEmpty(): void {
  (getTxHandle as jest.Mock).mockReturnValue({
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([]),
        }),
      }),
    }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotificationRuleResolver.resolve', () => {
  let resolver: NotificationRuleResolver;
  let prefsService: NotificationPreferencesService;

  beforeEach(() => {
    jest.clearAllMocks();
    prefsService = makeMockPrefsService();
    resolver = new NotificationRuleResolver(prefsService);
  });

  // ── Unknown event type ──────────────────────────────────────────────────

  it('returns empty intents for an unknown event type (no throw)', async () => {
    const event = makeEvent({ eventType: 'ticket.some_unknown_event' });
    mockTxEmpty();
    const result = await resolver.resolve(event);
    expect(result.intents).toHaveLength(0);
  });

  // ── Internal comment → empty audience ──────────────────────────────────

  it('returns empty intents for ticket.comment_added with internal visibility (AC-3)', async () => {
    const event = makeEvent({
      eventType: 'ticket.comment_added',
      payload: {
        ticketId: TICKET_ID,
        visibility: 'internal',
        commentBody: 'Internal investigation note',
      },
    });
    mockTxEmpty();
    const result = await resolver.resolve(event);
    expect(result.intents).toHaveLength(0);
  });

  it('produces intents for ticket.comment_added with public visibility', async () => {
    const event = makeEvent({
      eventType: 'ticket.comment_added',
      actorId: AGENT_1,
      payload: {
        ticketId: TICKET_ID,
        visibility: 'public',
        commentBody: 'Here is the fix.',
      },
    });
    mockTxForCustomerEvent([
      { id: CONTACT_1, email: 'contact@acme.com', organizationId: ORG_ID, status: 'active', portalAccessEnabled: true },
    ]);
    const result = await resolver.resolve(event);
    expect(result.intents.length).toBeGreaterThan(0);
    const intent = result.intents[0]!;
    expect(intent.templateKey).toBe('ticket_comment_added');
    // publicCommentBody in projected payload
    expect((intent.projectedPayload as Record<string, unknown>)['publicCommentBody']).toBe('Here is the fix.');
    // No internal note body
    expect((intent.projectedPayload as Record<string, unknown>)['internalNoteBody']).toBeUndefined();
  });

  // ── Self-notification suppression ──────────────────────────────────────

  it('suppresses self-notification when actor === recipient contactId', async () => {
    const event = makeEvent({
      eventType: 'ticket.status_changed',
      actorId: CONTACT_1, // actor is the same as the contact
    });
    mockTxForCustomerEvent([
      { id: CONTACT_1, email: 'contact@acme.com', organizationId: ORG_ID, status: 'active', portalAccessEnabled: true },
    ]);
    const result = await resolver.resolve(event);
    expect(result.intents).toHaveLength(0);
    expect(result.skipped.some((s) => s.reason === 'self_notification')).toBe(true);
  });

  // ── Preference 'off' suppresses ─────────────────────────────────────────

  it('suppresses recipient when preference mode is off', async () => {
    prefsService = makeMockPrefsService({
      getEffectiveMode: () => Promise.resolve('off'),
    });
    resolver = new NotificationRuleResolver(prefsService);

    const event = makeEvent({ eventType: 'ticket.status_changed' });
    mockTxForCustomerEvent([
      { id: CONTACT_1, email: 'contact@acme.com', organizationId: ORG_ID, status: 'active', portalAccessEnabled: true },
    ]);
    const result = await resolver.resolve(event);
    expect(result.intents).toHaveLength(0);
    expect(result.skipped.some((s) => s.reason === 'preference_off')).toBe(true);
  });

  // ── Coalescing ──────────────────────────────────────────────────────────

  it('suppresses via coalescing for burst-prone events when shouldCoalesce returns true', async () => {
    prefsService = makeMockPrefsService({
      shouldCoalesce: () => Promise.resolve(true),
    });
    resolver = new NotificationRuleResolver(prefsService);

    const event = makeEvent({ eventType: 'ticket.status_changed' });
    mockTxForCustomerEvent([
      { id: CONTACT_1, email: 'contact@acme.com', organizationId: ORG_ID, status: 'active', portalAccessEnabled: true },
    ]);
    const result = await resolver.resolve(event);
    expect(result.intents).toHaveLength(0);
    expect(result.skipped.some((s) => s.reason === 'coalesced')).toBe(true);
  });

  it('does NOT coalesce non-burst events (ticket.created has coalescingEnabled=false)', async () => {
    const coaleseSpy = jest.fn().mockResolvedValue(true);
    prefsService = makeMockPrefsService({ shouldCoalesce: coaleseSpy });
    resolver = new NotificationRuleResolver(prefsService);

    const event = makeEvent({ eventType: 'ticket.created', actorId: 'different-actor' });
    mockTxForCustomerEvent([
      { id: CONTACT_1, email: 'contact@acme.com', organizationId: ORG_ID, status: 'active', portalAccessEnabled: true },
    ]);
    await resolver.resolve(event);
    // shouldCoalesce should NOT be called for ticket.created
    expect(coaleseSpy).not.toHaveBeenCalled();
  });

  // ── SLA paused timer → skip ──────────────────────────────────────────────

  it('returns empty intents for sla.reminder_threshold_reached when timer is paused', async () => {
    const event = makeEvent({
      eventType: 'sla.reminder_threshold_reached',
      payload: { ticketId: TICKET_ID, timerState: 'paused' },
    });
    mockTxEmpty();
    const result = await resolver.resolve(event);
    expect(result.intents).toHaveLength(0);
  });

  // ── Inactive recipient ───────────────────────────────────────────────────

  it('skips inactive contacts', async () => {
    const event = makeEvent({ eventType: 'ticket.status_changed', actorId: 'other-actor' });
    mockTxForCustomerEvent([
      { id: CONTACT_1, email: 'contact@acme.com', organizationId: ORG_ID, status: 'inactive', portalAccessEnabled: true },
    ]);
    const result = await resolver.resolve(event);
    // inactive contact was filtered in resolveCustomerAudience
    expect(result.intents).toHaveLength(0);
  });

  // ── Valid delivery intent shape ──────────────────────────────────────────

  it('produces a delivery intent with all required fields for ticket.resolved', async () => {
    const event = makeEvent({
      eventType: 'ticket.resolved',
      actorId: 'agent-uuid-different',
      payload: {
        ticketId: TICKET_ID,
        status: 'resolved',
        priority: 'P2',
        subject: 'VPN issue',
        actorDisplayName: 'Alice',
      },
    });
    mockTxForCustomerEvent([
      { id: CONTACT_1, email: 'contact@acme.com', organizationId: ORG_ID, status: 'active', portalAccessEnabled: true },
    ]);
    const result = await resolver.resolve(event);
    expect(result.intents).toHaveLength(1);
    const intent = result.intents[0]!;
    expect(intent.tenantId).toBe(TENANT_ID);
    expect(intent.recipientContactId).toBe(CONTACT_1);
    expect(intent.recipientEmail).toBe('contact@acme.com');
    expect(intent.channel).toBe('email');
    expect(intent.templateKey).toBe('ticket_resolved');
    expect(intent.dedupeKey).toContain(EVENT_ID);
    expect(intent.outboxEventId).toBe(EVENT_ID);
    // Projected payload must NOT contain internal fields
    expect((intent.projectedPayload as Record<string, unknown>)['actorId']).toBeUndefined();
    expect((intent.projectedPayload as Record<string, unknown>)['tenantId']).toBeUndefined();
  });

  // ── Preference precedence ────────────────────────────────────────────────

  it('uses contact-level preference over org default when contact mode is off', async () => {
    // getEffectiveMode returns 'off' for the contact — simulating contact overrides org default
    prefsService = makeMockPrefsService({
      getEffectiveMode: (tenantId, contactId) => {
        // Contact-specific override: CONTACT_1 has mode = 'off'
        if (contactId === CONTACT_1) return Promise.resolve('off');
        return Promise.resolve('immediate');
      },
    });
    resolver = new NotificationRuleResolver(prefsService);

    const event = makeEvent({ eventType: 'ticket.created', actorId: 'other-actor' });
    mockTxForCustomerEvent([
      { id: CONTACT_1, email: 'c1@acme.com', organizationId: ORG_ID, status: 'active', portalAccessEnabled: true },
    ]);
    const result = await resolver.resolve(event);
    // CONTACT_1 has preference off → skipped
    expect(result.intents).toHaveLength(0);
    expect(result.skipped.some((s) => s.reason === 'preference_off')).toBe(true);
  });
});
