'use client';

/**
 * ExportBar — action bar on the Report Builder for triggering exports and schedules.
 *
 * AC-1: Renders ExportPdfButton, ExportCsvButton and ScheduleButton.
 *       Buttons are disabled with an explanatory tooltip until the report has
 *       been successfully previewed at least once (hasPreview === false).
 * AC-2: Clicking an export posts to POST /api/v1/exports and immediately inserts
 *       an optimistic JobRow.
 */

import React, { useState } from 'react';
import { useCreateExport } from '../api/export.queries';
import { ScheduleModal } from './ScheduleModal';
import type { CreateExportPayload } from '../../../lib/api/reporting/types';

// ---------------------------------------------------------------------------
// Button styles
// ---------------------------------------------------------------------------

const btnBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '0.375rem 0.75rem',
  borderRadius: 'var(--radius-md, 6px)',
  border: '1px solid var(--color-border, #d1d5db)',
  background: 'var(--color-surface, #fff)',
  fontSize: '0.8125rem',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'background 0.1s',
  color: 'var(--color-text-primary, #111827)',
};

const btnDisabled: React.CSSProperties = {
  ...btnBase,
  color: 'var(--color-text-secondary, #9ca3af)',
  cursor: 'not-allowed',
  opacity: 0.6,
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ExportBarProps {
  /** True once the report has been successfully previewed at least once. */
  hasPreview: boolean;
  /** Definition payload forwarded to the export API. */
  definition: CreateExportPayload['definition'];
  definitionId?: string;
  /** Called with the new job's id after optimistic insertion (optional). */
  onJobCreated?: (jobId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExportBar({ hasPreview, definition, definitionId, onJobCreated }: ExportBarProps) {
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const createExport = useCreateExport();

  const disabledReason = hasPreview
    ? undefined
    : 'Run the report at least once before exporting';

  const handleExport = (format: 'csv' | 'pdf') => {
    if (!hasPreview) return;
    const payload: CreateExportPayload = {
      format,
      ...(definitionId ? { definitionId } : { definition }),
      scope: 'report',
    };
    createExport.mutate(payload, {
      onSuccess: (res) => onJobCreated?.(res.jobId),
    });
  };

  return (
    <div
      style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}
      aria-label="Export actions"
    >
      {/* Export CSV */}
      <button
        type="button"
        onClick={() => handleExport('csv')}
        disabled={!hasPreview || createExport.isPending}
        aria-disabled={!hasPreview}
        title={disabledReason}
        style={hasPreview ? btnBase : btnDisabled}
        aria-label={
          hasPreview
            ? 'Export as CSV'
            : `Export as CSV — ${disabledReason}`
        }
      >
        ↓ Export CSV
      </button>

      {/* Export PDF */}
      <button
        type="button"
        onClick={() => handleExport('pdf')}
        disabled={!hasPreview || createExport.isPending}
        aria-disabled={!hasPreview}
        title={disabledReason}
        style={hasPreview ? btnBase : btnDisabled}
        aria-label={
          hasPreview
            ? 'Export as PDF'
            : `Export as PDF — ${disabledReason}`
        }
      >
        ↓ Export PDF
      </button>

      {/* Schedule */}
      <button
        type="button"
        onClick={() => hasPreview && setScheduleOpen(true)}
        disabled={!hasPreview}
        aria-disabled={!hasPreview}
        title={disabledReason ?? 'Schedule recurring export'}
        style={hasPreview ? btnBase : btnDisabled}
        aria-label={
          hasPreview
            ? 'Schedule recurring export'
            : `Schedule — ${disabledReason}`
        }
      >
        ⏰ Schedule
      </button>

      {/* Error notice */}
      {createExport.isError && (
        <span
          role="alert"
          aria-live="polite"
          style={{
            fontSize: '0.75rem',
            color: 'var(--color-error, #dc2626)',
          }}
        >
          Export request failed.
          {(createExport.error as { traceId?: string } | null)?.traceId && (
            <> Trace: {(createExport.error as { traceId?: string }).traceId}</>
          )}
        </span>
      )}

      {/* Schedule modal */}
      {scheduleOpen && (
        <ScheduleModal
          definition={definition}
          definitionId={definitionId}
          onClose={() => setScheduleOpen(false)}
        />
      )}
    </div>
  );
}
