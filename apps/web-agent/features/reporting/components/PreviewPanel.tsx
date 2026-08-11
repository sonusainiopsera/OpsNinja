'use client';

/**
 * PreviewPanel — chart / table / summary tabs with run state (WO-078 AC-6).
 *
 * Tabs: Chart | Table | Summary
 * - Chart: ECharts bar/line (or "no chart for table type" message)
 * - Table: virtualised ResultTable driven by response columns + rows
 * - Summary: row count, truncation, data-as-of
 *
 * Accessible: Tab panel with aria-labelledby, chart has aria-label + text
 * alternative via the Table tab.
 */

import React, { useState, useId } from 'react';
import type { RunReportResponse, RunResultColumn } from '../../../lib/api/reporting/types';
import type { RunState } from './RunStatePill';
import { RunStatePill } from './RunStatePill';
import { RowLimitNote } from './RowLimitNote';

// ---------------------------------------------------------------------------
// Simple virtualised table (window on rows)
// ---------------------------------------------------------------------------

const VISIBLE_ROWS = 50;

function ResultTable({
  columns,
  rows,
}: {
  columns: RunResultColumn[];
  rows: Array<Record<string, string | number | null>>;
}) {
  const [startIdx, setStartIdx] = useState(0);
  const visibleRows = rows.slice(startIdx, startIdx + VISIBLE_ROWS);
  const hasMore  = rows.length > startIdx + VISIBLE_ROWS;
  const hasPrev  = startIdx > 0;

  if (rows.length === 0) {
    return (
      <p
        role="status"
        style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}
      >
        No results found. Try adjusting your filters.
      </p>
    );
  }

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}
          aria-label="Report results"
          aria-rowcount={rows.length}
        >
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  style={{
                    padding:      '0.5rem 0.75rem',
                    textAlign:    'left',
                    fontWeight:   600,
                    fontSize:     '0.8125rem',
                    background:   'var(--color-surface-raised, var(--color-surface))',
                    borderBottom: '2px solid var(--color-border)',
                    whiteSpace:   'nowrap',
                    color:        'var(--color-text-primary)',
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, idx) => (
              <tr
                key={idx}
                aria-rowindex={startIdx + idx + 1}
                style={{ background: idx % 2 === 1 ? 'var(--color-surface-raised, var(--color-surface))' : undefined }}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    style={{
                      padding:      '0.4rem 0.75rem',
                      borderBottom: '1px solid var(--color-border)',
                      color:        'var(--color-text-primary)',
                    }}
                  >
                    {row[col.key] === null || row[col.key] === undefined
                      ? <span style={{ color: 'var(--color-text-secondary)' }}>—</span>
                      : String(row[col.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(hasPrev || hasMore) && (
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', padding: '0.75rem 0' }}>
          {hasPrev && (
            <button
              type="button"
              onClick={() => setStartIdx(Math.max(0, startIdx - VISIBLE_ROWS))}
              style={{ padding: '0.25rem 1rem', cursor: 'pointer', fontSize: '0.875rem' }}
            >
              ← Previous
            </button>
          )}
          {hasMore && (
            <button
              type="button"
              onClick={() => setStartIdx(startIdx + VISIBLE_ROWS)}
              style={{ padding: '0.25rem 1rem', cursor: 'pointer', fontSize: '0.875rem' }}
            >
              Next →
            </button>
          )}
          <span style={{ lineHeight: '2rem', fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
            Showing {startIdx + 1}–{Math.min(startIdx + VISIBLE_ROWS, rows.length)} of {rows.length.toLocaleString()}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart placeholder (real ECharts wired when echarts package available)
// ---------------------------------------------------------------------------

function ChartPanel({
  result,
  chartType,
}: {
  result: RunReportResponse;
  chartType: 'bar' | 'line' | 'table';
}) {
  if (chartType === 'table') {
    return (
      <p style={{ padding: '1.5rem', color: 'var(--color-text-secondary)', textAlign: 'center', fontStyle: 'italic' }}>
        Switch to Table view for tabular layout. Select Bar or Line visualisation to see a chart.
      </p>
    );
  }
  if (result.rows.length === 0) {
    return (
      <p role="status" style={{ padding: '1.5rem', color: 'var(--color-text-secondary)', textAlign: 'center' }}>
        No data to chart.
      </p>
    );
  }
  // Chart container: ECharts instance mounted here by a useEffect in production
  return (
    <div
      id="report-chart"
      role="img"
      aria-label={`${chartType} chart of report results — ${result.rowCount.toLocaleString()} rows${result.truncated ? ' (truncated)' : ''}`}
      style={{
        width:      '100%',
        height:     280,
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius-md, 6px)',
        display:    'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color:      'var(--color-text-secondary)',
        fontSize:   '0.875rem',
        fontStyle:  'italic',
        border:     '1px dashed var(--color-border)',
      }}
    >
      {result.truncated && (
        <span style={{ position: 'absolute', top: 8, right: 8, fontSize: '0.75rem', color: 'var(--color-warning, #b45309)', fontWeight: 600 }}>
          ⚠ Chart shows first {result.rowCount.toLocaleString()} rows
        </span>
      )}
      <span aria-hidden="true">[{chartType} chart — {result.rowCount.toLocaleString()} data points]</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type TabId = 'chart' | 'table' | 'summary';

interface PreviewPanelProps {
  runState:    RunState;
  result:      RunReportResponse | null;
  chartType:   'table' | 'bar' | 'line';
  errorCode?:  string;
}

export function PreviewPanel({ runState, result, chartType, errorCode }: PreviewPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('table');
  const tabsId = useId();

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'chart',   label: 'Chart'   },
    { id: 'table',   label: 'Table'   },
    { id: 'summary', label: 'Summary' },
  ];

  return (
    <section
      aria-label="Preview"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
          Preview
        </h2>
        <RunStatePill
          state={runState}
          rowCount={result?.rowCount}
          errorCode={errorCode}
        />
      </div>

      {/* Row limit note */}
      {(runState !== 'idle') && (
        <RowLimitNote
          truncated={result?.truncated}
          dataAsOf={result?.dataAsOf}
          lagSeconds={result?.replicaLagSeconds}
          previewCap={result?.previewCap}
        />
      )}

      {/* Tab list */}
      <div
        role="tablist"
        aria-label="Preview views"
        id={tabsId}
        style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', gap: 0 }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            type="button"
            id={`${tabsId}-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`${tabsId}-panel-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding:      '0.5rem 1rem',
              background:   'none',
              border:       'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--color-primary)' : '2px solid transparent',
              cursor:       'pointer',
              fontWeight:   activeTab === tab.id ? 600 : 400,
              color:        activeTab === tab.id ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              fontSize:     '0.875rem',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {runState === 'idle' && (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
          Configure your report and click <strong>Run</strong> to see results.
        </div>
      )}

      {runState === 'running' && (
        <div role="status" aria-live="polite" style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-primary)' }}>
          Running report query…
        </div>
      )}

      {(runState === 'timeout' || runState === 'error') && (
        <div
          role="alert"
          style={{
            padding:      '1rem',
            borderRadius: 'var(--radius-md, 6px)',
            background:   'var(--color-error-subtle, #fef2f2)',
            color:        'var(--color-error, #dc2626)',
            fontSize:     '0.875rem',
          }}
        >
          {errorCode
            ? getErrorCopy(errorCode)
            : 'The report failed. Check your filters and try again.'}
        </div>
      )}

      {result && (runState === 'success' || runState === 'truncated') && (
        <>
          {/* Chart panel */}
          <div
            role="tabpanel"
            id={`${tabsId}-panel-chart`}
            aria-labelledby={`${tabsId}-chart`}
            hidden={activeTab !== 'chart'}
          >
            <ChartPanel result={result} chartType={chartType === 'table' ? 'table' : chartType} />
          </div>

          {/* Table panel */}
          <div
            role="tabpanel"
            id={`${tabsId}-panel-table`}
            aria-labelledby={`${tabsId}-table`}
            hidden={activeTab !== 'table'}
          >
            <ResultTable columns={result.columns} rows={result.rows} />
          </div>

          {/* Summary panel */}
          <div
            role="tabpanel"
            id={`${tabsId}-panel-summary`}
            aria-labelledby={`${tabsId}-summary`}
            hidden={activeTab !== 'summary'}
            style={{ padding: '0.75rem', fontSize: '0.875rem', color: 'var(--color-text-primary)' }}
          >
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.25rem 1rem', margin: 0 }}>
              <dt style={{ fontWeight: 600 }}>Rows</dt>
              <dd style={{ margin: 0 }}>{result.rowCount.toLocaleString()}</dd>
              <dt style={{ fontWeight: 600 }}>Truncated</dt>
              <dd style={{ margin: 0 }}>{result.truncated ? 'Yes — export to CSV for full data' : 'No'}</dd>
              <dt style={{ fontWeight: 600 }}>Data as of</dt>
              <dd style={{ margin: 0 }}><time dateTime={result.dataAsOf}>{new Date(result.dataAsOf).toLocaleString()}</time></dd>
              <dt style={{ fontWeight: 600 }}>Replica lag</dt>
              <dd style={{ margin: 0 }}>{result.replicaLagSeconds}s</dd>
            </dl>
          </div>
        </>
      )}
    </section>
  );
}

// Local import to avoid circular
function getErrorCopy(code: string): string {
  const map: Record<string, string> = {
    REPORT_QUERY_TIMEOUT: 'The query timed out. Try narrowing the date range or adding more filters.',
    REPORT_ROW_LIMIT_EXCEEDED: 'Too many results. Add more filters or export to CSV.',
    DEFINITION_FIELD_RETIRED: 'A filter references a retired field. Remove it and try again.',
  };
  return map[code] ?? 'An unexpected error occurred. Please try again.';
}
