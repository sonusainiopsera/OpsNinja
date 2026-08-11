/**
 * Unit tests for NotificationPreferencesService (WO-081).
 *
 * Tests coalescing behaviour (SET NX pattern), cache read/write, and
 * preference precedence without a real Redis or DB.
 */

import { NotificationPreferencesService, COALESCE_WINDOW_SECONDS } from './notification-preferences.service';
import { NotificationPreferencesRepository } from './notification-preferences.repository';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = '00000000-0000-0000-0000-aaaaaaaaaaaa';
const CONTACT_ID = '00000000-0000-0000-0000-111111111111';
const ORG_ID = '00000000-0000-0000-0000-222222222222';
const TICKET_ID = '00000000-0000-0000-0000-333333333333';

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------

function makeMockRedis() {
  const store: Record<string, { value: string; expiresAt: number }> = {};

  return {
    async get(key: string): Promise<string | null> {
      const entry = store[key];
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        delete store[key];
        return null;
      }
      return entry.value;
    },
    async set(
      key: string,
      value: string,
      exMode?: string,
      ttl?: number,
      setMode?: string,
    ): Promise<string | null> {
      // SET NX: return null if key already exists
      if (setMode === 'NX' && store[key] && Date.now() <= store[key].expiresAt) {
        return null;
      }
      store[key] = { value, expiresAt: ttl ? Date.now() + ttl * 1000 : Infinity };
      return 'OK';
    },
    async setex(key: string, ttl: number, value: string): Promise<void> {
      store[key] = { value, expiresAt: Date.now() + ttl * 1000 };
    },
    async del(key: string): Promise<number> {
      if (store[key]) {
        delete store[key];
        return 1;
      }
      return 0;
    },
    _store: store,
  };
}

// ---------------------------------------------------------------------------
// Mock repository
// ---------------------------------------------------------------------------

function makeMockRepo(
  contactRows: Array<{ eventType: string; channel: string; mode: 'immediate' | 'off' }> = [],
  orgRows: Array<{ eventType: string; channel: string; mode: 'immediate' | 'off' }> = [],
): NotificationPreferencesRepository {
  return {
    findByContact: jest.fn().mockResolvedValue(
      contactRows.map((r) => ({ ...r, tenantId: TENANT_ID, contactId: CONTACT_ID, organizationId: ORG_ID, scope: 'contact', id: 'id1', updatedBy: 'user1', updatedAt: new Date() })),
    ),
    findByOrganization: jest.fn().mockResolvedValue(
      orgRows.map((r) => ({ ...r, tenantId: TENANT_ID, contactId: null, organizationId: ORG_ID, scope: 'organization', id: 'id2', updatedBy: 'user1', updatedAt: new Date() })),
    ),
    getEffectiveMode: jest.fn().mockResolvedValue('immediate' as const),
    upsert: jest.fn().mockImplementation(async (params) => params),
    deleteByContact: jest.fn().mockResolvedValue(undefined),
    deleteByOrganization: jest.fn().mockResolvedValue(undefined),
  } as unknown as NotificationPreferencesRepository;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotificationPreferencesService.shouldCoalesce', () => {
  let redis: ReturnType<typeof makeMockRedis>;
  let service: NotificationPreferencesService;

  beforeEach(() => {
    redis = makeMockRedis();
    service = new NotificationPreferencesService(redis as never, makeMockRepo());
  });

  it('returns false on first call (claims the dedup key)', async () => {
    const result = await service.shouldCoalesce(
      TENANT_ID, TICKET_ID, CONTACT_ID, 'ticket.status_changed',
    );
    expect(result).toBe(false);
  });

  it('returns true on second call within window (coalesced)', async () => {
    await service.shouldCoalesce(TENANT_ID, TICKET_ID, CONTACT_ID, 'ticket.status_changed');
    const result = await service.shouldCoalesce(
      TENANT_ID, TICKET_ID, CONTACT_ID, 'ticket.status_changed',
    );
    expect(result).toBe(true);
  });

  it('returns false for a different recipient (per-recipient dedup)', async () => {
    const OTHER_CONTACT = '00000000-0000-0000-0000-444444444444';
    await service.shouldCoalesce(TENANT_ID, TICKET_ID, CONTACT_ID, 'ticket.status_changed');
    const result = await service.shouldCoalesce(
      TENANT_ID, TICKET_ID, OTHER_CONTACT, 'ticket.status_changed',
    );
    expect(result).toBe(false);
  });

  it('returns false for a different event type', async () => {
    await service.shouldCoalesce(TENANT_ID, TICKET_ID, CONTACT_ID, 'ticket.status_changed');
    const result = await service.shouldCoalesce(
      TENANT_ID, TICKET_ID, CONTACT_ID, 'ticket.assignee_changed',
    );
    expect(result).toBe(false);
  });

  it('returns false for a different ticket', async () => {
    const OTHER_TICKET = '00000000-0000-0000-0000-555555555555';
    await service.shouldCoalesce(TENANT_ID, TICKET_ID, CONTACT_ID, 'ticket.status_changed');
    const result = await service.shouldCoalesce(
      TENANT_ID, OTHER_TICKET, CONTACT_ID, 'ticket.status_changed',
    );
    expect(result).toBe(false);
  });

  it('uses correct Redis key format', async () => {
    await service.shouldCoalesce(TENANT_ID, TICKET_ID, CONTACT_ID, 'ticket.status_changed');
    const expectedKey = `notif:coalesce:${TENANT_ID}:${TICKET_ID}:${CONTACT_ID}:ticket.status_changed`;
    expect(redis._store[expectedKey]).toBeDefined();
  });
});

