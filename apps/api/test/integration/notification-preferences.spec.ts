/**
 * Integration tests for Notification Preferences and Rule Resolver — WO-081.
 *
 * Uses NestJS TestingModule + supertest for the HTTP endpoint tests (AC-5)
 * and direct resolver instantiation for the rule-resolution behaviour tests
 * (AC-3, AC-9). No live database is required: services are mocked and the
 * tx handle is stubbed via jest.mock.
 *
 * Covers:
 *   AC-3  — ticket.comment_added with internal visibility → zero intents
 *   AC-5  — Portal GET/PUT and admin GET/PUT endpoints: 200, 400, 409, 404
 *   AC-9  — Rule resolver: status_changed → intents, public_comment → intents,
 *            internal note → zero intents, assignee_changed → intents
 */

import {
  Test,
  type TestingModule,
} from '@nestjs/testing';
import {
  INestApplication,
  HttpStatus,
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import * as request from 'supertest';
import { Observable, from, lastValueFrom } from 'rxjs';

import {
  PortalNotificationPreferencesController,
  AdminNotificationDefaultsController,
} from '../../src/modules/notifications/notification-preferences.controller';
import { NotificationPreferencesService } from '../../src/modules/notifications/notification-preferences.service';
import { AuditWriter } from '../../src/modules/audit/audit-writer';
import { PortalVisibilityGuard } from '../../src/modules/tickets/portal/portal-visibility.guard';
import { NotificationRuleResolver, type OutboxEvent } from '../../src/modules/notifications/notification-rule.resolver';
import {
  requestContextStore,
  type PrincipalContext,
  type RequestContext,
} from '../../src/observability/request-context';
import {
  TENANT_A,
  TENANT_B,
  ORG_A1,
  ORG_B1,
  CONTACT_A1,
  AGENT_1,
  TICKET_1,
  orgDefaultPreferences,
  contactA1Overrides,
  makeTicketStatusChangedEvent,
  makePublicCommentAddedEvent,
  makeInternalCommentAddedEvent,
  makeAssigneeChangedEvent,
} from '../fixtures/notification-preferences.fixtures';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADMIN_USER_ID = 'a1a1a1a1-0000-0000-0000-000000000001';
const ORG_A_OUT_OF_SCOPE = '99999999-0000-0000-0000-000000000099';

const PREF_VERSION_1 = 1;

// ---------------------------------------------------------------------------
// Principal builders
// ---------------------------------------------------------------------------

function makePortalPrincipal(): PrincipalContext {
  return {
    tenantId: TENANT_A,
    userId: CONTACT_A1,
    principalKind: 'portal',
    roles: ['portal_user'],
    orgScopeIds: [],
    boundOrganizationId: ORG_A1,
    traceId: 'test-trace-portal-001',
  };
}

function makeAdminPrincipal(orgScopeIds: string[] = []): PrincipalContext {
  return {
    tenantId: TENANT_A,
    userId: ADMIN_USER_ID,
    principalKind: 'staff',
    roles: ['admin'],
    orgScopeIds,
    traceId: 'test-trace-admin-001',
  };
}

// ---------------------------------------------------------------------------
// TestContextInterceptor — reads x-test-principal header and binds context
// ---------------------------------------------------------------------------

@Injectable()
class TestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string>;
      user?: PrincipalContext;
    }>();
    const principalHeader = req.headers['x-test-principal'];
    if (!principalHeader) return next.handle();

    const principal = JSON.parse(principalHeader) as PrincipalContext;
    req.user = principal;
    const ctx: RequestContext = {
      traceId: principal.traceId,
      principal,
      txHandle: {},
      startedAt: Date.now(),
    };
    return from(requestContextStore.run(ctx, () => lastValueFrom(next.handle())));
  }
}

// ---------------------------------------------------------------------------
// Mock preferences service
// ---------------------------------------------------------------------------

const CONTACT_PREFS_FIXTURE = {
  defaults: orgDefaultPreferences,
  overrides: contactA1Overrides,
  version: PREF_VERSION_1,
};

const ORG_DEFAULTS_FIXTURE = {
  defaults: orgDefaultPreferences,
  overrides: [],
  version: PREF_VERSION_1,
};

