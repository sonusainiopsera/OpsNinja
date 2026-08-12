/**
 * generate-report.ts — Build a PerformanceReport from k6 JSON summary output.
 *
 * k6 can export a machine-readable summary in JSON format when run with:
 *   k6 run --summary-export=results/k6-summary.json scenario.ts
 *
 * or with the full JSON output stream:
 *   k6 run --out json=results/k6-metrics.ndjson scenario.ts
 *
 * This script reads:
 *   1. One or more k6 --summary-export JSON files (one per scenario run).
 *   2. Optionally, stress-test JSON outputs (--json flag on each stress script).
 * And emits a single PerformanceReport JSON that:
 *   - Maps k6 trend metrics to per-endpoint p50/p95/p99/error_rate/throughput.
 *   - Evaluates every ThresholdEntry in thresholds.config.ts to produce verdicts.
 *   - Aggregates the overall pass/fail summary.
 *
 * Run:
 *   K6_SUMMARIES_DIR=./results/k6      \
 *   STRESS_RESULTS_DIR=./results/stress \
 *   GIT_REF=$(git rev-parse HEAD)       \
 *   PROFILE=steady_state                \
 *   ts-node test/perf/reporting/generate-report.ts
 *
 * Output: ./results/performance-report.json
 *
 * Metric name convention (matches k6 custom Trend names in each scenario):
 *   agent_queue_read_duration_ms       → scenario=agent_queue_read, endpoint=GET /api/v1/tickets
 *   ticket_create_agent_duration_ms    → scenario=ticket_create, endpoint=POST /api/v1/tickets
 *   ticket_create_portal_duration_ms   → scenario=ticket_create, endpoint=POST /api/v1/portal/tickets
 *   ticket_update_duration_ms          → scenario=ticket_update, endpoint=PATCH /api/v1/tickets/:id
 *   comment_add_duration_ms            → scenario=ticket_update, endpoint=POST /api/v1/tickets/:id/comments
 *   report_query_duration_ms           → scenario=report_query, endpoint=GET /api/v1/reports
 *   export_trigger_duration_ms         → scenario=export_request, endpoint=POST /api/v1/reports/exports
 *   portal_submit_duration_ms          → scenario=portal_submission, endpoint=POST /api/v1/portal/signup
 *   realtime_handshake_ms              → scenario=dashboard_realtime, endpoint=WSS /realtime
 *   realtime_delta_delivery_ms         → scenario=dashboard_realtime, endpoint=WS delta delivery
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type {
  PerformanceReport,
  EndpointResult,
  ThresholdVerdict,
  PerMetricResult,
  SavedViewCompilerResult,
  SchedulerContentionResult,
  OutboxDrainResult,
  ExportMemoryResult,
  RealtimeConnectionResult,
} from '../types';
import {
  THRESHOLDS,
} from '../thresholds.config';
import type { MetricName, ProfileName } from '../thresholds.config';
import { PERF_SEED, LARGE_FRACTION, EFFECTIVE_TICKET_COUNT } from '../dataset/seed-config';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const K6_SUMMARIES_DIR    = process.env['K6_SUMMARIES_DIR']    ?? './results/k6';
const STRESS_RESULTS_DIR  = process.env['STRESS_RESULTS_DIR']  ?? './results/stress';
const OUTPUT_PATH         = process.env['REPORT_OUTPUT']       ?? './results/performance-report.json';
const GIT_REF             = process.env['GIT_REF']             ?? 'unknown';
const PROFILE             = (process.env['PROFILE']            ?? 'steady_state') as ProfileName;
const TENANT_COUNT        = parseInt(process.env['TENANT_COUNT'] ?? '3', 10);

// ---------------------------------------------------------------------------
// k6 summary JSON types (shape produced by --summary-export)
// ---------------------------------------------------------------------------

interface K6TrendValues {
  /** Arithmetic mean. */
  avg: number;
  /** Minimum value. */
  min: number;
  /** Maximum value. */
  max: number;
  /** Median (p50). */
  med: number;
  /** Percentile values — keyed as "p(50)", "p(90)", "p(95)", "p(99)". */
  'p(50)': number;
  'p(90)': number;
  'p(95)': number;
  'p(99)': number;
}

interface K6CounterValues {
  count: number;
  rate: number;
}

interface K6RateValues {
  /** Fraction of passing checks (0–1). */
  passes: number;
  fails: number;
  /** Pass rate as fraction (0–1). */
  rate: number;
}

interface K6GaugeValues {
  value: number;
  min: number;
  max: number;
}

type K6MetricValues =
  | K6TrendValues
  | K6CounterValues
  | K6RateValues
  | K6GaugeValues;

