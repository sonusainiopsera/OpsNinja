'use client';

/**
 * HBarChart — horizontal bar chart with top-N truncation (WO-070, AC7, AC10).
 *
 * Renders up to `topN` bars plus an explicit "Other" bucket so a long tail
 * never breaks layout. Label text is escaped before rendering (never dangerously
 * set as HTML). Each bar exposes an accessible role="meter" for screen readers.
 *
 * Zero-state: renders an explicit empty-state message rather than an empty
 * chart area, so absence of data is unambiguous.
 */

import React from 'react';

const DEFAULT_TOP_N = 8;
const BAR_HEIGHT = 20;

export interface HBarChartRow {
  label: string;
  value: number;
  /** Optional supplemental note rendered below the label. */
  note?: string;
}

export interface HBarChartProps {
  rows: HBarChartRow[];
  /** Maximum bars before grouping into "Other". Default: 8. */
  topN?: number;
  /** Accent colour CSS variable (fallback = blue). */
  colorVar?: string;
  /** Shown when rows is empty. */
  emptyMessage?: string;
  /** Accessible label for the chart region. */
  ariaLabel?: string;
}

export function HBarChart({
  rows,
  topN = DEFAULT_TOP_N,
  colorVar = '--chart-bar-color',
  emptyMessage = 'No data',
  ariaLabel = 'Horizontal bar chart',
}: HBarChartProps) {
  if (rows.length === 0) {
    return (
      <div
        role="img"
        aria-label={`${ariaLabel}: no data`}
        style={{
          padding: '20px 0',
          textAlign: 'center',
          color: 'var(--color-fg-tertiary, #9ca3af)',
          fontSize: 13,
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  // Sort descending, then split top-N vs rest
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN);

  const displayRows: HBarChartRow[] = [...top];
  if (rest.length > 0) {
    const otherTotal = rest.reduce((s, r) => s + r.value, 0);
    displayRows.push({ label: `Other (${rest.length} more)`, value: otherTotal });
  }

  const max = Math.max(...displayRows.map((r) => r.value), 1);

  return (
    <div role="img" aria-label={ariaLabel}>
      <table
        style={{ width: '100%', borderCollapse: 'collapse' }}
        aria-label={ariaLabel}
      >
        <tbody>
          {displayRows.map((row) => {
            const pct = Math.round((row.value / max) * 100);
            return (
              <tr key={row.label}>
                <td
                  style={{
                    fontSize: 12,
                    color: 'var(--color-fg-primary, #111827)',
                    paddingRight: 8,
                    paddingBottom: 6,
                    maxWidth: 180,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    verticalAlign: 'middle',
                    width: '35%',
                  }}
                  title={row.label}
                >
                  {/* Escaped: React renders text nodes, never innerHTML */}
                  {row.label}
                  {row.note && (
                    <span
                      style={{
                        display: 'block',
                        fontSize: 10,
                        color: 'var(--color-fg-tertiary, #9ca3af)',
                        marginTop: 1,
                      }}
                    >
                      {row.note}
                    </span>
                  )}
                </td>
                <td style={{ verticalAlign: 'middle', paddingBottom: 6 }}>
                  <div
                    role="meter"
                    aria-valuenow={row.value}
                    aria-valuemin={0}
                    aria-valuemax={max}
                    aria-label={`${row.label}: ${row.value}`}
                    style={{
                      height: BAR_HEIGHT,
                      background: 'var(--color-bg-muted, #f3f4f6)',
                      borderRadius: 4,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${pct}%`,
                        background: `var(${colorVar}, #3b82f6)`,
                        borderRadius: 4,
                        transition: 'width 0.3s ease',
                        minWidth: row.value > 0 ? 4 : 0,
                      }}
                    />
                  </div>
                </td>
                <td
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--color-fg-primary, #111827)',
                    paddingLeft: 8,
                    paddingBottom: 6,
                    width: 36,
                    textAlign: 'right',
                    verticalAlign: 'middle',
                  }}
                >
                  {row.value}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