function makeMockPrefsService(overrides: Partial<Record<string, jest.Mock>> = {}): Partial<NotificationPreferencesService> {
  return {
    getContactPreferences: jest.fn().mockResolvedValue(CONTACT_PREFS_FIXTURE),
    upsertContactPreferences: jest.fn().mockResolvedValue({ ...CONTACT_PREFS_FIXTURE, version: 2 }),
    getOrganizationDefaults: jest.fn().mockResolvedValue(ORG_DEFAULTS_FIXTURE),
    upsertOrganizationDefaults: jest.fn().mockResolvedValue({ ...ORG_DEFAULTS_FIXTURE, version: 2 }),
    getEffectiveMode: jest.fn().mockResolvedValue('immediate' as const),
    shouldCoalesce: jest.fn().mockResolvedValue(false),
    ...overrides,
  };
}

const MOCK_AUDIT_WRITER = { write: jest.fn().mockResolvedValue(undefined) };

// ---------------------------------------------------------------------------
// App builders
// ---------------------------------------------------------------------------

async function buildPortalApp(
  serviceOverrides: Partial<Record<string, jest.Mock>> = {},
): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [PortalNotificationPreferencesController],
    providers: [
      { provide: NotificationPreferencesService, useValue: makeMockPrefsService(serviceOverrides) },
      { provide: AuditWriter, useValue: MOCK_AUDIT_WRITER },
      { provide: APP_INTERCEPTOR, useClass: TestContextInterceptor },
    ],
  })
    .overrideGuard(PortalVisibilityGuard)
    .useValue({ canActivate: jest.fn().mockReturnValue(true) })
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

async function buildAdminApp(
  serviceOverrides: Partial<Record<string, jest.Mock>> = {},
): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [AdminNotificationDefaultsController],
    providers: [
      { provide: NotificationPreferencesService, useValue: makeMockPrefsService(serviceOverrides) },
      { provide: AuditWriter, useValue: MOCK_AUDIT_WRITER },
      { provide: APP_INTERCEPTOR, useClass: TestContextInterceptor },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

function withPortal(app: INestApplication) {
  return request(app.getHttpServer()).set(
    'x-test-principal',
    JSON.stringify(makePortalPrincipal()),
  );
}

function withAdmin(app: INestApplication, orgScopeIds: string[] = []) {
  return request(app.getHttpServer()).set(
    'x-test-principal',
    JSON.stringify(makeAdminPrincipal(orgScopeIds)),
  );
}

// ============================================================================
// AC-5 — Portal preference endpoints
// ============================================================================

describe('GET /portal/me/notification-preferences', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('AC-5 — returns 200 with defaults, overrides, and version', async () => {
    app = await buildPortalApp();

    const res = await withPortal(app).get('/portal/me/notification-preferences');

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.defaults).toEqual(orgDefaultPreferences);
    expect(res.body.data.overrides).toEqual(contactA1Overrides);
    expect(res.body.data.version).toBe(PREF_VERSION_1);
  });

  it('AC-5 — no context (missing header) results in error (auth enforced by real AuthGuard)', async () => {
    app = await buildPortalApp();

    // Without x-test-principal, getPrincipalContext() throws TENANT_CONTEXT_MISSING.
    // In production this path is blocked by the global AuthGuard (401/403).
    const res = await request(app.getHttpServer()).get('/portal/me/notification-preferences');
    expect(res.status).not.toBe(HttpStatus.OK);
  });
});