interface K6MetricEntry {
  type: 'Trend' | 'Counter' | 'Rate' | 'Gauge';
  contains: string;
  values: K6MetricValues;
}

interface K6Summary {
  metrics: Record<string, K6MetricEntry>;
  root_group?: {
    name: string;
    groups: unknown[];
    checks: unknown[];
  };
}

// ---------------------------------------------------------------------------
// Metric-to-endpoint mapping
// k6 custom Trend metric name → (scenario, endpoint)
// ---------------------------------------------------------------------------

const METRIC_ENDPOINT_MAP: Record<string, { scenario: string; endpoint: string }> = {
  agent_queue_read_duration_ms:     { scenario: 'agent_queue_read',    endpoint: 'GET /api/v1/tickets' },
  ticket_create_agent_duration_ms:  { scenario: 'ticket_create',       endpoint: 'POST /api/v1/tickets' },
  ticket_create_portal_duration_ms: { scenario: 'ticket_create',       endpoint: 'POST /api/v1/portal/tickets' },
  ticket_update_duration_ms:        { scenario: 'ticket_update',       endpoint: 'PATCH /api/v1/tickets/:id' },
  comment_add_duration_ms:          { scenario: 'ticket_update',       endpoint: 'POST /api/v1/tickets/:id/comments' },
  report_query_duration_ms:         { scenario: 'report_query',        endpoint: 'GET /api/v1/reports' },
  export_trigger_duration_ms:       { scenario: 'export_request',      endpoint: 'POST /api/v1/reports/exports' },
  portal_submit_duration_ms:        { scenario: 'portal_submission',   endpoint: 'POST /api/v1/portal/signup' },
  realtime_handshake_ms:            { scenario: 'dashboard_realtime',  endpoint: 'WSS /realtime' },
  realtime_delta_delivery_ms:       { scenario: 'dashboard_realtime',  endpoint: 'WS delta delivery' },
};

/** Error-rate metric name for each scenario (Rate metric). */
const ERROR_RATE_METRIC_MAP: Record<string, string> = {
  agent_queue_read:   'agent_queue_read_error_rate',
  ticket_create:      'ticket_create_error_rate',
  ticket_update:      'ticket_create_error_rate', // shares same counter
  report_query:       'report_export_error_rate',
  export_request:     'report_export_error_rate',
  portal_submission:  'report_export_error_rate',
  dashboard_realtime: 'realtime_connection_error_rate',
};

/** Throughput counter name for each scenario. */
const THROUGHPUT_METRIC_MAP: Record<string, string> = {
  agent_queue_read:   'http_reqs',
  ticket_create:      'http_reqs',
  ticket_update:      'http_reqs',
  report_query:       'http_reqs',
  export_request:     'http_reqs',
  portal_submission:  'http_reqs',
  dashboard_realtime: 'realtime_connection_errors_total',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTrend(v: K6MetricValues): v is K6TrendValues {
  return 'p(95)' in v;
}

function isRate(v: K6MetricValues): v is K6RateValues {
  return 'rate' in v && !('count' in v) && !('value' in v);
}

function isCounter(v: K6MetricValues): v is K6CounterValues {
  return 'count' in v && 'rate' in v;
}

/**
 * Extract PerMetricResult for a given Trend metric from a merged k6 summary.
 */
function extractTrendMetrics(
  metrics: Record<string, K6MetricEntry>,
  metricName: string,
  errorRateMetricName: string,
  throughputMetricName: string,
): PerMetricResult {
  const trendEntry = metrics[metricName];
  const errorEntry = metrics[errorRateMetricName];
  const throughputEntry = metrics[throughputMetricName];

  const trend = trendEntry && isTrend(trendEntry.values) ? trendEntry.values : null;
  const error = errorEntry && isRate(errorEntry.values) ? errorEntry.values : null;
  const throughput = throughputEntry && isCounter(throughputEntry.values) ? throughputEntry.values : null;

  return {
    p50_ms:          trend?.['p(50)']   ?? 0,
    p95_ms:          trend?.['p(95)']   ?? 0,
    p99_ms:          trend?.['p(99)']   ?? 0,
    // Rate metric: rate is 0–1 (fraction), convert to percent (0–100)
    error_rate_pct:  error  ? error.rate * 100 : 0,
    throughput_rps:  throughput?.rate ?? 0,
    sample_count:    trendEntry && 'count' in (trendEntry.values as unknown as { count: number })
      ? (trendEntry.values as unknown as { count: number }).count
      : 0,
  };
}

/**
 * Merge multiple k6 summary JSON files into a single flat metrics map.
 * Later files override earlier ones for the same metric name.
 */
function mergeSummaries(dir: string): Record<string, K6MetricEntry> {
  const merged: Record<string, K6MetricEntry> = {};

  if (!fs.existsSync(dir)) {
    console.warn(`[generate-report] K6_SUMMARIES_DIR not found: ${dir} — using empty metrics`);
    return merged;
  }

  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(dir, f));

  for (const file of files) {
    try {
      const raw = fs.readFileSync(file, 'utf-8');
      const summary = JSON.parse(raw) as K6Summary;
      for (const [name, entry] of Object.entries(summary.metrics ?? {})) {
        merged[name] = entry;
      }
      console.log(`[generate-report] Loaded k6 summary: ${file} (${Object.keys(summary.metrics ?? {}).length} metrics)`);
    } catch (err) {
      console.warn(`[generate-report] Failed to parse ${file}:`, err);
    }
  }

  return merged;
}

