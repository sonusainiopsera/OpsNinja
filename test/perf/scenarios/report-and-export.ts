/**
 * report-and-export.ts — k6 load scenario for report queries and export requests.
 *
 * Covers two sub-scenarios (AC1):
 *   report_query   — GET /api/v1/reports (read-replica path, must not affect primary latency)
 *   export_request — POST /api/v1/reports/exports (async trigger; does not stream inline)
 *
 * Architecture notes:
 *   - Report queries hit the read replica, not the primary.
 *     Server-side trace headers (X-Hop-Attribution) indicate which DB was used.
 *   - Export is async: POST returns 202 with a job ID; the export worker streams to S3.
 *   - A separate stress test (export-memory-envelope.ts) validates the memory envelope.
 *   - Portal submission scenario shares this file's VU iteration structure for simplicity.
 *
 * Run:
 *   k6 run --env PROFILE=steady_state --env BASE_URL=https://api.staging.opsninja.io scenarios/report-and-export.ts
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';
import { Options } from 'k6/options';

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------
const reportQueryDuration    = new Trend('report_query_duration_ms',    true);
const exportTriggerDuration  = new Trend('export_trigger_duration_ms',  true);
const portalSubmitDuration   = new Trend('portal_submit_duration_ms',   true);
const scenarioErrors         = new Counter('report_export_errors_total');
const scenarioErrorRate      = new Rate('report_export_error_rate');
/** Hop attribution: tracks whether reports were served from replica (expected). */
const replicaHopCount        = new Counter('report_query_replica_hop_total');
const primaryHopCount        = new Counter('report_query_primary_hop_total');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const BASE_URL = __ENV['BASE_URL'] ?? 'http://localhost:3000';
const PROFILE  = (__ENV['PROFILE'] ?? 'steady_state') as 'steady_state' | 'peak';

export const SCENARIO_WEIGHT = 13; // report_query=10, export=3

const VU_COUNT   = { steady_state: 100, peak: 200 } as const;
const DURATION   = { steady_state: '10m', peak: '5m' } as const;
const THINK_TIME = { steady_state: 8, peak: 4 } as const;

export const options: Options = {
  scenarios: {
    report_and_export: {
      executor: 'constant-vus',
      vus: VU_COUNT[PROFILE],
      duration: DURATION[PROFILE],
    },
  },
  thresholds: {
    'report_query_duration_ms{quantile:"0.95"}':   ['p(95)<5000'],
    'export_trigger_duration_ms{quantile:"0.95"}': ['p(95)<2000'],
    'report_export_error_rate':                    ['rate<0.005'],
  },
};

// ---------------------------------------------------------------------------
// Committed query fixtures (date ranges that span multiple partitions)
// ---------------------------------------------------------------------------
const REPORT_QUERIES = [
  // Last 30 days — should hit 1–2 partitions
  { type: 'ticket_volume', from: 'now-30d', to: 'now', groupBy: 'day' },
  // Last 90 days — spans 3+ monthly partitions (tests partition pruning)
  { type: 'ticket_volume', from: 'now-90d', to: 'now', groupBy: 'week' },
  // 12-month trend (full partition scan — report replica stress)
  { type: 'ticket_volume', from: 'now-365d', to: 'now', groupBy: 'month' },
  // SLA compliance by priority
  { type: 'sla_compliance', from: 'now-30d', to: 'now', groupBy: 'priority' },
];

const EXPORT_PAYLOADS = [
  { type: 'tickets_csv',   from: 'now-30d',  to: 'now' },
  { type: 'tickets_csv',   from: 'now-90d',  to: 'now' },
  // At-row-cap boundary: requests a full-year export (will hit 500k cap)
  { type: 'tickets_csv',   from: 'now-365d', to: 'now', expectRowCap: true },
];

const PORTAL_SIGNUP_PAYLOADS = [
  { email: `load-test-${__VU ?? 1}@customer-${(__VU ?? 1) % 10}.example.com`, fullName: 'Load Test User' },
];

