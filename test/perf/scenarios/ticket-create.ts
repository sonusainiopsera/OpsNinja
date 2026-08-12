/**
 * ticket-create.ts — k6 load scenario for ticket creation and update paths.
 *
 * Covers two sub-scenarios weighted together (AC1):
 *   ticket_create  — POST /api/v1/tickets (agent-created, 25% of total mix)
 *                    POST /api/v1/portal/tickets (portal-origin, ~60% of ticket volume)
 *   ticket_update  — PATCH /api/v1/tickets/:id  + POST /api/v1/tickets/:id/comments
 *
 * Each VU authenticates as either an agent or a portal user so the full
 * auth path (RLS, tenant context, outbox insert) is on the measured path.
 *
 * Think time is set to model realistic submission cadence, not saturate writes.
 *
 * Run:
 *   k6 run --env PROFILE=steady_state --env BASE_URL=https://api.staging.opsninja.io scenarios/ticket-create.ts
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';
import { Options } from 'k6/options';

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------
const agentCreateDuration  = new Trend('ticket_create_agent_duration_ms',  true);
const portalCreateDuration = new Trend('ticket_create_portal_duration_ms', true);
const ticketUpdateDuration = new Trend('ticket_update_duration_ms',        true);
const commentAddDuration   = new Trend('comment_add_duration_ms',          true);
const createErrors         = new Counter('ticket_create_errors_total');
const createErrorRate      = new Rate('ticket_create_error_rate');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const BASE_URL = __ENV['BASE_URL'] ?? 'http://localhost:3000';
const PROFILE  = (__ENV['PROFILE'] ?? 'steady_state') as 'steady_state' | 'peak';

/** Documented scenario weight: ticket_create=25, ticket_update=15. */
export const SCENARIO_WEIGHT = 40;

const VU_COUNT   = { steady_state: 200, peak: 400 } as const;
const DURATION   = { steady_state: '10m', peak: '5m' } as const;
const THINK_TIME = { steady_state: 5, peak: 3 } as const;

export const options: Options = {
  scenarios: {
    ticket_write: {
      executor: 'constant-vus',
      vus: VU_COUNT[PROFILE],
      duration: DURATION[PROFILE],
    },
  },
  thresholds: {
    'ticket_create_agent_duration_ms{quantile:"0.95"}':  ['p(95)<500'],
    'ticket_create_portal_duration_ms{quantile:"0.95"}': ['p(95)<600'],
    'ticket_update_duration_ms{quantile:"0.95"}':        ['p(95)<500'],
    'ticket_create_error_rate':                          ['rate<0.001'],
  },
};

// ---------------------------------------------------------------------------
// Committed payload fixtures (same across runs for comparability)
// ---------------------------------------------------------------------------
const TICKET_PAYLOADS = [
  {
    title:      'Cannot access CI pipeline dashboard',
    body:       'Pipeline dashboard returns 502 since 09:00 UTC.',
    priority:   'P2',
    categoryId: '__CATEGORY_ID__',
  },
  {
    title:      'Kubernetes pod restart loop in prod',
    body:       'OOMKilled every 30 minutes. Logs attached.',
    priority:   'P1',
    categoryId: '__CATEGORY_ID__',
  },
  {
    title:      'Request: increase S3 bucket lifecycle to 90 days',
    body:       'Current policy deletes after 30 days which breaks our audit requirements.',
    priority:   'P3',
    categoryId: '__CATEGORY_ID__',
  },
];

const COMMENT_PAYLOADS = [
  { body: 'Investigating — will update in 30 minutes.',         visibility: 'internal' },
  { body: 'We have identified the root cause. Fix in progress.', visibility: 'public'   },
  { body: 'Fix deployed. Monitoring for 15 minutes.',           visibility: 'public'   },
];

