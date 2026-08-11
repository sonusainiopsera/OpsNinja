/**
 * compare-to-baseline.ts — Release-over-release regression detection.
 *
 * Loads the current run's performance report and compares every metric against
 * the stored baseline report.  Flags any metric that regressed beyond the
 * configured tolerance (REGRESSION_TOLERANCE_PCT from thresholds.config.ts).
 *
 * Regression definition:
 *   A metric regresses if current_value > baseline_value × (1 + tolerance/100).
 *   For error_rate metrics: any increase beyond tolerance is a regression.
 *   For throughput metrics: a decrease beyond tolerance is a regression.
 *
 * This script is designed to run as a CI step after the load suite completes.
 * It reads from BASELINE_PATH and CURRENT_PATH (env or CLI args), writes a
 * BaselineComparison JSON to COMPARISON_OUTPUT_PATH, and exits non-zero if
 * any regressions are detected.
 *
 * Run:
 *   BASELINE_PATH=./results/baseline.json \
 *   CURRENT_PATH=./results/current.json   \
 *   ts-node test/perf/reporting/compare-to-baseline.ts
 *
 * To validate it flags a known regression:
 *   INJECT_REGRESSION=true ts-node test/perf/reporting/compare-to-baseline.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import type { PerformanceReport, BaselineComparison, MetricRegression } from '../types';
import type { MetricName } from '../thresholds.config';
import { REGRESSION_TOLERANCE_PCT } from '../thresholds.config';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const BASELINE_PATH         = process.env['BASELINE_PATH']         ?? './results/baseline.json';
const CURRENT_PATH          = process.env['CURRENT_PATH']          ?? './results/current.json';
const COMPARISON_OUTPUT_PATH = process.env['COMPARISON_OUTPUT_PATH'] ?? './results/comparison.json';
const TOLERANCE_PCT         = parseFloat(process.env['TOLERANCE_PCT'] ?? String(REGRESSION_TOLERANCE_PCT));

/** When set, injects a synthetic p95 regression to verify the gate fires. */
const INJECT_REGRESSION     = process.env['INJECT_REGRESSION'] === 'true';

// ---------------------------------------------------------------------------
// Regression direction: higher is worse for latency/errors; lower is worse for throughput
// ---------------------------------------------------------------------------
const HIGHER_IS_WORSE: Record<MetricName, boolean> = {
  p50_ms:          true,
  p95_ms:          true,
  p99_ms:          true,
  error_rate_pct:  true,
  throughput_rps:  false, // lower throughput = regression
};

// ---------------------------------------------------------------------------
// Core comparison logic (exported for unit tests)
// ---------------------------------------------------------------------------

export interface MetricPoint {
  scenario:  string;
  endpoint:  string;
  metric:    MetricName;
  value:     number;
}

export function extractMetricPoints(report: PerformanceReport): MetricPoint[] {
  const points: MetricPoint[] = [];
  for (const ep of report.endpointResults) {
    const m = ep.metrics;
    const entries: Array<[MetricName, number]> = [
      ['p50_ms',         m.p50_ms],
      ['p95_ms',         m.p95_ms],
      ['p99_ms',         m.p99_ms],
      ['error_rate_pct', m.error_rate_pct],
      ['throughput_rps', m.throughput_rps],
    ];
    for (const [metric, value] of entries) {
      points.push({ scenario: ep.scenario, endpoint: ep.endpoint, metric, value });
    }
  }
  return points;
}

export function buildPointKey(p: MetricPoint): string {
  return `${p.scenario}||${p.endpoint}||${p.metric}`;
}

export function compareMetric(
  baseline:     MetricPoint,
  current:      MetricPoint,
  tolerancePct: number,
): 'regression' | 'improvement' | 'unchanged' {
  const higherIsWorse = HIGHER_IS_WORSE[baseline.metric];
  const baseVal = baseline.value;
  const curVal  = current.value;

  if (baseVal === 0) {
    // Can't compute a meaningful percentage from zero baseline
    return curVal > 0 ? 'regression' : 'unchanged';
  }

  const changePct = ((curVal - baseVal) / baseVal) * 100;

  if (higherIsWorse) {
    if (changePct > tolerancePct)   return 'regression';
    if (changePct < -tolerancePct)  return 'improvement';
  } else {
    // throughput: lower is worse
    if (changePct < -tolerancePct)  return 'regression';
    if (changePct > tolerancePct)   return 'improvement';
  }

  return 'unchanged';
}