describe('PUT /portal/me/notification-preferences', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('AC-5 — returns 200 with updated preferences on valid body', async () => {
    app = await buildPortalApp();

    const body = {
      overrides: [
        { eventType: 'ticket.status_changed', channel: 'email', mode: 'off' },
      ],
      version: PREF_VERSION_1,
    };

    const res = await withPortal(app).put('/portal/me/notification-preferences').send(body);

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.version).toBe(2);
  });

  it('AC-5 — returns 400 when unknown property present (z.strict)', async () => {
    app = await buildPortalApp();

    const body = {
      overrides: [],
      version: PREF_VERSION_1,
      unknownProp: 'should-fail',
    };

    const res = await withPortal(app).put('/portal/me/notification-preferences').send(body);

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC-5 — returns 400 when overrides contain unknown eventType', async () => {
    app = await buildPortalApp();

    const body = {
      overrides: [
        { eventType: 'ticket.nonexistent_event', channel: 'email', mode: 'off' },
      ],
      version: PREF_VERSION_1,
    };

    const res = await withPortal(app).put('/portal/me/notification-preferences').send(body);

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC-5 — returns 400 when overrides contain invalid mode', async () => {
    app = await buildPortalApp();

    const body = {
      overrides: [
        { eventType: 'ticket.status_changed', channel: 'email', mode: 'daily_digest' },
      ],
      version: PREF_VERSION_1,
    };

    const res = await withPortal(app).put('/portal/me/notification-preferences').send(body);

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC-5 — returns 409 on version mismatch (optimistic concurrency)', async () => {
    app = await buildPortalApp();

    const body = {
      overrides: [],
      version: 99, // wrong version — fixture returns version 1
    };

    const res = await withPortal(app).put('/portal/me/notification-preferences').send(body);

    expect(res.status).toBe(HttpStatus.CONFLICT);
    expect(res.body.error?.code).toBe('VERSION_CONFLICT');
    expect(res.body.error?.currentVersion).toBe(PREF_VERSION_1);
  });

  it('AC-5 — audit write is called on successful update', async () => {
    const mockAudit = { write: jest.fn().mockResolvedValue(undefined) };
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [PortalNotificationPreferencesController],
      providers: [
        { provide: NotificationPreferencesService, useValue: makeMockPrefsService() },
        { provide: AuditWriter, useValue: mockAudit },
        { provide: APP_INTERCEPTOR, useClass: TestContextInterceptor },
      ],
    })
      .overrideGuard(PortalVisibilityGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    const body = { overrides: [], version: PREF_VERSION_1 };
    await withPortal(app).put('/portal/me/notification-preferences').send(body);

    expect(mockAudit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'notification_preferences.updated',
        action: 'update',
      }),
    );
  });
});

// ============================================================================
// AC-5 — Admin notification defaults endpoints
// ============================================================================

describe('GET /organizations/:id/notification-defaults', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('AC-5 — returns 200 with org defaults for in-scope organization', async () => {
    app = await buildAdminApp();

    const res = await withAdmin(app).get(`/organizations/${ORG_A1}/notification-defaults`);

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.defaults).toEqual(orgDefaultPreferences);
    expect(res.body.data.version).toBe(PREF_VERSION_1);
  });

  it('AC-5 — returns 404 for out-of-scope organization (existence non-disclosure)', async () => {
    app = await buildAdminApp();

    // Admin with restricted org scope — ORG_A_OUT_OF_SCOPE not in scope list
    const res = await withAdmin(app, [ORG_A1])
      .get(`/organizations/${ORG_A_OUT_OF_SCOPE}/notification-defaults`);

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
    // Must NOT be 403 (existence disclosure prevention)
    expect(res.status).not.toBe(HttpStatus.FORBIDDEN);
  });

  it('AC-5 — admin with empty orgScopeIds (tenant-wide) can read any org', async () => {
    app = await buildAdminApp();

    // orgScopeIds: [] means unrestricted tenant-wide access
    const res = await withAdmin(app, []).get(`/organizations/${ORG_A1}/notification-defaults`);

    expect(res.status).toBe(HttpStatus.OK);
  });
});

