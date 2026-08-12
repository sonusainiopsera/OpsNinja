'use client';

/**
 * ReconciliationPanel — lists recent reconciliation runs with counts, duration
 * and outcome, and exposes a manual reconcile trigger with a lookback selector
 * that is disabled while a run is active (WO-058).
 *
 * Surfaces the audit entry id on trigger success (AC9).
 */

import React, { useState } from 'react';
import type { ReconciliationRun } from '../../lib/api/jira/types';
import {
  useReconciliationRuns,
  useTriggerReconciliation,
  type ApiError,
} from '../../lib/api/jira/hooks';

const LOOKBACK_OPTIONS = [
  { value: 1,  label: 'Last 1 hour' },
  { value: 6,  label: 'Last 6 hours' },
  { value: 24, label: 'Last 24 hours' },
  { value: 72, label: 'Last 3 days' },
];

const OUTCOME_STYLE: Record<string, { bg: string; fg: string; icon: string; label: string }> = {
  completed: { bg: '#f0fdf4', fg: '#16a34a', icon: '✓', label: 'Completed' },
  failed:    { bg: '#fef2f2', fg: '#dc2626', icon: '✗', label: 'Failed'    },
  running:   { bg: '#f0f9ff', fg: '#0284c7', icon: '⟳', label: 'Running'   },
  partial:   { bg: '#fffbeb', fg: '#d97706', icon: '⚠', label: 'Partial'   },
};

