'use client';

/**
 * HealthStrip — four metric tiles fed by the aggregated health endpoint (WO-058).
 *
 * Tiles:
 *   1. Sync lag p95 (ms)
 *   2. Events processed in 24h
 *   3. DLQ depth
 *   4. Rate-limit budget remaining
 *
 * Polls at 15-second interval via useJiraHealth.
 * Shows stale badge when cachedAt is older than 30 seconds.
 */

import React from 'react';
import type { JiraHealthResponse } from '../../lib/api/jira/types';
import type { ApiError } from '../../lib/api/jira/hooks';
import { MetricTile, type MetricSeverity } from './MetricTile';

const STALE_THRESHOLD_MS = 30_000;

interface Props {
  health: JiraHealthResponse | undefined;
  isLoading: boolean;
  error: ApiError | null;
}

function isStale(cachedAt: string): boolean {
  return Date.now() - new Date(cachedAt).getTime() > STALE_THRESHOLD_MS;
}

function lagSeverity(lagMs: number | null): MetricSeverity {
  if (lagMs === null) return 'unknown';
  if (lagMs < 5_000) return 'ok';
  if (lagMs < 30_000) return 'warning';
  return 'critical';
}

function dlqSeverity(depth: number): MetricSeverity {
  if (depth === 0) return 'ok';
  if (depth < 10) return 'warning';
  return 'critical';
}

function budgetSeverity(remaining: number | null): MetricSeverity {
  if (remaining === null) return 'unknown';
  if (remaining > 50) return 'ok';
  if (remaining > 10) return 'warning';
  return 'critical';
}

export function HealthStrip({ health, isLoading, error }: Props) {
  const stale = health ? isStale(health.cachedAt) : false;
  const cachedAtLabel = health?.cachedAt;

  // When 503 / error but health is defined (stale payload), show stale tiles
  const showStale = stale || Boolean(health?.stale) || Boolean(error && health);

  return (
    <section aria-label="Jira sync health metrics">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-fg-primary, #111827)', margin: 0 }}>
          Sync Health
        </h2>
        {showStale && (
          <span
            role="status"
            aria-label={`Data may be stale — last cached at ${cachedAtLabel ?? 'unknown'}`}
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '2px 8px',
              background: '#fffbeb',
              color: '#d97706',
              border: '1px solid #d97706',
              borderRadius: 4,
              textTransform: 'uppercase',
            }}
          >
            Stale · {cachedAtLabel ? new Date(cachedAtLabel).toLocaleTimeString() : '—'}
          </span>
        )}
        {error && !health && (
          <span
            role="alert"
            style={{ fontSize: 12, color: '#dc2626' }}
          >
            Health data unavailable: {(error as ApiError).message}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <MetricTile
          label="Sync Lag p95"
          value={health?.sync.lagP95Ms !== undefined && health.sync.lagP95Ms !== null
            ? health.sync.lagP95Ms
            : null}
          unit="ms"
          severity={lagSeverity(health?.sync.lagP95Ms ?? null)}
          loading={isLoading && !health}
          stale={showStale}
          cachedAt={cachedAtLabel}
          description="95th-percentile lag between Jira event receipt and OpsNinja processing"
        />

        <MetricTile
          label="Events (24h)"
          value={health?.sync.events24h.processed ?? null}
          severity={health ? 'ok' : 'unknown'}
          loading={isLoading && !health}
          stale={showStale}
          cachedAt={cachedAtLabel}
          description="Jira webhook events successfully processed in the last 24 hours"
        />

        <MetricTile
          label="DLQ Depth"
          value={health?.sync.dlqDepth ?? null}
          severity={dlqSeverity(health?.sync.dlqDepth ?? 0)}
          loading={isLoading && !health}
          stale={showStale}
          cachedAt={cachedAtLabel}
          description="Number of failed events awaiting replay in the dead-letter queue"
        />

        <MetricTile
          label="Rate Budget"
          value={health?.sync.rateBudgetRemaining ?? null}
          unit="%"
          severity={budgetSeverity(health?.sync.rateBudgetRemaining ?? null)}
          loading={isLoading && !health}
          stale={showStale}
          cachedAt={cachedAtLabel}
          description="Remaining per-tenant Jira API rate-limit budget"
        />
      </div>
    </section>
  );
}