/**
 * Load a stress-test JSON result file if it exists; otherwise return null.
 */
function loadStressResult<T>(dir: string, filename: string): T | null {
  const filePath = path.join(dir, filename);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Stub stress results (used when stress JSON files are absent)
// ---------------------------------------------------------------------------

function stubSchedulerContention(): SchedulerContentionResult {
  return {
    schedulerCount:      0,
    activeTimerCount:    0,
    duplicateClaims:     0,
    skippedTimers:       0,
    maxTickDurationMs:   0,
    tickDurationLimitMs: 15000,
    passed:              false,
  };
}

function stubOutboxDrain(): OutboxDrainResult {
  return {
    injectedEvents:             0,
    drainedEvents:              0,
    lostEvents:                 0,
    drainRateEventsPerSec:      0,
    minRequiredRateEventsPerSec: 120,
    orderingViolations:         0,
    endToEndLagP95Ms:           0,
    passed:                     false,
  };
}

function stubExportMemory(): ExportMemoryResult {
  return {
    rowCount:           0,
    peakMemoryMb:       0,
    memoryEnvelopeMb:   128,
    streamingConfirmed: false,
    rowCapEnforced:     false,
    timeoutEnforced:    false,
    errorActionable:    false,
    passed:             false,
  };
}

function stubRealtimeConnections(): RealtimeConnectionResult {
  return {
    targetConnections:            0,
    successfulConnections:        0,
    handshakeSuccessRatePct:      0,
    deltaLatencyP95Ms:            0,
    memoryPerConnectionKb:        0,
    memoryLimitPerConnectionKb:   40,
    gracefulRejectionOnOverload:  false,
    passed:                       false,
  };
}

// ---------------------------------------------------------------------------
// Core report builder (exported for unit tests)
// ---------------------------------------------------------------------------

export function buildEndpointResults(
  metrics: Record<string, K6MetricEntry>,
  profile: ProfileName,
): EndpointResult[] {
  const results: EndpointResult[] = [];

  for (const [metricName, mapping] of Object.entries(METRIC_ENDPOINT_MAP)) {
    if (!metrics[metricName]) continue;

    const errorMetricName     = ERROR_RATE_METRIC_MAP[mapping.scenario] ?? 'http_req_failed';
    const throughputMetricName = THROUGHPUT_METRIC_MAP[mapping.scenario] ?? 'http_reqs';

    const endpointMetrics = extractTrendMetrics(
      metrics,
      metricName,
      errorMetricName,
      throughputMetricName,
    );

    results.push({
      scenario: mapping.scenario,
      endpoint: mapping.endpoint,
      profile,
      metrics: endpointMetrics,
    });
  }

  return results;
}

export function buildVerdicts(
  endpointResults: EndpointResult[],
  profile: ProfileName,
): ThresholdVerdict[] {
  const verdicts: ThresholdVerdict[] = [];

  // Build a lookup: (scenario, endpoint) → PerMetricResult
  const resultMap = new Map<string, PerMetricResult>();
  for (const r of endpointResults) {
    resultMap.set(`${r.scenario}||${r.endpoint}`, r.metrics);
  }

  // Evaluate every threshold that applies to this profile
  const applicableThresholds = THRESHOLDS.filter(
    (t) => t.profile === profile || t.profile === 'both',
  );

  for (const threshold of applicableThresholds) {
    const key = `${threshold.scenario}||${threshold.endpoint}`;
    const metrics = resultMap.get(key);

    // No measurement for this (scenario, endpoint): emit a "not run" verdict
    const observed = metrics ? (metrics[threshold.metric as MetricName] as number) : 0;
    const measured = metrics !== undefined;

    const passed = measured
      ? threshold.metric === 'throughput_rps'
        // Throughput: higher is better — must EXCEED the minimum threshold
        ? observed >= threshold.limit
        // Latency / error: lower is better — must be BELOW the limit
        : observed <= threshold.limit
      : false;

    verdicts.push({
      scenario:  threshold.scenario,
      endpoint:  threshold.endpoint,
      metric:    threshold.metric,
      profile:   threshold.profile === 'both' ? profile : threshold.profile,
      limit:     threshold.limit,
      observed,
      passed,
      gating:    threshold.gating,
      note:      threshold.note,
    });
  }

  return verdicts;
}

export function buildSummary(verdicts: ThresholdVerdict[]): PerformanceReport['summary'] {
  let gatingPassed   = 0;
  let gatingFailed   = 0;
  let nonGatingPassed = 0;
  let nonGatingFailed = 0;

  for (const v of verdicts) {
    if (v.gating) {
      v.passed ? gatingPassed++ : gatingFailed++;
    } else {
      v.passed ? nonGatingPassed++ : nonGatingFailed++;
    }
  }

  return {
    totalThresholds:  verdicts.length,
    gatingPassed,
    gatingFailed,
    nonGatingPassed,
    nonGatingFailed,
    overallPassed:    gatingFailed === 0,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('[generate-report] Building performance report...');
  console.log(`[generate-report] Profile: ${PROFILE}`);
  console.log(`[generate-report] Git ref: ${GIT_REF}`);

  // 1. Merge all k6 summary files
  const mergedMetrics = mergeSummaries(K6_SUMMARIES_DIR);
  console.log(`[generate-report] Total k6 metrics loaded: ${Object.keys(mergedMetrics).length}`);

  // 2. Build endpoint results
  const endpointResults = buildEndpointResults(mergedMetrics, PROFILE as ProfileName);
  console.log(`[generate-report] Endpoint results built: ${endpointResults.length}`);

  // 3. Evaluate verdicts against thresholds
  const verdicts = buildVerdicts(endpointResults, PROFILE as ProfileName);
  console.log(`[generate-report] Verdicts evaluated: ${verdicts.length}`);

  // 4. Load stress test results (or use stubs if not yet run)
  const savedViewResults   = loadStressResult<SavedViewCompilerResult[]>(STRESS_RESULTS_DIR, 'filter-compiler.json') ?? [];
  const schedulerResult    = loadStressResult<SchedulerContentionResult>(STRESS_RESULTS_DIR, 'sla-scheduler.json') ?? stubSchedulerContention();
  const outboxResult       = loadStressResult<OutboxDrainResult>(STRESS_RESULTS_DIR, 'outbox-drain.json') ?? stubOutboxDrain();
  const exportResult       = loadStressResult<ExportMemoryResult>(STRESS_RESULTS_DIR, 'export-memory.json') ?? stubExportMemory();
  const realtimeResult     = loadStressResult<RealtimeConnectionResult>(STRESS_RESULTS_DIR, 'realtime-connections.json') ?? stubRealtimeConnections();

  // 5. Compute summary
  const summary = buildSummary(verdicts);

  // 6. Assemble the full report
  const report: PerformanceReport = {
    runId:       randomUUID(),
    generatedAt: new Date().toISOString(),
    gitRef:      GIT_REF,
    profile:     PROFILE as ProfileName,
    dataset: {
      seed:                   PERF_SEED,
      profile:                `large:${LARGE_FRACTION}`,
      tenantCount:            TENANT_COUNT,
      approximateTicketCount: EFFECTIVE_TICKET_COUNT,
    },
    endpointResults,
    verdicts,
    stressResults: {
      savedViewCompiler:    savedViewResults,
      schedulerContention:  schedulerResult,
      outboxDrain:          outboxResult,
      exportMemory:         exportResult,
      realtimeConnections:  realtimeResult,
    },
    summary,
  };

  // 7. Write output
  const outputPath = path.resolve(OUTPUT_PATH);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');

  // 8. Print summary to console
  console.log('\n[generate-report] Summary:');
  console.log(`  Gating passed   : ${summary.gatingPassed}`);
  console.log(`  Gating failed   : ${summary.gatingFailed}`);
  console.log(`  Non-gating pass : ${summary.nonGatingPassed}`);
  console.log(`  Non-gating fail : ${summary.nonGatingFailed}`);
  console.log(`  Overall         : ${summary.overallPassed ? 'PASS' : 'FAIL'}`);

  if (!summary.overallPassed) {
    console.error('\n[generate-report] GATING THRESHOLD BREACHES:');
    for (const v of verdicts.filter((x) => x.gating && !x.passed)) {
      console.error(
        `  [FAIL] ${v.scenario} | ${v.endpoint} | ${v.metric}` +
        `  observed=${v.observed} limit=${v.limit}`,
      );
    }
  }

  console.log(`\n[generate-report] Report written to: ${outputPath}`);

  if (!summary.overallPassed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[generate-report] Fatal:', err);
  process.exit(1);
});