interface Props {
  connectionId: string | null;
  canWrite: boolean;
  stale?: boolean;
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return '—';
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export function ReconciliationPanel({ connectionId, canWrite, stale }: Props) {
  const [lookbackHours, setLookbackHours] = useState(24);
  const [lastAuditId, setLastAuditId] = useState<string | null>(null);

  const runsQuery = useReconciliationRuns(connectionId ?? undefined);
  const triggerMutation = useTriggerReconciliation();

  const runs: ReconciliationRun[] = runsQuery.data?.data ?? [];
  const isLoading = runsQuery.isLoading;
  const error = runsQuery.error as ApiError | null;

  const hasActiveRun = runs.some((r) => r.outcome === 'running');

  async function handleTrigger() {
    if (!connectionId) return;
    try {
      const res = await triggerMutation.mutateAsync({ connectionId, lookbackHours });
      setLastAuditId(res.auditId);
    } catch { /* error shown below */ }
  }

  const triggerError = triggerMutation.error as ApiError | null;

  return (
    <section aria-label="Jira reconciliation runs">
      {/* Stale badge */}
      {stale && (
        <span
          role="status"
          aria-label="Reconciliation data may be stale"
          style={{
            display: 'inline-block',
            marginBottom: 8,
            fontSize: 11,
            fontWeight: 700,
            padding: '2px 8px',
            background: '#fffbeb',
            color: '#d97706',
            border: '1px solid #d97706',
            borderRadius: 4,
          }}
        >
          STALE
        </span>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-fg-primary, #111827)', margin: 0 }}>
          Reconciliation Runs
        </h3>

        {canWrite && connectionId && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              aria-label="Reconciliation lookback window"
              value={lookbackHours}
              onChange={(e) => setLookbackHours(Number(e.target.value))}
              disabled={hasActiveRun || triggerMutation.isPending}
              style={{
                padding: '5px 10px',
                borderRadius: 5,
                border: '1px solid var(--color-border, #e5e7eb)',
                fontSize: 13,
                background: hasActiveRun ? '#f3f4f6' : '#fff',
                color: hasActiveRun ? '#9ca3af' : 'var(--color-fg-primary, #111827)',
                cursor: hasActiveRun ? 'not-allowed' : 'pointer',
              }}
            >
              {LOOKBACK_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => void handleTrigger()}
              disabled={hasActiveRun || triggerMutation.isPending || !connectionId}
              aria-label={hasActiveRun ? 'Reconciliation run is already in progress' : 'Trigger manual reconciliation'}
              aria-busy={triggerMutation.isPending}
              style={{
                padding: '5px 14px',
                borderRadius: 5,
                border: 'none',
                background: hasActiveRun || triggerMutation.isPending
                  ? '#f3f4f6'
                  : 'var(--color-primary, #4f46e5)',
                color: hasActiveRun || triggerMutation.isPending ? '#9ca3af' : '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: hasActiveRun || triggerMutation.isPending ? 'not-allowed' : 'pointer',
              }}
            >
              {triggerMutation.isPending ? 'Starting…' : 'Reconcile Now'}
            </button>
          </div>
        )}
      </div>

      {/* Active run indicator */}
      {hasActiveRun && (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginBottom: 12,
            padding: '8px 14px',
            background: '#f0f9ff',
            border: '1px solid #bae6fd',
            borderRadius: 6,
            fontSize: 13,
            color: '#0284c7',
            fontWeight: 500,
          }}
        >
          ⟳ A reconciliation run is currently in progress — trigger disabled.
        </div>
      )}

      {/* Trigger error */}
      {triggerError && (
        <div role="alert" style={{ marginBottom: 12, padding: '8px 12px', background: '#fef2f2', color: '#dc2626', borderRadius: 6, fontSize: 13 }}>
          Failed to trigger reconciliation: {triggerError.message}
        </div>
      )}

      {/* Audit confirmation */}
      {lastAuditId && !triggerError && (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginBottom: 12,
            padding: '8px 14px',
            background: '#f0fdf4',
            border: '1px solid #86efac',
            borderRadius: 6,
            fontSize: 13,
            color: '#16a34a',
          }}
        >
          ✓ Reconciliation triggered — audit ID: <code style={{ fontFamily: 'monospace', fontSize: 11 }}>{lastAuditId}</code>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <p aria-live="polite" style={{ color: 'var(--color-fg-muted, #6b7280)', fontSize: 13 }}>
          Loading runs…
        </p>
      )}

      {/* Error */}
      {error && !isLoading && (
        <div role="alert" style={{ padding: '8px 12px', background: '#fef2f2', color: '#dc2626', borderRadius: 6, fontSize: 13 }}>
          Failed to load reconciliation runs: {error.message}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && runs.length === 0 && (
        <div
          aria-label="No reconciliation runs yet"
          style={{
            padding: '28px',
            textAlign: 'center',
            color: 'var(--color-fg-muted, #6b7280)',
            fontSize: 13,
            border: '1px dashed var(--color-border, #e5e7eb)',
            borderRadius: 8,
          }}
        >
          No reconciliation runs recorded
        </div>
      )}

      {/* Runs list */}
      {runs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {runs.map((run) => {
            const outcomeStyle = OUTCOME_STYLE[run.outcome] ?? OUTCOME_STYLE.partial;
            const duration = formatDuration(run.startedAt, run.completedAt);
            return (
              <div
                key={run.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto auto auto',
                  gap: '0 16px',
                  alignItems: 'center',
                  padding: '10px 14px',
                  borderRadius: 6,
                  border: '1px solid var(--color-border, #e5e7eb)',
                  background: 'var(--color-bg-card, #fff)',
                }}
              >
                {/* Outcome chip */}
                <span
                  role="status"
                  aria-label={`Run outcome: ${outcomeStyle.label}`}
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 10,
                    background: outcomeStyle.bg,
                    color: outcomeStyle.fg,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {outcomeStyle.icon} {outcomeStyle.label}
                </span>

                {/* Counts */}
                <div style={{ fontSize: 13, color: 'var(--color-fg-primary, #111827)' }}>
                  <span>{run.ticketsChecked.toLocaleString()} checked</span>
                  <span style={{ margin: '0 6px', color: 'var(--color-fg-muted, #9ca3af)' }}>·</span>
                  <span style={{ color: run.ticketsResynced > 0 ? '#0284c7' : 'var(--color-fg-muted, #6b7280)' }}>
                    {run.ticketsResynced.toLocaleString()} resynced
                  </span>
                  {run.errorsCount > 0 && (
                    <>
                      <span style={{ margin: '0 6px', color: 'var(--color-fg-muted, #9ca3af)' }}>·</span>
                      <span
                        aria-label={`${run.errorsCount} errors`}
                        style={{ color: '#dc2626' }}
                      >
                        {run.errorsCount.toLocaleString()} errors
                      </span>
                    </>
                  )}
                </div>

                {/* Duration */}
                <span style={{ fontSize: 12, color: 'var(--color-fg-muted, #6b7280)', whiteSpace: 'nowrap' }}>
                  {duration}
                </span>

                {/* Lookback */}
                <span style={{ fontSize: 12, color: 'var(--color-fg-muted, #6b7280)', whiteSpace: 'nowrap' }}>
                  {run.lookbackHours}h window
                </span>

                {/* Started at */}
                <span style={{ fontSize: 12, color: 'var(--color-fg-muted, #6b7280)', whiteSpace: 'nowrap' }}>
                  {new Date(run.startedAt).toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* No connection selected */}
      {!connectionId && (
        <p style={{ color: 'var(--color-fg-muted, #6b7280)', fontSize: 13, marginTop: 8 }}>
          Select a connection to view reconciliation runs.
        </p>
      )}
    </section>
  );
}