// ---------------------------------------------------------------------------
// Virtual user function
// ---------------------------------------------------------------------------
export default function reportAndExport(): void {
  const tenantSlug = 'tenant-perf-a';
  const isLead     = __VU % 5 === 0; // 20% are Support Leads running reports
  const email      = isLead
    ? `lead-${__VU % 5}@tenant-perf-a.perf.local`
    : `agent-narrow-${__VU % 20}@tenant-perf-a.perf.local`;

  const authRes = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ email, password: 'PerfTest!2024#Seed', tenantSlug }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  if (!check(authRes, { 'auth ok': (r) => r.status === 200 })) {
    scenarioErrors.add(1);
    scenarioErrorRate.add(true);
    return;
  }

  const { accessToken, tenantId } = authRes.json() as { accessToken: string; tenantId: string };
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type':  'application/json',
    'X-Tenant-Id':   tenantId,
  };

  const iterMod = __ITER % 10;

  if (iterMod < 7) {
    // ---------------------------------------------------------------------------
    // Report query (70% of iterations)
    // ---------------------------------------------------------------------------
    const query = REPORT_QUERIES[__ITER % REPORT_QUERIES.length];

    group('report query', () => {
      const res = http.get(
        `${BASE_URL}/api/v1/reports?type=${query.type}&from=${query.from}&to=${query.to}&groupBy=${query.groupBy}`,
        { headers, tags: { scenario: 'report_query', endpoint: 'GET /api/v1/reports' } },
      );

      const ok = check(res, {
        'report 200':       (r) => r.status === 200,
        'has data points':  (r) => Array.isArray((r.json() as Record<string, unknown>)?.['data']),
      });

      reportQueryDuration.add(res.timings.duration);
      scenarioErrorRate.add(!ok);
      if (!ok) scenarioErrors.add(1);

      // Track hop attribution for replica vs primary separation
      const hopHeader = res.headers['X-Hop-Attribution'] ?? res.headers['x-hop-attribution'];
      if (hopHeader === 'replica') {
        replicaHopCount.add(1);
      } else if (hopHeader === 'primary') {
        primaryHopCount.add(1);
      }
    });
  } else if (iterMod < 9) {
    // ---------------------------------------------------------------------------
    // Export trigger (20% of iterations)
    // ---------------------------------------------------------------------------
    const exportPayload = EXPORT_PAYLOADS[__ITER % EXPORT_PAYLOADS.length];

    group('export trigger', () => {
      const res = http.post(
        `${BASE_URL}/api/v1/reports/exports`,
        JSON.stringify(exportPayload),
        { headers, tags: { scenario: 'export_request', endpoint: 'POST /api/v1/reports/exports' } },
      );

      const ok = check(res, {
        'export accepted 202':  (r) => r.status === 202,
        'returns export job id': (r) => !!(r.json() as Record<string, unknown>)?.['exportJobId'],
      });

      exportTriggerDuration.add(res.timings.duration);
      scenarioErrorRate.add(!ok);
      if (!ok) scenarioErrors.add(1);
    });
  } else {
    // ---------------------------------------------------------------------------
    // Portal submission (10% of iterations — combined scenario for convenience)
    // ---------------------------------------------------------------------------
    const payload = PORTAL_SIGNUP_PAYLOADS[0];

    group('portal signup submit', () => {
      // Use unauthenticated path for portal signup
      const res = http.post(
        `${BASE_URL}/api/v1/portal/signup`,
        JSON.stringify({
          email:    `loadtest-${__VU}-${__ITER}@perf-customer.example.com`,
          fullName: payload.fullName,
        }),
        {
          headers: { 'Content-Type': 'application/json' },
          tags: { scenario: 'portal_submission', endpoint: 'POST /api/v1/portal/signup' },
        },
      );

      const ok = check(res, {
        'signup accepted':    (r) => r.status === 200 || r.status === 201,
        'no 5xx':             (r) => r.status < 500,
      });

      portalSubmitDuration.add(res.timings.duration);
      scenarioErrorRate.add(res.status >= 500);
      if (res.status >= 500) scenarioErrors.add(1);
    });
  }

  sleep(THINK_TIME[PROFILE]);
}