describe('PUT /organizations/:id/notification-defaults', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('AC-5 — returns 200 with updated org defaults on valid body', async () => {
    app = await buildAdminApp();

    const body = {
      overrides: [
        { eventType: 'ticket.created', channel: 'email', mode: 'off' },
      ],
      version: PREF_VERSION_1,
    };

    const res = await withAdmin(app).put(`/organizations/${ORG_A1}/notification-defaults`).send(body);

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.data?.version).toBe(2);
  });

  it('AC-5 — returns 400 on unknown property in request body (z.strict)', async () => {
    app = await buildAdminApp();

    const body = {
      overrides: [],
      version: PREF_VERSION_1,
      injectedProp: 'bad',
    };

    const res = await withAdmin(app).put(`/organizations/${ORG_A1}/notification-defaults`).send(body);

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC-5 — returns 400 on unknown eventType in overrides', async () => {
    app = await buildAdminApp();

    const body = {
      overrides: [
        { eventType: 'sla.unknown_thing', channel: 'email', mode: 'immediate' },
      ],
      version: PREF_VERSION_1,
    };

    const res = await withAdmin(app).put(`/organizations/${ORG_A1}/notification-defaults`).send(body);

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC-5 — returns 409 on version mismatch (optimistic concurrency)', async () => {
    app = await buildAdminApp();

    const body = { overrides: [], version: 50 };

    const res = await withAdmin(app).put(`/organizations/${ORG_A1}/notification-defaults`).send(body);

    expect(res.status).toBe(HttpStatus.CONFLICT);
    expect(res.body.error?.code).toBe('VERSION_CONFLICT');
  });

  it('AC-5 — returns 404 for out-of-scope org on PUT (existence non-disclosure)', async () => {
    app = await buildAdminApp();

    const body = { overrides: [], version: PREF_VERSION_1 };
    const res = await withAdmin(app, [ORG_A1])
      .put(`/organizations/${ORG_A_OUT_OF_SCOPE}/notification-defaults`)
      .send(body);

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
  });
});

// ============================================================================
// AC-3, AC-9 — NotificationRuleResolver behaviour
// ============================================================================

// Mock getTxHandle so the resolver can run without a real database
jest.mock('../../src/data/tenant-repository', () => ({
  getTxHandle: jest.fn(),
  TenantContextMissingError: class TenantContextMissingError extends Error {},
  TenantRepository: class TenantRepository {},
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getTxHandle } = require('../../src/data/tenant-repository') as {
  getTxHandle: jest.Mock;
};

function makeResolverPrefsService(): NotificationPreferencesService {
  return {
    getEffectiveMode: jest.fn().mockResolvedValue('immediate' as const),
    shouldCoalesce: jest.fn().mockResolvedValue(false),
    getContactPreferences: jest.fn(),
    upsertContactPreferences: jest.fn(),
    getOrganizationDefaults: jest.fn(),
    upsertOrganizationDefaults: jest.fn(),
  } as unknown as NotificationPreferencesService;
}

const CONTACT_FIXTURE = {
  id: CONTACT_A1,
  email: 'alice@acme.com',
  organizationId: ORG_A1,
  status: 'active',
  portalAccessEnabled: true,
};

function mockTxForCustomerEvent(
  contactRows: Array<typeof CONTACT_FIXTURE>,
): void {
  let callCount = 0;
  getTxHandle.mockReturnValue({
    select: jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First call: ticket query → returns requester + orgId
        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                { requesterContactId: CONTACT_A1, organizationId: ORG_A1 },
              ]),
            }),
          }),
        };
      }
      // Second call: contacts query
      return {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(contactRows),
        }),
      };
    }),
  });
}

function mockTxEmpty(): void {
  getTxHandle.mockReturnValue({
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([]),
        }),
      }),
    }),
  });
}