describe('NotificationPreferencesService.getEffectiveMode', () => {
  it('returns contact-level mode when contact override exists', async () => {
    const redis = makeMockRedis();
    const repo = makeMockRepo(
      [{ eventType: 'ticket.status_changed', channel: 'email', mode: 'off' }], // contact override
      [{ eventType: 'ticket.status_changed', channel: 'email', mode: 'immediate' }], // org default
    );
    const service = new NotificationPreferencesService(redis as never, repo);

    const mode = await service.getEffectiveMode(
      TENANT_ID, CONTACT_ID, ORG_ID, 'ticket.status_changed', 'email',
    );
    expect(mode).toBe('off'); // contact 'off' beats org 'immediate'
  });

  it('falls back to org default when no contact override', async () => {
    const redis = makeMockRedis();
    const repo = makeMockRepo(
      [], // no contact overrides
      [{ eventType: 'ticket.status_changed', channel: 'email', mode: 'off' }],
    );
    // Set cache with org data but no contact overrides
    const service = new NotificationPreferencesService(redis as never, repo);

    // Prime the cache
    await service.getContactPreferences(TENANT_ID, CONTACT_ID, ORG_ID);

    const mode = await service.getEffectiveMode(
      TENANT_ID, CONTACT_ID, ORG_ID, 'ticket.status_changed', 'email',
    );
    expect(mode).toBe('off');
  });

  it('defaults to immediate when no preference row exists', async () => {
    const redis = makeMockRedis();
    const repo = makeMockRepo([], []); // no rows
    const service = new NotificationPreferencesService(redis as never, repo);

    // Prime the cache
    await service.getContactPreferences(TENANT_ID, CONTACT_ID, ORG_ID);

    const mode = await service.getEffectiveMode(
      TENANT_ID, CONTACT_ID, ORG_ID, 'ticket.status_changed', 'email',
    );
    expect(mode).toBe('immediate');
  });
});

describe('NotificationPreferencesService cache', () => {
  it('caches contact preferences and returns from cache on second call', async () => {
    const redis = makeMockRedis();
    const repo = makeMockRepo(
      [{ eventType: 'ticket.created', channel: 'email', mode: 'immediate' }],
      [],
    );
    const service = new NotificationPreferencesService(redis as never, repo);

    await service.getContactPreferences(TENANT_ID, CONTACT_ID, ORG_ID);
    await service.getContactPreferences(TENANT_ID, CONTACT_ID, ORG_ID);

    // Repository should only be called once (second call served from cache)
    expect(repo.findByContact).toHaveBeenCalledTimes(1);
  });

  it('invalidates cache on write', async () => {
    const redis = makeMockRedis();
    const repo = makeMockRepo();
    const service = new NotificationPreferencesService(redis as never, repo);

    await service.getContactPreferences(TENANT_ID, CONTACT_ID, ORG_ID);
    await service.upsertContactPreferences(TENANT_ID, CONTACT_ID, ORG_ID, [], 'actor');

    // After invalidation + fresh read, repo should be called again
    await service.getContactPreferences(TENANT_ID, CONTACT_ID, ORG_ID);
    expect(repo.findByContact).toHaveBeenCalledTimes(2);
  });
});
