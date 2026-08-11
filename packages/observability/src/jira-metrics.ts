/**
 * jira-metrics.ts — Centralised Jira SLI metric definitions (WO-059).
 *
 * All metric names, descriptions, units and bounded label keys for the Jira
 * integration are defined here as constants so every emitting component uses
 * the same strings. Drift between emitters and alerting rules is structurally
 * impossible when everything imports from this module.
 *
 * Label cardinality rules (enforced by documentation and code review):
 *   ALLOWED:  tenantId, connectionId, outcome, reason
 *   BANNED:   issueKey, userId, ticketId, linkId — high-cardinality; never labels
 *
 * Usage:
 *   import { JIRA_METRICS, buildJiraLabels } from '@opsninja/observability';
 *   meter.createHistogram(JIRA_METRICS.INBOUND_LAG_MS.name, {
 *     description: JIRA_METRICS.INBOUND_LAG_MS.description,
 *     unit:        JIRA_METRICS.INBOUND_LAG_MS.unit,
 *   }).record(lagMs, buildJiraLabels(tenantId, connectionId));
 */

// ---------------------------------------------------------------------------
// Metric descriptor type
// ---------------------------------------------------------------------------

export interface MetricDescriptor {
  /** Metric name — used as the OpenTelemetry instrument name. */
  name:        string;
  /** Human-readable description committed alongside the alert definition. */
  description: string;
  /** UCUM unit string. */
  unit:        string;
  /** Instrument type: histogram | counter | gauge. */
  kind:        'histogram' | 'counter' | 'gauge';
}

// ---------------------------------------------------------------------------
// Metric registry
// ---------------------------------------------------------------------------

export const JIRA_METRICS = {
  /** Histogram: milliseconds between webhook received_at and ticket mutation commit. */
  INBOUND_LAG_MS: {
    name:        'jira_inbound_lag_ms',
    description: 'Lag in milliseconds between Jira webhook receipt and OpsNinja ticket mutation commit',
    unit:        'ms',
    kind:        'histogram',
  } satisfies MetricDescriptor,

  /** Histogram: milliseconds between outbox created_at and Jira 2xx response. */
  OUTBOUND_LAG_MS: {
    name:        'jira_outbound_lag_ms',
    description: 'Lag in milliseconds between OpsNinja outbox event creation and Jira API 2xx response',
    unit:        'ms',
    kind:        'histogram',
  } satisfies MetricDescriptor,

  /** Counter: total Jira sync events processed, labelled by outcome and reason. */
  EVENTS_TOTAL: {
    name:        'jira_events_total',
    description: 'Total Jira sync events processed, labelled by direction (inbound|outbound), outcome and reason',
    unit:        '{event}',
    kind:        'counter',
  } satisfies MetricDescriptor,

  /** Gauge: current depth of the Jira sync DLQ (unresolved failed items). */
  DLQ_DEPTH: {
    name:        'jira_dlq_depth',
    description: 'Current depth of the Jira sync DLQ — count of unresolved failed link events',
    unit:        '{item}',
    kind:        'gauge',
  } satisfies MetricDescriptor,

  /** Counter: events rate-limited by the per-tenant Jira token bucket. */
  RATE_LIMITED_TOTAL: {
    name:        'jira_rate_limited_total',
    description: 'Total Jira API calls rejected by the per-tenant rate limiter',
    unit:        '{call}',
    kind:        'counter',
  } satisfies MetricDescriptor,

  /** Counter: inbound webhook signature verification failures. */
  SIGNATURE_FAILURES_TOTAL: {
    name:        'jira_signature_failures_total',
    description: 'Total Jira webhook requests rejected due to HMAC signature mismatch',
    unit:        '{request}',
    kind:        'counter',
  } satisfies MetricDescriptor,

  /** Counter: drift instances detected during reconciliation runs. */
  RECON_DRIFT_TOTAL: {
    name:        'jira_recon_drift_total',
    description: 'Total drift instances detected across all Jira reconciliation runs',
    unit:        '{issue}',
    kind:        'counter',
  } satisfies MetricDescriptor,

  /** Counter: OAuth token refresh failures (expired or revoked credentials). */
  TOKEN_REFRESH_FAILURES_TOTAL: {
    name:        'jira_token_refresh_failures_total',
    description: 'Total Jira OAuth access-token refresh failures',
    unit:        '{attempt}',
    kind:        'counter',
  } satisfies MetricDescriptor,
} as const;

// ---------------------------------------------------------------------------
// Label builder
// ---------------------------------------------------------------------------

export interface JiraMetricLabels {
  tenant_id:     string;
  connection_id: string;
  [key: string]: string;
}

/**
 * Build the bounded label set for a Jira metric observation.
 * Only tenant_id and connection_id are always present.
 * Additional string labels (e.g. outcome, reason, direction) may be appended.
 *
 * NEVER pass issueKey, userId, ticketId or linkId as labels — doing so would
 * cause time-series cardinality explosion.
 */
export function buildJiraLabels(
  tenantId:     string,
  connectionId: string,
  extras?: Record<string, string>,
): JiraMetricLabels {
  return {
    tenant_id:     tenantId,
    connection_id: connectionId,
    ...extras,
  };
}

// ---------------------------------------------------------------------------
// Lag helpers
// ---------------------------------------------------------------------------

/**
 * Compute inbound lag in milliseconds.
 * @param receivedAt  When the webhook was persisted to jira_webhook_events.
 * @param appliedAt   When the OpsNinja ticket mutation committed.
 */
export function computeInboundLag(receivedAt: Date, appliedAt: Date): number {
  return Math.max(0, appliedAt.getTime() - receivedAt.getTime());
}

/**
 * Compute outbound lag in milliseconds.
 * @param outboxCreatedAt  When the outbox_events row was inserted.
 * @param jiraRespondedAt  When the Jira API returned a 2xx response.
 */
export function computeOutboundLag(outboxCreatedAt: Date, jiraRespondedAt: Date): number {
  return Math.max(0, jiraRespondedAt.getTime() - outboxCreatedAt.getTime());
}