describe('NotificationRuleResolver.resolve — integration behaviour', () => {
  let resolver: NotificationRuleResolver;
  let prefsService: NotificationPreferencesService;

  beforeEach(() => {
    jest.clearAllMocks();
    prefsService = makeResolverPrefsService();
    resolver = new NotificationRuleResolver(prefsService);
  });

  // ── AC-3: Internal comment → zero customer notifications ─────────────────

  it('AC-3 — ticket.comment_added with visibility=internal returns zero intents', async () => {
    const event = makeInternalCommentAddedEvent();
    mockTxEmpty();

    const result = await resolver.resolve(event);

    expect(result.intents).toHaveLength(0);
  });

  it('AC-3 — internal comment zero-intent is independent of recipient count (AC-3 guard fires first)', async () => {
    const event = makeInternalCommentAddedEvent();
    // Even with real contacts, guard fires before DB query
    mockTxForCustomerEvent([CONTACT_FIXTURE]);

    const result = await resolver.resolve(event);

    expect(result.intents).toHaveLength(0);
    // skipped array is also empty — the guard returns early before any recipient processing
    expect(result.skipped).toHaveLength(0);
  });

  // ── AC-9: Public comment → customer intents ───────────────────────────────

  it('AC-9 — ticket.comment_added with visibility=public produces customer intents', async () => {
    const event = makePublicCommentAddedEvent();
    mockTxForCustomerEvent([CONTACT_FIXTURE]);

    const result = await resolver.resolve(event);

    expect(result.intents.length).toBeGreaterThan(0);
    const intent = result.intents[0]!;
    expect(intent.templateKey).toBe('ticket_comment_added');
    expect(intent.recipientEmail).toBe('alice@acme.com');
    expect(intent.tenantId).toBe(TENANT_A);
    // Projected payload must not contain internal fields
    const payload = intent.projectedPayload as Record<string, unknown>;
    expect(payload['internalNoteBody']).toBeUndefined();
    expect(payload['agentOnlyMetadata']).toBeUndefined();
  });

  // ── AC-9: Status change → customer intents ────────────────────────────────

  it('AC-9 — ticket.status_changed produces customer intents', async () => {
    const event = makeTicketStatusChangedEvent();
    mockTxForCustomerEvent([CONTACT_FIXTURE]);

    const result = await resolver.resolve(event);

    expect(result.intents.length).toBeGreaterThan(0);
    const intent = result.intents[0]!;
    expect(intent.templateKey).toBe('ticket_status_changed');
    expect(intent.tenantId).toBe(TENANT_A);
    expect(intent.outboxEventId).toBe(event.eventId);
  });

  // ── AC-9: Assignee change → customer intents (coalescingEnabled) ──────────

  it('AC-9 — ticket.assignee_changed produces customer intents', async () => {
    const event = makeAssigneeChangedEvent();
    mockTxForCustomerEvent([CONTACT_FIXTURE]);

    const result = await resolver.resolve(event);

    expect(result.intents.length).toBeGreaterThan(0);
    expect(result.intents[0]!.templateKey).toBe('ticket_assignee_changed');
  });

  // ── AC-9: Coalescing suppresses second event within window ────────────────

  it('AC-9 — second assignee_changed within coalescing window is suppressed', async () => {
    (prefsService.shouldCoalesce as jest.Mock).mockResolvedValue(true);
    const event = makeAssigneeChangedEvent();
    mockTxForCustomerEvent([CONTACT_FIXTURE]);

    const result = await resolver.resolve(event);

    expect(result.intents).toHaveLength(0);
    expect(result.skipped.some((s) => s.reason === 'coalesced')).toBe(true);
  });

  // ── AC-9: Preference off suppresses delivery ──────────────────────────────

  it('AC-9 — preference mode=off suppresses delivery intent', async () => {
    (prefsService.getEffectiveMode as jest.Mock).mockResolvedValue('off');
    const event = makeTicketStatusChangedEvent();
    mockTxForCustomerEvent([CONTACT_FIXTURE]);

    const result = await resolver.resolve(event);

    expect(result.intents).toHaveLength(0);
    expect(result.skipped.some((s) => s.reason === 'preference_off')).toBe(true);
  });

  // ── AC-9: No recipients → empty intents (no throw) ───────────────────────

  it('AC-9 — no requester contact → empty intents without throwing', async () => {
    const event = makeTicketStatusChangedEvent();
    mockTxEmpty();

    const result = await resolver.resolve(event);

    expect(result.intents).toHaveLength(0);
    expect(() => result).not.toThrow();
  });

  // ── Idempotency key structure ─────────────────────────────────────────────

  it('AC-9 — dedupeKey is deterministic and composed of eventId + recipientEmail', async () => {
    const event = makePublicCommentAddedEvent();
    mockTxForCustomerEvent([CONTACT_FIXTURE]);

    const result = await resolver.resolve(event);

    expect(result.intents.length).toBeGreaterThan(0);
    const intent = result.intents[0]!;
    // dedupeKey must include the event id and the recipient email
    expect(intent.dedupeKey).toContain(event.eventId);
    expect(intent.dedupeKey).toContain(CONTACT_FIXTURE.email);
  });
});
