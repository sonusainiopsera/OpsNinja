/**
 * MSW handlers for SLA settings endpoints — WO-049.
 *
 * Back component tests and the Playwright journey without a backend dependency.
 * Import `slaHandlers` and spread into the server/worker handlers array.
 */

import { http, HttpResponse } from 'msw';
import type {
  SlaPolicy,
  SlaCalendar,
  SchedulerHealth,
} from '../../api/sla/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const MOCK_CALENDAR_BIZ: SlaCalendar = {
  id: 'cal-biz-001',
  name: 'Standard Business Hours',
  calendarType: 'business_hours',
  timezone: 'America/New_York',
};

export const MOCK_CALENDAR_247: SlaCalendar = {
  id: 'cal-247-001',
  name: '24×7 Always On',
  calendarType: 'twenty_four_seven',
  timezone: 'UTC',
};

export const MOCK_POLICY_DEFAULT: SlaPolicy = {
  id: 'pol-default-001',
  name: 'Default SLA Policy',
  scopeType: 'tenant',
  scopeId: null,
  calendarId: MOCK_CALENDAR_BIZ.id,
  calendarName: MOCK_CALENDAR_BIZ.name,
  appliedOrganizationCount: 12,
  targetsRatified: false,
  version: 1,
  targets: [
    { priority: 'P1', responseMinutes: 15, resolutionMinutes: 60 },
    { priority: 'P2', responseMinutes: 60, resolutionMinutes: 240 },
    { priority: 'P3', responseMinutes: 240, resolutionMinutes: 1440 },
    { priority: 'P4', responseMinutes: 480, resolutionMinutes: 2880 },
  ],
  pauseConditions: ['pending_customer_input'],
  firstReminderPct: 50,
  secondReminderPct: 75,
  onCallRoutingId: null,
  channelEmail: true,
  channelWebhook: false,
  channelPagerDuty: false,
};

export const MOCK_POLICY_ORG: SlaPolicy = {
  id: 'pol-org-002',
  name: 'Enterprise SLA',
  scopeType: 'organization',
  scopeId: 'org-acme-001',
  calendarId: MOCK_CALENDAR_247.id,
  calendarName: MOCK_CALENDAR_247.name,
  appliedOrganizationCount: 1,
  targetsRatified: true,
  version: 3,
  targets: [
    { priority: 'P1', responseMinutes: 5, resolutionMinutes: 30 },
    { priority: 'P2', responseMinutes: 30, resolutionMinutes: 120 },
    { priority: 'P3', responseMinutes: 120, resolutionMinutes: 480 },
    { priority: 'P4', responseMinutes: 240, resolutionMinutes: 1440 },
  ],
  pauseConditions: [],
  firstReminderPct: 60,
  secondReminderPct: 85,
  onCallRoutingId: null,
  channelEmail: true,
  channelWebhook: true,
  channelPagerDuty: false,
};

export const MOCK_SCHEDULER_HEALTHY: SchedulerHealth = {
  status: 'healthy',
  lagMs: 120,
  checkedAt: new Date().toISOString(),
};

// In-memory store for mutations (reset on each test via resetSlaHandlers)
let policies: SlaPolicy[] = [MOCK_POLICY_DEFAULT, MOCK_POLICY_ORG];

export function resetSlaHandlers() {
  policies = [MOCK_POLICY_DEFAULT, MOCK_POLICY_ORG];
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const slaHandlers = [
  // GET /api/v1/sla-policies
  http.get('/api/v1/sla-policies', () => {
    return HttpResponse.json({ data: policies });
  }),

  // GET /api/v1/sla-policies/scheduler-health
  http.get('/api/v1/sla-policies/scheduler-health', () => {
    return HttpResponse.json({ data: MOCK_SCHEDULER_HEALTHY });
  }),

  // GET /api/v1/sla-policies/:id
  http.get('/api/v1/sla-policies/:id', ({ params }) => {
    const policy = policies.find((p) => p.id === params['id']);
    if (!policy) {
      return HttpResponse.json(
        { error: { code: 'RESOURCE_NOT_FOUND', message: 'Policy not found', traceId: 'trace-404' } },
        { status: 404 },
      );
    }
    return HttpResponse.json({ data: policy });
  }),

  // POST /api/v1/sla-policies
  http.post('/api/v1/sla-policies', async ({ request }) => {
    const body = (await request.json()) as Partial<SlaPolicy>;
    const newPolicy: SlaPolicy = {
      id: `pol-${Date.now()}`,
      name: body.name ?? 'New Policy',
      scopeType: body.scopeType ?? 'tenant',
      scopeId: body.scopeId ?? null,
      calendarId: body.calendarId ?? null,
      calendarName: null,
      appliedOrganizationCount: 0,
      targetsRatified: false,
      version: 1,
      targets: body.targets ?? MOCK_POLICY_DEFAULT.targets,
      pauseConditions: body.pauseConditions ?? [],
      firstReminderPct: body.firstReminderPct ?? 50,
      secondReminderPct: body.secondReminderPct ?? 75,
      onCallRoutingId: null,
      channelEmail: body.channelEmail ?? true,
      channelWebhook: body.channelWebhook ?? false,
      channelPagerDuty: body.channelPagerDuty ?? false,
    };
    policies = [...policies, newPolicy];
    return HttpResponse.json({ data: newPolicy }, { status: 201 });
  }),

  // PUT /api/v1/sla-policies/:id
  http.put('/api/v1/sla-policies/:id', async ({ params, request }) => {
    const body = (await request.json()) as Partial<SlaPolicy> & { version?: number };
    const idx = policies.findIndex((p) => p.id === params['id']);
    if (idx === -1) {
      return HttpResponse.json(
        { error: { code: 'RESOURCE_NOT_FOUND', message: 'Policy not found', traceId: 'trace-404' } },
        { status: 404 },
      );
    }
    const existing = policies[idx]!;
    // Optimistic concurrency check
    if (body.version !== undefined && body.version !== existing.version) {
      return HttpResponse.json(
        { error: { code: 'VERSION_CONFLICT', message: 'This policy was updated by another user. Please reload.', traceId: 'trace-409' } },
        { status: 409 },
      );
    }
    const updated: SlaPolicy = { ...existing, ...body, version: existing.version + 1 };
    policies = policies.map((p, i) => (i === idx ? updated : p));
    return HttpResponse.json({ data: updated });
  }),

  // GET /api/v1/sla-calendars
  http.get('/api/v1/sla-calendars', () => {
    return HttpResponse.json({ data: [MOCK_CALENDAR_BIZ, MOCK_CALENDAR_247] });
  }),
];
