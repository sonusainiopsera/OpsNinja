/**
 * agent-queue-read.ts — k6 load scenario for the agent ticket queue read path.
 *
 * This is the dominant traffic scenario (~35% of total weighted load).
 * It exercises the full authenticated read path including:
 *   - RS256 JWT auth guard
 *   - TenantContextInterceptor + SET LOCAL app.current_tenant
 *   - Saved-view filter compilation (from Redis cache after warm-up)
 *   - RLS-scoped ticket SELECT with org-scope predicate
 *
 * Traffic mix modelled (see SCENARIO_WEIGHTS in thresholds.config.ts):
 *   - 80% narrow-scope agents (1–5 orgs in scope)
 *   - 15% medium-scope agents (10–50 orgs)
 *   - 5%  wide-scope agent (all 200 orgs — worst-case predicate)
 *
 * Profiles:
 *   steady_state — 500 VUs, 10 min sustained
 *   peak         — 1000 VUs, 5 min (2× projected peak per AC4)
 *
 * Thresholds declared in thresholds.config.ts (p95 ≤ 300ms is architecture SLO).
 *
 * Run:
 *   k6 run --env PROFILE=steady_state --env BASE_URL=https://api.staging.opsninja.io scenarios/agent-queue-read.ts
 *   k6 run --env PROFILE=peak         --env BASE_URL=https://api.staging.opsninja.io scenarios/agent-queue-read.ts
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';
import { Options } from 'k6/options';

// ---------------------------------------------------------------------------
// Custom metrics (per-scenario; named so the reporting step can extract them)
// ---------------------------------------------------------------------------
const ticketListDuration = new Trend('agent_queue_read_duration_ms', true);
const ticketListErrors    = new Counter('agent_queue_read_errors_total');
const ticketListErrorRate = new Rate('agent_queue_read_error_rate');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const BASE_URL = __ENV['BASE_URL'] ?? 'http://localhost:3000';
const PROFILE  = (__ENV['PROFILE'] ?? 'steady_state') as 'steady_state' | 'peak';

/** Documented scenario weight: 35 / 100 of the full traffic mix. */
export const SCENARIO_WEIGHT = 35;

/** Think time between requests (simulates real agent behaviour). */
const THINK_TIME_S = {
  steady_state: 2,
  peak: 1,
} as const;

/** Concurrency targets matching CONCURRENCY constants in thresholds.config.ts. */
const VU_COUNT = {
  steady_state: 500,
  peak: 1000,
} as const;

const DURATION = {
  steady_state: '10m',
  peak: '5m',
} as const;

export const options: Options = {
  scenarios: {
    agent_queue_read_steady: {
      executor: 'constant-vus',
      vus: VU_COUNT[PROFILE],
      duration: DURATION[PROFILE],
    },
  },
  thresholds: {
    // Gating threshold — architecture SLO
    'agent_queue_read_duration_ms{quantile:"0.95"}': ['p(95)<300'],
    // Recorded, not yet gating
    'agent_queue_read_duration_ms{quantile:"0.99"}': ['p(99)<600'],
    'agent_queue_read_error_rate':                    ['rate<0.001'],  // 0.1%
  },
};

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------
interface AuthToken {
  accessToken: string;
  tenantId: string;
  userId: string;
}

function authenticate(email: string, password: string, tenantSlug: string): AuthToken {
  const res = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ email, password, tenantSlug }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (res.status !== 200) {
    throw new Error(`Auth failed for ${email}: HTTP ${res.status}`);
  }
  const body = res.json() as { accessToken: string; tenantId: string; userId: string };
  return body;
}

// ---------------------------------------------------------------------------
// Scenario fixture payloads (committed — same across runs for comparability)
// ---------------------------------------------------------------------------
const VIEW_FILTERS = [
  // No filter — bare queue
  null,
  // Status filter (simple)
  { type: 'condition', field: 'status', op: 'eq', value: 'open' },
  // Priority + status compound
  { type: 'group', op: 'and', children: [
    { type: 'condition', field: 'status',   op: 'eq',  value: 'open' },
    { type: 'condition', field: 'priority', op: 'in',  value: ['P1', 'P2'] },
  ]},
];

// ---------------------------------------------------------------------------
// Virtual user function
// ---------------------------------------------------------------------------
export default function agentQueueRead(): void {
  // Each VU authenticates once using a seeded user derived from VU index.
  // In k6, __VU is the virtual user index (1-based).
  const vuMod = __VU % 100;
  let email: string;
  let tenantSlug: string;

  if (vuMod < 80) {
    // Narrow-scope agent
    email      = `agent-narrow-${vuMod % 20}@tenant-perf-a.perf.local`;
    tenantSlug = 'tenant-perf-a';
  } else if (vuMod < 95) {
    // Medium-scope agent
    email      = `agent-medium-${vuMod % 5}@tenant-perf-a.perf.local`;
    tenantSlug = 'tenant-perf-a';
  } else {
    // Wide-scope agent — worst-case org predicate
    email      = 'agent-wide@tenant-perf-a.perf.local';
    tenantSlug = 'tenant-perf-a';
  }

  const password = 'PerfTest!2024#Seed';
  let token: AuthToken;

  try {
    token = authenticate(email, password, tenantSlug);
  } catch {
    ticketListErrors.add(1);
    ticketListErrorRate.add(true);
    return;
  }

  const headers = {
    'Authorization': `Bearer ${token.accessToken}`,
    'Content-Type':  'application/json',
    'X-Tenant-Id':   token.tenantId,
  };

  // Pick a filter from the committed fixture set based on VU index
  const filter = VIEW_FILTERS[__VU % VIEW_FILTERS.length];
  const filterParam = filter ? `&filter=${encodeURIComponent(JSON.stringify(filter))}` : '';

  group('ticket list read', () => {
    const res = http.get(
      `${BASE_URL}/api/v1/tickets?limit=25&sort=created_at:desc${filterParam}`,
      { headers, tags: { scenario: 'agent_queue_read', endpoint: 'GET /api/v1/tickets' } },
    );

    const ok = check(res, {
      'status is 200':                (r) => r.status === 200,
      'body has items array':         (r) => Array.isArray((r.json() as Record<string, unknown>)?.['items']),
      'no cross-tenant data':         (r) => {
        const body = r.json() as { items?: Array<{ tenantId?: string }> } | null;
        if (!body?.items?.length) return true;
        return body.items.every((t) => t.tenantId === token.tenantId);
      },
    });

    ticketListDuration.add(res.timings.duration);
    ticketListErrorRate.add(!ok);
    if (!ok) ticketListErrors.add(1);
  });

  sleep(THINK_TIME_S[PROFILE]);
}