export function compareReports(
  baseline:     PerformanceReport,
  current:      PerformanceReport,
  tolerancePct: number,
): Omit<BaselineComparison, 'comparedAt'> {
  const baselinePoints = extractMetricPoints(baseline);
  const currentPoints  = extractMetricPoints(current);

  const baselineMap = new Map<string, MetricPoint>();
  for (const p of baselinePoints) {
    baselineMap.set(buildPointKey(p), p);
  }

  const regressions:   MetricRegression[] = [];
  const improvements:  MetricRegression[] = [];
  let   unchangedCount = 0;

  for (const cp of currentPoints) {
    const key = buildPointKey(cp);
    const bp  = baselineMap.get(key);
    if (!bp) continue; // new metric, no baseline to compare

    const verdict = compareMetric(bp, cp, tolerancePct);
    const regressionPct = bp.value !== 0
      ? Math.round(((cp.value - bp.value) / bp.value) * 1000) / 10 // 1 decimal place
      : 0;

    const entry: MetricRegression = {
      scenario:       cp.scenario,
      endpoint:       cp.endpoint,
      metric:         cp.metric,
      baselineValue:  bp.value,
      currentValue:   cp.value,
      regressionPct,
      tolerancePct,
    };

    if (verdict === 'regression')   regressions.push(entry);
    else if (verdict === 'improvement') improvements.push(entry);
    else unchangedCount++;
  }

  return {
    baselineRunId:  baseline.runId,
    currentRunId:   current.runId,
    regressions,
    improvements,
    unchangedCount,
    overallPassed:  regressions.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Verdict computation (for threshold verdicts within a single report)
// ---------------------------------------------------------------------------
export function computeVerdicts(
  report: PerformanceReport,
): { gatingFailed: number; totalFailed: number; overallPassed: boolean } {
  let gatingFailed = 0;
  let totalFailed  = 0;

  for (const v of report.verdicts) {
    if (!v.passed) {
      totalFailed++;
      if (v.gating) gatingFailed++;
    }
  }

  return {
    gatingFailed,
    totalFailed,
    overallPassed: gatingFailed === 0,
  };
}

// ---------------------------------------------------------------------------
// Report loading / saving helpers
// ---------------------------------------------------------------------------

function loadReport(filePath: string): PerformanceReport {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Report file not found: ${abs}`);
  }
  const raw = fs.readFileSync(abs, 'utf-8');
  return JSON.parse(raw) as PerformanceReport;
}

function saveComparison(output: BaselineComparison, filePath: string): void {
  const abs = path.resolve(filePath);
  const dir = path.dirname(abs);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`[compare-to-baseline] Comparison written to: ${abs}`);
}

// ---------------------------------------------------------------------------
// Synthetic regression injection (used to prove the gate fires)
// ---------------------------------------------------------------------------
function injectSyntheticRegression(report: PerformanceReport): PerformanceReport {
  const mutated = JSON.parse(JSON.stringify(report)) as PerformanceReport;
  // Inflate the first p95_ms metric by 50% to guarantee a regression flag
  for (const ep of mutated.endpointResults) {
    if (ep.metrics.p95_ms > 0) {
      (ep.metrics as { p95_ms: number }).p95_ms = ep.metrics.p95_ms * 1.5;
      console.log(`[compare-to-baseline] Injected synthetic regression: ${ep.endpoint} p95 → ${ep.metrics.p95_ms}ms`);
      break;
    }
  }
  return mutated;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log('[compare-to-baseline] Loading reports...');

  const baseline = loadReport(BASELINE_PATH);
  let   current  = loadReport(CURRENT_PATH);

  if (INJECT_REGRESSION) {
    console.log('[compare-to-baseline] INJECT_REGRESSION=true — mutating current report for gate test');
    current = injectSyntheticRegression(current);
  }

  console.log(`[compare-to-baseline] Baseline run: ${baseline.runId} (${baseline.generatedAt})`);
  console.log(`[compare-to-baseline] Current  run: ${current.runId}  (${current.generatedAt})`);
  console.log(`[compare-to-baseline] Tolerance: ±${TOLERANCE_PCT}%`);

  const partial    = compareReports(baseline, current, TOLERANCE_PCT);
  const comparison: BaselineComparison = {
    ...partial,
    comparedAt: new Date().toISOString(),
  };

  // Print summary
  console.log('\n[compare-to-baseline] Results:');
  console.log(`  Regressions   : ${comparison.regressions.length}`);
  console.log(`  Improvements  : ${comparison.improvements.length}`);
  console.log(`  Unchanged     : ${comparison.unchangedCount}`);

  if (comparison.regressions.length > 0) {
    console.error('\n[compare-to-baseline] REGRESSIONS DETECTED:');
    for (const r of comparison.regressions) {
      const dir = HIGHER_IS_WORSE[r.metric] ? '+' : '-';
      console.error(
        `  [REGRESSION] ${r.scenario} | ${r.endpoint} | ${r.metric}` +
        `  baseline=${r.baselineValue} current=${r.currentValue} (${dir}${Math.abs(r.regressionPct)}% > ${r.tolerancePct}% tolerance)`,
      );
    }
  }

  if (comparison.improvements.length > 0) {
    console.log('\n[compare-to-baseline] Improvements:');
    for (const i of comparison.improvements) {
      console.log(`  [IMPROVED] ${i.scenario} | ${i.endpoint} | ${i.metric}  ${i.baselineValue} → ${i.currentValue}`);
    }
  }

  saveComparison(comparison, COMPARISON_OUTPUT_PATH);

  const verdict = comparison.overallPassed ? 'PASS' : 'FAIL — regressions detected';
  console.log(`\n[compare-to-baseline] Overall verdict: ${verdict}`);

  if (!comparison.overallPassed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[compare-to-baseline] Fatal:', err);
  process.exit(1);
});
