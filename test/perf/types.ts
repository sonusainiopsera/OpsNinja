/**
 * Shared TypeScript types for the OpsNinja performance suite.
 *
 * These types describe the machine-readable output produced by the k6 scenarios
 * and consumed by the baseline comparison step and CI gating logic.
 */

import type { MetricName, ProfileName } from './thresholds.config';

// ---------------------------------------------------------------------------
// Per-metric measured values from a scenario run
// ---------------------------------------------------------------------------
export interface PerMetricResult {
  readonly p50_ms: number;
  readonly p95_ms: number;
  readonly p99_ms: number;
  /** Error percentage (0–100). */
  readonly error_rate_pct: number;
  /** Requests per second achieved. */
  readonly throughput_rps: number;
  readonly sample_count: number;
}

// ---------------------------------------------------------------------------
// Result for one (scenario, endpoint) pair
// ---------------------------------------------------------------------------
export interface EndpointResult {
  readonly scenario: string;
  readonly endpoint: string;
  readonly profile: ProfileName;
  readonly metrics: PerMetricResult;
}

// ---------------------------------------------------------------------------
// Verdict for a single threshold entry
// ---------------------------------------------------------------------------
export interface ThresholdVerdict {
  readonly scenario: string;
  readonly endpoint: string;
  readonly metric: MetricName;
  readonly profile: ProfileName;
  readonly limit: number;
  readonly observed: number;
  readonly passed: boolean;
  readonly gating: boolean;
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// Stress test result shapes
// ---------------------------------------------------------------------------

export interface SavedViewCompilerResult {
  readonly caseLabel: string;
  readonly predicateCount: number;
  readonly tagCardinality: number;
  readonly categoryDepth: number;
  readonly coldRunMs: number;
  readonly warmRunMs: number;
  readonly correctnessVerified: boolean;
  readonly coldBreachMs?: number;
  readonly warmBreachMs?: number;
}

export interface SchedulerContentionResult {
  readonly schedulerCount: number;
  readonly activeTimerCount: number;
  readonly duplicateClaims: number;
  readonly skippedTimers: number;
  readonly maxTickDurationMs: number;
  readonly tickDurationLimitMs: number;
  readonly passed: boolean;
}

export interface OutboxDrainResult {
  readonly injectedEvents: number;
  readonly drainedEvents: number;
  readonly lostEvents: number;
  readonly drainRateEventsPerSec: number;
  readonly minRequiredRateEventsPerSec: number;
  readonly orderingViolations: number;
  readonly endToEndLagP95Ms: number;
  readonly passed: boolean;
}

export interface ExportMemoryResult {
  readonly rowCount: number;
  readonly peakMemoryMb: number;
  readonly memoryEnvelopeMb: number;
  readonly streamingConfirmed: boolean;
  readonly rowCapEnforced: boolean;
  readonly timeoutEnforced: boolean;
  readonly errorActionable: boolean;
  readonly passed: boolean;
}

export interface RealtimeConnectionResult {
  readonly targetConnections: number;
  readonly successfulConnections: number;
  readonly handshakeSuccessRatePct: number;
  readonly deltaLatencyP95Ms: number;
  readonly memoryPerConnectionKb: number;
  readonly memoryLimitPerConnectionKb: number;
  readonly gracefulRejectionOnOverload: boolean;
  readonly passed: boolean;
}

// ---------------------------------------------------------------------------
// Full performance report — published as CI artifact
// ---------------------------------------------------------------------------
export interface PerformanceReport {
  readonly runId: string;
  readonly generatedAt: string;
  readonly gitRef: string;
  readonly profile: ProfileName;
  readonly dataset: {
    readonly seed: number;
    readonly profile: string;
    readonly tenantCount: number;
    readonly approximateTicketCount: number;
  };
  readonly endpointResults: readonly EndpointResult[];
  readonly verdicts: readonly ThresholdVerdict[];
  readonly stressResults: {
    readonly savedViewCompiler: readonly SavedViewCompilerResult[];
    readonly schedulerContention: SchedulerContentionResult;
    readonly outboxDrain: OutboxDrainResult;
    readonly exportMemory: ExportMemoryResult;
    readonly realtimeConnections: RealtimeConnectionResult;
  };
  readonly summary: {
    readonly totalThresholds: number;
    readonly gatingPassed: number;
    readonly gatingFailed: number;
    readonly nonGatingPassed: number;
    readonly nonGatingFailed: number;
    readonly overallPassed: boolean;
  };
}

// ---------------------------------------------------------------------------
// Baseline comparison output
// ---------------------------------------------------------------------------
export interface MetricRegression {
  readonly scenario: string;
  readonly endpoint: string;
  readonly metric: MetricName;
  readonly baselineValue: number;
  readonly currentValue: number;
  readonly regressionPct: number;
  readonly tolerancePct: number;
}

export interface BaselineComparison {
  readonly baselineRunId: string;
  readonly currentRunId: string;
  readonly comparedAt: string;
  readonly regressions: readonly MetricRegression[];
  readonly improvements: readonly MetricRegression[];
  readonly unchangedCount: number;
  readonly overallPassed: boolean;
}
