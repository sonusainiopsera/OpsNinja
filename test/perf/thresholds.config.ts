/**
 * Version-controlled performance threshold declarations for OpsNinja.
 *
 * All thresholds are declared as data here and referenced by both the k6
 * load scenarios and the baseline comparison step, so a threshold change
 * is always a reviewed diff — never adjusted ad hoc during a run.
 *
 * Profile semantics:
 *   steady_state — 500 concurrent agents + 1200 portal sessions at sustained rate
 *   peak         — 2× projected peak (1000 agents, 2400 portal sessions, 200 rps)
 *
 * gating=true  → a breach blocks staging→production promotion.
 * gating=false → the value is recorded for tracking; regressions flag in CI but
 *                do not block promotion today (treated as P2 improvements).
 */

export type MetricName =
  | 'p50_ms'
  | 'p95_ms'
  | 'p99_ms'
  | 'error_rate_pct'
  | 'throughput_rps';

export type ProfileName = 'steady_state' | 'peak' | 'both';

export interface ThresholdEntry {
  readonly scenario: string;
  readonly endpoint: string;
  readonly metric: MetricName;
  /** Numeric limit. Latency in milliseconds, error rate in percent (0–100). */
  readonly limit: number;
  readonly profile: ProfileName;
  /** If true, a breach blocks promotion. */
  readonly gating: boolean;
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// Scenario: agent queue read (dominant path — ~60% of read traffic)
// Architecture SLO: ticket-list p95 < 300ms (see architecture.md latency budget)
// ---------------------------------------------------------------------------
const AGENT_QUEUE: readonly ThresholdEntry[] = [
  { scenario: 'agent_queue_read', endpoint: 'GET /api/v1/tickets', metric: 'p95_ms',        limit: 300,  profile: 'both',         gating: true,  note: 'Architecture SLO: ticket-list p95 ≤ 300ms' },
  { scenario: 'agent_queue_read', endpoint: 'GET /api/v1/tickets', metric: 'p50_ms',        limit: 150,  profile: 'both',         gating: false },
  { scenario: 'agent_queue_read', endpoint: 'GET /api/v1/tickets', metric: 'p99_ms',        limit: 600,  profile: 'both',         gating: false, note: 'Recorded; not yet gating' },
  { scenario: 'agent_queue_read', endpoint: 'GET /api/v1/tickets', metric: 'error_rate_pct', limit: 0.1,  profile: 'both',         gating: true },
  { scenario: 'agent_queue_read', endpoint: 'GET /api/v1/tickets', metric: 'throughput_rps', limit: 80,   profile: 'steady_state', gating: false, note: 'Minimum sustained throughput' },
  { scenario: 'agent_queue_read', endpoint: 'GET /api/v1/tickets', metric: 'throughput_rps', limit: 160,  profile: 'peak',         gating: false },
];

// ---------------------------------------------------------------------------
// Scenario: ticket create (portal-origin ~60% of ticket volume + agent ~25%)
// ---------------------------------------------------------------------------
const TICKET_CREATE: readonly ThresholdEntry[] = [
  { scenario: 'ticket_create', endpoint: 'POST /api/v1/tickets',              metric: 'p95_ms',        limit: 500,  profile: 'both',         gating: false, note: 'Write path — RLS + outbox insert' },
  { scenario: 'ticket_create', endpoint: 'POST /api/v1/tickets',              metric: 'p99_ms',        limit: 1000, profile: 'both',         gating: false },
  { scenario: 'ticket_create', endpoint: 'POST /api/v1/tickets',              metric: 'error_rate_pct', limit: 0.1,  profile: 'both',         gating: true  },
  { scenario: 'ticket_create', endpoint: 'POST /api/v1/portal/tickets',       metric: 'p95_ms',        limit: 600,  profile: 'both',         gating: false },
  { scenario: 'ticket_create', endpoint: 'POST /api/v1/portal/tickets',       metric: 'error_rate_pct', limit: 0.1,  profile: 'both',         gating: true  },
  { scenario: 'ticket_update', endpoint: 'PATCH /api/v1/tickets/:id',         metric: 'p95_ms',        limit: 500,  profile: 'both',         gating: false },
  { scenario: 'ticket_update', endpoint: 'POST /api/v1/tickets/:id/comments', metric: 'p95_ms',        limit: 500,  profile: 'both',         gating: false },
  { scenario: 'ticket_update', endpoint: 'POST /api/v1/tickets/:id/comments', metric: 'error_rate_pct', limit: 0.1,  profile: 'both',         gating: true  },
];

// ---------------------------------------------------------------------------
// Scenario: dashboard realtime (WebSocket connections)
// Constraint: 500 concurrent agents inside gateway connection budget
// ---------------------------------------------------------------------------
const DASHBOARD_REALTIME: readonly ThresholdEntry[] = [
  { scenario: 'dashboard_realtime', endpoint: 'WSS /realtime',     metric: 'p95_ms',        limit: 200,  profile: 'steady_state', gating: false, note: 'Handshake + first frame latency' },
  { scenario: 'dashboard_realtime', endpoint: 'WSS /realtime',     metric: 'p99_ms',        limit: 500,  profile: 'steady_state', gating: false },
  { scenario: 'dashboard_realtime', endpoint: 'WSS /realtime',     metric: 'error_rate_pct', limit: 0.5,  profile: 'peak',         gating: true,  note: 'Graceful rejection expected at very high ramp; must not silent-drop' },
  { scenario: 'dashboard_realtime', endpoint: 'WS delta delivery', metric: 'p95_ms',        limit: 5500, profile: 'steady_state', gating: false, note: '5s tick + 500ms budget' },
];

// ---------------------------------------------------------------------------
// Scenario: portal submission
// ---------------------------------------------------------------------------
const PORTAL_SUBMISSION: readonly ThresholdEntry[] = [
  { scenario: 'portal_submission', endpoint: 'POST /api/v1/portal/signup',  metric: 'p95_ms',        limit: 800,  profile: 'both',  gating: false },
  { scenario: 'portal_submission', endpoint: 'POST /api/v1/portal/signup',  metric: 'error_rate_pct', limit: 0.1,  profile: 'both',  gating: true  },
];

// ---------------------------------------------------------------------------
// Scenario: report query and export
// Read replica path — separated from primary latency budgets
// ---------------------------------------------------------------------------
const REPORT_EXPORT: readonly ThresholdEntry[] = [
  { scenario: 'report_query',  endpoint: 'GET /api/v1/reports',          metric: 'p95_ms',        limit: 5000,  profile: 'steady_state', gating: false, note: 'Read replica; 30s hard timeout' },
  { scenario: 'report_query',  endpoint: 'GET /api/v1/reports',          metric: 'error_rate_pct', limit: 0.5,   profile: 'both',         gating: true  },
  { scenario: 'export_request', endpoint: 'POST /api/v1/reports/exports', metric: 'p95_ms',        limit: 2000,  profile: 'steady_state', gating: false, note: 'Trigger only; export is async' },
  { scenario: 'export_request', endpoint: 'POST /api/v1/reports/exports', metric: 'error_rate_pct', limit: 0.1,   profile: 'both',         gating: true  },
];

// ---------------------------------------------------------------------------
// All thresholds combined
// ---------------------------------------------------------------------------
export const THRESHOLDS: readonly ThresholdEntry[] = [
  ...AGENT_QUEUE,
  ...TICKET_CREATE,
  ...DASHBOARD_REALTIME,
  ...PORTAL_SUBMISSION,
  ...REPORT_EXPORT,
];

// ---------------------------------------------------------------------------
// Scenario traffic mix weights (documented assumption: 60% portal, 25% agent)
// These weights drive the k6 scenario executor configuration.
// ---------------------------------------------------------------------------
export interface ScenarioWeight {
  readonly scenario: string;
  /**
   * Weight relative to all scenarios in the same mix.
   * Normalised to a sum of 1.0 before use — declare as raw ratios.
   */
  readonly weight: number;
  readonly description: string;
}

export const SCENARIO_WEIGHTS: readonly ScenarioWeight[] = [
  { scenario: 'agent_queue_read',  weight: 35, description: 'Agent queue reads — dominant read path' },
  { scenario: 'ticket_create',     weight: 25, description: 'Portal-origin ticket creation (60% of tickets = ~60% of 25% writes)' },
  { scenario: 'ticket_update',     weight: 15, description: 'Ticket status updates and comment adds' },
  { scenario: 'portal_submission', weight: 10, description: 'Portal signup submissions' },
  { scenario: 'report_query',      weight: 10, description: 'Report builder queries (read replica)' },
  { scenario: 'export_request',    weight: 3,  description: 'Export trigger requests' },
  { scenario: 'dashboard_realtime', weight: 2, description: 'Realtime WebSocket connections (long-lived)' },
];

// ---------------------------------------------------------------------------
// Peak profile concurrency targets
// ---------------------------------------------------------------------------
export const CONCURRENCY = {
  steady_state: {
    agentVUs: 500,
    portalVUs: 1200,
    targetRps: 100,
  },
  peak: {
    agentVUs: 1000,
    portalVUs: 2400,
    targetRps: 200,
    note: 'Twice projected peak per AC4',
  },
} as const;

// ---------------------------------------------------------------------------
// Regression tolerance: max allowed percent degradation vs previous baseline
// ---------------------------------------------------------------------------
export const REGRESSION_TOLERANCE_PCT = 10;

// ---------------------------------------------------------------------------
// Helper: filter thresholds by scenario and profile
// ---------------------------------------------------------------------------
export function getThresholdsForScenario(
  scenario: string,
  profile: ProfileName,
): ThresholdEntry[] {
  return THRESHOLDS.filter(
    (t) =>
      t.scenario === scenario &&
      (t.profile === profile || t.profile === 'both'),
  );
}

// ---------------------------------------------------------------------------
// Helper: normalise scenario weights to sum = 1.0
// ---------------------------------------------------------------------------
export function normaliseWeights(
  weights: readonly ScenarioWeight[],
): Map<string, number> {
  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  const map = new Map<string, number>();
  for (const w of weights) {
    map.set(w.scenario, w.weight / total);
  }
  return map;
}
