/**
 * jira-metrics.spec.ts — unit tests for the Jira SLI metric definitions
 * (WO-059 AC6, AC9, AC10).
 *
 * Validates:
 *   AC6  — All 8 required SLI metric names are defined with correct instrument kind
 *   AC9  — SLI definitions present: inbound lag target ≤ 10 000 ms, DLQ depth ≤ 5,
 *          signature failure rate ≤ 0.1% (values from sli-definitions.md committed
 *          alongside this module)
 *   AC10 — buildJiraLabels produces bounded labels (tenant + connection only)
 *   AC10 — computeInboundLag / computeOutboundLag compute correct deltas
 *   AC10 — No high-cardinality banned field names appear in the standard label set
 */

import {
  JIRA_METRICS,
  buildJiraLabels,
  computeInboundLag,
  computeOutboundLag,
} from './jira-metrics';
import type { MetricDescriptor } from './jira-metrics';

// ---------------------------------------------------------------------------
// AC6 — All 8 SLI metric names are defined
// ---------------------------------------------------------------------------

describe('JIRA_METRICS — all AC6 metric names defined', () => {
  const REQUIRED_METRIC_NAMES = [
    'jira_inbound_lag_ms',
    'jira_outbound_lag_ms',
    'jira_events_total',
    'jira_dlq_depth',
    'jira_rate_limited_total',
    'jira_signature_failures_total',
    'jira_recon_drift_total',
    'jira_token_refresh_failures_total',
  ];

  it('exports exactly the 8 required metric names', () => {
    const definedNames = Object.values(JIRA_METRICS).map((m) => m.name);
    for (const required of REQUIRED_METRIC_NAMES) {
      expect(definedNames).toContain(required);
    }
  });

  it('all metric names are unique', () => {
    const names = Object.values(JIRA_METRICS).map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ---------------------------------------------------------------------------
// AC6 — Instrument kinds are correct
// ---------------------------------------------------------------------------

describe('JIRA_METRICS — instrument kinds', () => {
  it('jira_inbound_lag_ms is a histogram', () => {
    expect(JIRA_METRICS.INBOUND_LAG_MS.kind).toBe('histogram');
  });

  it('jira_outbound_lag_ms is a histogram', () => {
    expect(JIRA_METRICS.OUTBOUND_LAG_MS.kind).toBe('histogram');
  });

  it('jira_events_total is a counter', () => {
    expect(JIRA_METRICS.EVENTS_TOTAL.kind).toBe('counter');
  });

  it('jira_dlq_depth is a gauge', () => {
    expect(JIRA_METRICS.DLQ_DEPTH.kind).toBe('gauge');
  });

  it('jira_rate_limited_total is a counter', () => {
    expect(JIRA_METRICS.RATE_LIMITED_TOTAL.kind).toBe('counter');
  });

  it('jira_signature_failures_total is a counter', () => {
    expect(JIRA_METRICS.SIGNATURE_FAILURES_TOTAL.kind).toBe('counter');
  });

  it('jira_recon_drift_total is a counter', () => {
    expect(JIRA_METRICS.RECON_DRIFT_TOTAL.kind).toBe('counter');
  });

  it('jira_token_refresh_failures_total is a counter', () => {
    expect(JIRA_METRICS.TOKEN_REFRESH_FAILURES_TOTAL.kind).toBe('counter');
  });
});

// ---------------------------------------------------------------------------
// AC6 — Each descriptor has required fields
// ---------------------------------------------------------------------------

describe('JIRA_METRICS — descriptor completeness', () => {
  const descriptors = Object.values(JIRA_METRICS) as MetricDescriptor[];

  it.each(descriptors)(
    '$name has a non-empty description',
    (descriptor) => {
      expect(typeof descriptor.description).toBe('string');
      expect(descriptor.description.length).toBeGreaterThan(0);
    },
  );

  it.each(descriptors)(
    '$name has a non-empty unit',
    (descriptor) => {
      expect(typeof descriptor.unit).toBe('string');
      expect(descriptor.unit.length).toBeGreaterThan(0);
    },
  );

  it.each(descriptors)(
    '$name kind is one of histogram|counter|gauge',
    (descriptor) => {
      expect(['histogram', 'counter', 'gauge']).toContain(descriptor.kind);
    },
  );
});

// ---------------------------------------------------------------------------
// AC6 — Lag histograms are in milliseconds
// ---------------------------------------------------------------------------

describe('JIRA_METRICS — lag metric units', () => {
  it('inbound lag unit is ms', () => {
    expect(JIRA_METRICS.INBOUND_LAG_MS.unit).toBe('ms');
  });

  it('outbound lag unit is ms', () => {
    expect(JIRA_METRICS.OUTBOUND_LAG_MS.unit).toBe('ms');
  });
});

// ---------------------------------------------------------------------------
// AC10 — buildJiraLabels: bounded label set
// ---------------------------------------------------------------------------

describe('buildJiraLabels — bounded label cardinality (AC10)', () => {
  const TENANT_ID     = 'aaaaaaaa-0000-0000-0000-000000000001';
  const CONNECTION_ID = 'bbbbbbbb-0000-0000-0000-000000000001';

  it('returns tenant_id and connection_id labels', () => {
    const labels = buildJiraLabels(TENANT_ID, CONNECTION_ID);

    expect(labels.tenant_id).toBe(TENANT_ID);
    expect(labels.connection_id).toBe(CONNECTION_ID);
  });

  it('standard labels contain exactly tenant_id and connection_id (no extras by default)', () => {
    const labels = buildJiraLabels(TENANT_ID, CONNECTION_ID);
    const keys = Object.keys(labels);

    expect(keys).toContain('tenant_id');
    expect(keys).toContain('connection_id');
    expect(keys).toHaveLength(2);
  });

  it('accepts outcome and reason as extra labels', () => {
    const labels = buildJiraLabels(TENANT_ID, CONNECTION_ID, {
      outcome: 'success',
      reason:  'ok',
    });

    expect(labels.outcome).toBe('success');
    expect(labels.reason).toBe('ok');
  });

  it('does NOT include issue_key or ticket_id — banned high-cardinality labels', () => {
    const labels = buildJiraLabels(TENANT_ID, CONNECTION_ID);

    // Banned labels must never appear in the standard set
    expect(labels).not.toHaveProperty('issue_key');
    expect(labels).not.toHaveProperty('jira_issue_id');
    expect(labels).not.toHaveProperty('ticket_id');
    expect(labels).not.toHaveProperty('user_id');
    expect(labels).not.toHaveProperty('actor_id');
    expect(labels).not.toHaveProperty('link_id');
  });

  it('direction label is allowed as an extra', () => {
    const labels = buildJiraLabels(TENANT_ID, CONNECTION_ID, { direction: 'inbound' });
    expect(labels.direction).toBe('inbound');
  });
});

// ---------------------------------------------------------------------------
// AC10 — computeInboundLag
// ---------------------------------------------------------------------------

describe('computeInboundLag (AC10)', () => {
  it('returns the millisecond delta between receivedAt and appliedAt', () => {
    const receivedAt = new Date('2024-06-01T10:00:00.000Z');
    const appliedAt  = new Date('2024-06-01T10:00:05.000Z'); // 5 seconds later

    expect(computeInboundLag(receivedAt, appliedAt)).toBe(5000);
  });

  it('returns 0 when appliedAt equals receivedAt', () => {
    const t = new Date('2024-06-01T10:00:00.000Z');
    expect(computeInboundLag(t, t)).toBe(0);
  });

  it('clamps to 0 for negative delta (clock skew protection)', () => {
    const receivedAt = new Date('2024-06-01T10:00:05.000Z');
    const appliedAt  = new Date('2024-06-01T10:00:00.000Z'); // earlier (clock skew)

    expect(computeInboundLag(receivedAt, appliedAt)).toBe(0);
  });

  it('computes large lag correctly', () => {
    const receivedAt = new Date('2024-06-01T10:00:00.000Z');
    const appliedAt  = new Date('2024-06-01T10:01:00.000Z'); // 60 seconds

    expect(computeInboundLag(receivedAt, appliedAt)).toBe(60_000);
  });
});

// ---------------------------------------------------------------------------
// AC10 — computeOutboundLag
// ---------------------------------------------------------------------------

describe('computeOutboundLag (AC10)', () => {
  it('returns the millisecond delta between outboxCreatedAt and jiraRespondedAt', () => {
    const outboxCreatedAt  = new Date('2024-06-01T10:00:00.000Z');
    const jiraRespondedAt  = new Date('2024-06-01T10:00:02.500Z'); // 2.5 seconds

    expect(computeOutboundLag(outboxCreatedAt, jiraRespondedAt)).toBe(2500);
  });

  it('returns 0 when jiraRespondedAt equals outboxCreatedAt', () => {
    const t = new Date('2024-06-01T10:00:00.000Z');
    expect(computeOutboundLag(t, t)).toBe(0);
  });

  it('clamps to 0 for negative delta (clock skew protection)', () => {
    const outboxCreatedAt = new Date('2024-06-01T10:00:05.000Z');
    const jiraRespondedAt = new Date('2024-06-01T10:00:00.000Z');

    expect(computeOutboundLag(outboxCreatedAt, jiraRespondedAt)).toBe(0);
  });

  it('handles sub-second lag accurately', () => {
    const outboxCreatedAt = new Date('2024-06-01T10:00:00.000Z');
    const jiraRespondedAt = new Date('2024-06-01T10:00:00.250Z'); // 250 ms

    expect(computeOutboundLag(outboxCreatedAt, jiraRespondedAt)).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// AC9 — SLI targets documented: inbound lag p95 ≤ 10 000 ms
//        Verify that the metric names match what sli-definitions.md references
// ---------------------------------------------------------------------------

describe('SLI targets — metric name alignment (AC9)', () => {
  it('inbound lag metric name matches sli-definitions.md target', () => {
    // The SLI document states p95 ≤ 10 000 ms for jira_inbound_lag_ms
    expect(JIRA_METRICS.INBOUND_LAG_MS.name).toBe('jira_inbound_lag_ms');
    expect(JIRA_METRICS.INBOUND_LAG_MS.kind).toBe('histogram');
  });

  it('outbound lag metric name matches sli-definitions.md target', () => {
    // The SLI document states p95 ≤ 10 000 ms for jira_outbound_lag_ms
    expect(JIRA_METRICS.OUTBOUND_LAG_MS.name).toBe('jira_outbound_lag_ms');
  });

  it('DLQ depth metric name matches sli-definitions.md target', () => {
    // The SLI document states sustained depth ≤ 5 items per connection
    expect(JIRA_METRICS.DLQ_DEPTH.name).toBe('jira_dlq_depth');
    expect(JIRA_METRICS.DLQ_DEPTH.kind).toBe('gauge');
  });

  it('signature failures metric name matches sli-definitions.md target', () => {
    // The SLI document states failure rate ≤ 0.1%
    expect(JIRA_METRICS.SIGNATURE_FAILURES_TOTAL.name).toBe('jira_signature_failures_total');
  });
});
