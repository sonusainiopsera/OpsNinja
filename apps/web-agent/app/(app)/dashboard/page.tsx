'use client';

/**
 * DashboardPage — live operational command centre (WO-070).
 *
 * Renders inside the existing AppShell (Sidebar + TopBar).
 * Implements AC1 through AC12 from the WO acceptance criteria.
 *
 * Key invariants:
 *   - ONE WebSocket connection (useDashboardStream owns it).
 *   - ONE 1-second ticker (setInterval in this component, shared with all rows).
 *   - SLA countdowns interpolate from generatedAt — no server round-trip per tick.
 *   - Degraded snapshot shows a persistent dismissible-per-session banner.
 *   - LiveStatusPill (in TopBar) reflects stream status via Zustand store.
 *   - Permission: dashboard:read required (enforced in middleware/layout).
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { KpiGrid } from '../../../features/dashboard/components/KpiGrid';
import { BreachRiskPanel } from '../../../features/dashboard/components/BreachRiskPanel';
import { ActivityFeed } from '../../../features/dashboard/components/ActivityFeed';
import { TenantLoadCard } from '../../../features/dashboard/components/TenantLoadCard';
import { HBarChart } from '../../../features/dashboard/components/HBarChart';
import { useDashboardStream } from '../../../features/dashboard/state/use-dashboard-stream';
import type { HBarChartRow } from '../../../features/dashboard/components/HBarChart';

// ---------------------------------------------------------------------------
// DashboardPage
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const { status, data, degraded, degradedReason, lastError } = useDashboardStream();

  // Single shared 1-second ticker for all SLA countdowns (AC4).
  const [tickMs, setTickMs] = useState<number>(() => Date.now());
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    tickerRef.current = setInterval(() => setTickMs(Date.now()), 1_000);
    return () => {
      if (tickerRef.current !== null) clearInterval(tickerRef.current);
    };
  }, []);

  // Degraded banner dismiss (per-session via component state).
  const [degradedDismissed, setDegradedDismissed] = useState(false);
  const handleDismissDegraded = useCallback(() => setDegradedDismissed(true), []);

  // Show degraded banner when snapshot.degraded and not dismissed.
  const showDegradedBanner = degraded && !degradedDismissed;

  // Retry on snapshot fetch error.
  const handleRetry = useCallback(() => window.location.reload(), []);

  const loading = status === 'connecting' || status === 'backfilling';
  const generatedAt = data.generatedAt ?? new Date().toISOString();

  // Map category / affected-area rows → HBarChart rows.
  const categoryRows: HBarChartRow[] = data.categoryBreakdown.map((r) => ({
    label: r.categoryPath,
    value: r.count,
  }));

  const affectedAreaRows: HBarChartRow[] = data.affectedAreaBreakdown.map((r) => ({
    label: r.areaTag,
    value: r.count,
    // AC7: show AI coverage note when incomplete
    note: r.aiIncomplete ? '⚠ Partial AI coverage' : undefined,
  }));

  // AI coverage note for the affected-area card header (AC7).
  const hasAiIncomplete =
    data.affectedAreaBreakdown.some((r) => r.aiIncomplete) ||
    (data.snapshot?.aiCoverageIncomplete ?? false);

  return (
    <main
      aria-label="Live operational dashboard"
      data-testid="dashboard-page"
      style={{
        padding: '24px 32px',
        maxWidth: 1440,
        margin: '0 auto',
        fontFamily: 'var(--font-sans, system-ui, sans-serif)',
      }}
    >
      {/* Page header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              margin: 0,
              color: 'var(--color-fg-primary, #111827)',
            }}
          >
            Dashboard
          </h1>
          <p
            style={{
              fontSize: 13,
              color: 'var(--color-fg-secondary, #6b7280)',
              margin: '4px 0 0',
            }}
          >
            Refreshes every 5 s · SLA countdowns interpolated locally
          </p>
        </div>
        {/* Stream status indicator — aria-live so screen readers hear updates */}
        <div
          aria-live="polite"
          aria-atomic="true"
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <StatusIndicator status={status} />
        </div>
      </header>

      {/* Degraded data banner (AC6) */}
      {showDegradedBanner && (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="degraded-banner"
          style={{
            background: 'var(--color-warning-bg, #fffbeb)',
            border: '1px solid var(--color-warning-border, #fde68a)',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--color-warning-fg, #92400e)' }}>
            ⚠ Data may be delayed.{' '}
            {degradedReason ? degradedReason : 'Live stream unavailable; showing cached data.'}
          </span>
          <button
            type="button"
            aria-label="Dismiss delayed-data notice"
            onClick={handleDismissDegraded}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 16,
              color: 'var(--color-warning-fg, #92400e)',
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Snapshot error banner */}
      {lastError && !loading && (
        <div
          role="alert"
          data-testid="error-banner"
          style={{
            background: 'var(--color-danger-bg, #fef2f2)',
            border: '1px solid var(--color-danger-border, #fecaca)',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--color-danger, #991b1b)' }}>
            Failed to load dashboard data: {lastError}
          </span>
          <button
            type="button"
            onClick={handleRetry}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: '4px 12px',
              borderRadius: 6,
              border: '1px solid var(--color-danger, #991b1b)',
              background: 'none',
              color: 'var(--color-danger, #991b1b)',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* KPI cards (AC2, AC10) */}
      <section aria-label="KPI summary" style={{ marginBottom: 28 }}>
        <KpiGrid kpis={data.kpis} loading={loading} />
      </section>

      {/* Two-column layout: breach panel + activity feed */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)',
          gap: 20,
          marginBottom: 28,
          alignItems: 'start',
        }}
      >
        {/* Breach risk panel (AC4) */}
        <Card
          title="Approaching Breach"
          aria-label="Approaching breach panel"
        >
          <BreachRiskPanel
            rows={data.breachRisk}
            generatedAt={generatedAt}
            tickMs={tickMs}
            loading={loading}
          />
        </Card>

        {/* Activity feed */}
        <Card title="Live Activity">
          <ActivityFeed events={data.activityFeed} loading={loading} />
        </Card>
      </div>

      {/* Charts row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 20,
          marginBottom: 28,
        }}
      >
        {/* Category breakdown */}
        <Card title="By Category">
          <HBarChart
            rows={categoryRows}
            colorVar="--chart-category-color"
            emptyMessage="No category data"
            ariaLabel="Ticket count by category"
          />
        </Card>

        {/* Affected-area breakdown (AC7) */}
        <Card
          title="Affected Areas"
          titleNote={
            hasAiIncomplete
              ? '⚠ AI analysis incomplete — some areas may be underrepresented'
              : undefined
          }
          titleNoteTestId="ai-coverage-note"
        >
          <HBarChart
            rows={affectedAreaRows}
            colorVar="--chart-area-color"
            emptyMessage="No affected-area data"
            ariaLabel="Ticket count by affected area"
          />
        </Card>

        {/* Org load table */}
        <Card title="Organisation Load">
          <TenantLoadCard rows={data.orgLoad} loading={loading} />
        </Card>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Card wrapper
// ---------------------------------------------------------------------------

interface CardProps {
  title: string;
  children: React.ReactNode;
  'aria-label'?: string;
  titleNote?: string;
  titleNoteTestId?: string;
}

function Card({ title, children, 'aria-label': ariaLabel, titleNote, titleNoteTestId }: CardProps) {
  return (
    <section
      aria-label={ariaLabel ?? title}
      style={{
        background: 'var(--color-bg-card, #fff)',
        border: '1px solid var(--color-border, #e5e7eb)',
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '14px 16px 10px',
          borderBottom: '1px solid var(--color-border, #e5e7eb)',
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--color-fg-primary, #111827)',
          }}
        >
          {title}
        </h2>
        {titleNote && (
          <span
            data-testid={titleNoteTestId}
            style={{
              fontSize: 11,
              color: 'var(--color-warning-fg, #92400e)',
              fontWeight: 500,
            }}
          >
            {titleNote}
          </span>
        )}
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// StatusIndicator — local indicator near the page header (supplemental to
// the TopBar LiveStatusPill). Shows the raw stream status text.
// ---------------------------------------------------------------------------

import type { StreamStatus } from '../../../features/dashboard/state/use-dashboard-stream';

const STATUS_LABEL: Record<StreamStatus, string> = {
  connecting: 'Connecting…',
  backfilling: 'Syncing…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  polling: 'Polling (30 s)',
  stale: 'Delayed',
};

function StatusIndicator({ status }: { status: StreamStatus }) {
  const isLive = status === 'live';
  return (
    <span
      aria-label={`Dashboard data status: ${STATUS_LABEL[status]}`}
      style={{
        fontSize: 12,
        fontWeight: 500,
        color: isLive
          ? 'var(--color-success, #15803d)'
          : 'var(--color-fg-secondary, #6b7280)',
      }}
    >
      {isLive ? '● ' : '○ '}
      {STATUS_LABEL[status]}
    </span>
  );
}
