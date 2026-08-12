'use client';

/**
 * BreachRiskPanel — approaching-breach panel (WO-070, AC4, AC9, AC10).
 *
 * Displays breach-risk rows with SLA countdowns driven by a SINGLE shared
 * 1-second ticker passed in from DashboardPage (never starts its own interval).
 *
 * Colour + icon + text: breach state is never communicated by colour alone
 * (AC10). The SlaCountdown component handles the per-pill indicator.
 *
 * Rows for organisations outside the principal's scope are never rendered
 * (the server only returns in-scope rows, so the filter is the server contract).
 *
 * Clicking a row navigates to ticket detail with the correct route (AC9).
 */

import React, { useMemo } from 'react';
import Link from 'next/link';
import type { BreachRiskRow } from '../../../lib/api/dashboard';
import { SlaCountdown } from './SlaCountdown';
import { computeCountdown, classifyDisplayState } from '../state/countdown';
import type { CountdownResult } from '../state/countdown';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max rows before a "view all" truncation link appears. */
const ROW_LIMIT = 20;

/** Warning threshold: 15 minutes. Server can override via row; this is the
 *  client-side default used when the row doesn't carry a reminderThresholdMs. */
const DEFAULT_WARNING_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface BreachRiskPanelProps {
  rows: BreachRiskRow[];
  /** generatedAt from the last snapshot/frame — used for interpolation. */
  generatedAt: string;
  /** Current epoch ms from the shared 1-second ticker. */
  tickMs: number;
  /** When true, shows loading skeleton instead of rows. */
  loading?: boolean;
  /** Optional CSS className for the outer wrapper. */
  className?: string;
}

// ---------------------------------------------------------------------------
// BreachRow
// ---------------------------------------------------------------------------

interface BreachRowProps {
  row: BreachRiskRow;
  countdown: CountdownResult;
}

function BreachRowItem({ row, countdown }: BreachRowProps) {
  const ticketRoute = `/tickets/${row.ticketId}`;

  return (
    <tr
      data-testid="breach-row"
      data-ticket-id={row.ticketId}
      style={{
        borderBottom: '1px solid var(--color-border, #e5e7eb)',
      }}
    >
      {/* Priority badge — icon + text, not just colour */}
      <td
        style={{
          padding: '8px 12px 8px 4px',
          fontSize: 12,
          fontWeight: 600,
          color:
            row.priority === 'P1'
              ? 'var(--priority-p1-fg, #991b1b)'
              : row.priority === 'P2'
                ? 'var(--priority-p2-fg, #92400e)'
                : 'var(--color-fg-secondary, #6b7280)',
          whiteSpace: 'nowrap',
          verticalAlign: 'middle',
        }}
        aria-label={`Priority ${row.priority}`}
      >
        {/* Non-colour priority indicator: symbol + text */}
        {row.priority === 'P1' ? '🔴 ' : row.priority === 'P2' ? '🟠 ' : ''}
        {row.priority}
      </td>

      {/* Ticket link */}
      <td
        style={{
          padding: '8px 12px',
          verticalAlign: 'middle',
          maxWidth: 180,
        }}
      >
        <Link
          href={ticketRoute}
          aria-label={`Open ticket ${row.ticketKey}`}
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--color-link, #2563eb)',
            textDecoration: 'none',
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {row.ticketKey}
        </Link>
        <span
          style={{
            display: 'block',
            fontSize: 11,
            color: 'var(--color-fg-secondary, #6b7280)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {row.organizationName}
        </span>
      </td>

      {/* SLA countdown pill */}
      <td
        style={{
          padding: '8px 4px 8px 12px',
          textAlign: 'right',
          verticalAlign: 'middle',
          whiteSpace: 'nowrap',
        }}
      >
        <SlaCountdown result={countdown} compact />
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// BreachRiskPanel
// ---------------------------------------------------------------------------

export function BreachRiskPanel({
  rows,
  generatedAt,
  tickMs,
  loading = false,
  className,
}: BreachRiskPanelProps) {
  // Compute countdown for every row from the shared tick (no per-row interval).
  const rowsWithCountdown = useMemo<Array<{ row: BreachRiskRow; countdown: CountdownResult }>>(
    () =>
      rows.map((row) => {
        const raw = computeCountdown(
          {
            remainingMs: row.remainingMs,
            pausedMs: row.pausedMs,
            generatedAt,
            timerState: row.timerState,
          },
          tickMs,
        );
        const displayState = classifyDisplayState(
          raw.remainingMs,
          row.timerState,
          DEFAULT_WARNING_MS,
        );
        return { row, countdown: { ...raw, displayState } };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, generatedAt, tickMs],
  );

  // Sort: breached first, then by remainingMs ascending.
  const sorted = useMemo(
    () =>
      [...rowsWithCountdown].sort((a, b) => {
        if (a.countdown.breached !== b.countdown.breached) {
          return a.countdown.breached ? -1 : 1;
        }
        return a.countdown.remainingMs - b.countdown.remainingMs;
      }),
    [rowsWithCountdown],
  );

  const visibleRows = sorted.slice(0, ROW_LIMIT);
  const truncated = sorted.length > ROW_LIMIT;

  if (loading) {
    return (
      <section className={className} aria-label="Approaching breach" aria-busy="true">
        <p
          style={{
            fontSize: 13,
            color: 'var(--color-fg-tertiary, #9ca3af)',
            padding: '20px 0',
            textAlign: 'center',
          }}
        >
          Loading…
        </p>
      </section>
    );
  }

  if (rows.length === 0) {
    return (
      <section
        className={className}
        aria-label="Approaching breach: no tickets approaching breach"
        data-testid="breach-risk-panel"
        data-empty="true"
      >
        <p
          style={{
            fontSize: 13,
            color: 'var(--color-fg-tertiary, #9ca3af)',
            padding: '20px 0',
            textAlign: 'center',
          }}
        >
          No tickets approaching breach
        </p>
      </section>
    );
  }

  return (
    <section
      className={className}
      aria-label={`Approaching breach — ${rows.length} ticket${rows.length !== 1 ? 's' : ''}`}
      data-testid="breach-risk-panel"
    >
      <table
        style={{ width: '100%', borderCollapse: 'collapse' }}
        aria-label="Breach risk tickets"
      >
        <thead>
          <tr style={{ borderBottom: '2px solid var(--color-border, #e5e7eb)' }}>
            <th
              scope="col"
              style={{
                padding: '6px 12px 6px 4px',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--color-fg-secondary, #6b7280)',
                textAlign: 'left',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Pri
            </th>
            <th
              scope="col"
              style={{
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--color-fg-secondary, #6b7280)',
                textAlign: 'left',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Ticket / Org
            </th>
            <th
              scope="col"
              style={{
                padding: '6px 4px 6px 12px',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--color-fg-secondary, #6b7280)',
                textAlign: 'right',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              SLA
            </th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map(({ row, countdown }) => (
            <BreachRowItem key={row.ticketId} row={row} countdown={countdown} />
          ))}
        </tbody>
      </table>

      {truncated && (
        <p
          style={{
            fontSize: 12,
            color: 'var(--color-fg-secondary, #6b7280)',
            marginTop: 8,
            textAlign: 'center',
          }}
        >
          Showing {ROW_LIMIT} of {sorted.length} rows.{' '}
          <Link
            href="/tickets?filter=approaching_breach"
            style={{ color: 'var(--color-link, #2563eb)' }}
          >
            View all in queue →
          </Link>
        </p>
      )}
    </section>
  );
}