// ---------------------------------------------------------------------------
// Virtual user function
// ---------------------------------------------------------------------------
export default function ticketWrite(): void {
  const vuMod = __VU % 10;
  const isPortal = vuMod < 6; // ~60% portal origin
  const tenantSlug = 'tenant-perf-a';

  // Authenticate
  const email    = isPortal
    ? `portal-user-${__VU % 50}@tenant-perf-a.perf.local`
    : `agent-narrow-${__VU % 20}@tenant-perf-a.perf.local`;
  const password = 'PerfTest!2024#Seed';

  const authRes = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ email, password, tenantSlug }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  if (authRes.status !== 200) {
    createErrors.add(1);
    createErrorRate.add(true);
    return;
  }

  const { accessToken, tenantId } = authRes.json() as { accessToken: string; tenantId: string };
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type':  'application/json',
    'X-Tenant-Id':   tenantId,
  };

  const payload = TICKET_PAYLOADS[__ITER % TICKET_PAYLOADS.length];

  if (isPortal) {
    // ---------------------------------------------------------------------------
    // Portal ticket creation
    // ---------------------------------------------------------------------------
    group('portal ticket create', () => {
      const res = http.post(
        `${BASE_URL}/api/v1/portal/tickets`,
        JSON.stringify(payload),
        { headers, tags: { scenario: 'ticket_create', endpoint: 'POST /api/v1/portal/tickets' } },
      );

      const ok = check(res, {
        'portal create 201':           (r) => r.status === 201,
        'returns ticket id':           (r) => !!(r.json() as Record<string, unknown>)?.['id'],
      });

      portalCreateDuration.add(res.timings.duration);
      createErrorRate.add(!ok);
      if (!ok) createErrors.add(1);
    });
  } else {
    // ---------------------------------------------------------------------------
    // Agent ticket creation + comment add
    // ---------------------------------------------------------------------------
    let ticketId: string | undefined;

    group('agent ticket create', () => {
      const res = http.post(
        `${BASE_URL}/api/v1/tickets`,
        JSON.stringify({ ...payload, organizationId: '__ORG_ID__' }),
        { headers, tags: { scenario: 'ticket_create', endpoint: 'POST /api/v1/tickets' } },
      );

      const ok = check(res, {
        'agent create 201': (r) => r.status === 201,
        'returns ticket id': (r) => !!(r.json() as Record<string, unknown>)?.['id'],
      });

      agentCreateDuration.add(res.timings.duration);
      createErrorRate.add(!ok);
      if (!ok) {
        createErrors.add(1);
        return;
      }

      ticketId = (res.json() as Record<string, unknown>)?.['id'] as string;
    });

    if (!ticketId) {
      sleep(THINK_TIME[PROFILE]);
      return;
    }

    sleep(1);

    group('ticket update status', () => {
      const res = http.patch(
        `${BASE_URL}/api/v1/tickets/${ticketId}`,
        JSON.stringify({ status: 'in_progress' }),
        { headers, tags: { scenario: 'ticket_update', endpoint: 'PATCH /api/v1/tickets/:id' } },
      );

      const ok = check(res, { 'update 200': (r) => r.status === 200 });
      ticketUpdateDuration.add(res.timings.duration);
      createErrorRate.add(!ok);
      if (!ok) createErrors.add(1);
    });

    sleep(1);

    group('add comment', () => {
      const comment = COMMENT_PAYLOADS[__ITER % COMMENT_PAYLOADS.length];
      const res = http.post(
        `${BASE_URL}/api/v1/tickets/${ticketId}/comments`,
        JSON.stringify(comment),
        { headers, tags: { scenario: 'ticket_update', endpoint: 'POST /api/v1/tickets/:id/comments' } },
      );

      const ok = check(res, { 'comment 201': (r) => r.status === 201 });
      commentAddDuration.add(res.timings.duration);
      createErrorRate.add(!ok);
      if (!ok) createErrors.add(1);
    });
  }

  sleep(THINK_TIME[PROFILE]);
}
