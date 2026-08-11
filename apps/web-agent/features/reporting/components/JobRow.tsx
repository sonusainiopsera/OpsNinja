'use client';

/**
 * JobRow — single row in the ExportJobsCard.
 *
 * AC-3: Shows format, textual status alongside badge colour, row count,
 *       human-readable byte size, created time, relative expiry (with
 *       absolute tooltip), and Download action (completed + unexpired only).
 * AC-6: Expired jobs show a Re-run action.
 * AC-7: Failed jobs show structured error copy, Retry action (where meaningful),
 *       and a copyable trace ID.
 * AC-10: Status conveyed by text AND colour; all actions keyboard reachable.
 */

import React, { useState } from 'react';
import type { ExportJob } from '../../../lib/api/reporting/types';
import type { OptimisticExportJob } from '../api/export.queries';
import {
  isTerminalStatus,
  formatBytes,
  formatRelativeExpiry,
  getExportErrorCopy,
  useDownloadExport,
  useCreateExport,
} from '../api/export.queries';

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_COLOURS: Record<string, string> = {
  queued:     '#6b7280', // grey
  processing: '#2563eb', // blue
  completed:  '#16a34a', // green
  failed:     '#dc2626', // red
  expired:    '#92400e', // amber-brown
  optimistic: '#6b7280', // grey (same as queued)
};

const STATUS_LABELS: Record<string, string> = {
  queued:     'Queued',
  processing: 'Processing',
  completed:  'Completed',
  failed:     'Failed',
  expired:    'Expired',
  optimistic: 'Queued',
};

function StatusBadge({ status }: { status: string }) {
  const colour = STATUS_COLOURS[status] ?? '#6b7280';
  const label  = STATUS_LABELS[status] ?? status;
  return (
    <span
      aria-label={`Status: ${label}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: '0.75rem',
        fontWeight: 500,
        color: colour,
      }}
    >
      {/* Colour dot — visual channel */}
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: colour,
          flexShrink: 0,
        }}
      />
      {/* Text — semantic channel (AC-10) */}
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Action buttons
// ---------------------------------------------------------------------------

const actionBtn: React.CSSProperties = {
  padding: '0.25rem 0.625rem',
  borderRadius: 'var(--radius-sm, 4px)',
  border: '1px solid var(--color-border, #d1d5db)',
  background: 'var(--color-surface, #fff)',
  fontSize: '0.75rem',
  fontWeight: 500,
  cursor: 'pointer',
  color: 'var(--color-text-primary, #111827)',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type AnyJob = ExportJob | OptimisticExportJob;

function isRealJob(job: AnyJob): job is ExportJob {
  return 'id' in job;
}

interface JobRowProps {
  job: AnyJob;
  onRemove?: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function JobRow({ job, onRemove }: JobRowProps) {
  const [copyConfirm, setCopyConfirm] = useState(false);
  const downloadExport = useDownloadExport();
  const createExport = useCreateExport();

  // Optimistic entries don't have a real ID yet
  if (!isRealJob(job)) {
    const opt = job as OptimisticExportJob;
    return (
      <li
        role="listitem"
        aria-label={`Export job: ${opt.format.toUpperCase()}, status Queued`}
        style={rowStyle}
      >
        <div style={cellStyle}>
          <span style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
            {opt.format}
          </span>
        </div>
        <div style={cellStyle}>
          <StatusBadge status="optimistic" />
        </div>
        <div style={{ ...cellStyle, color: 'var(--color-text-secondary, #6b7280)', fontSize: '0.75rem' }}>
          —
        </div>
        <div style={{ ...cellStyle, color: 'var(--color-text-secondary, #6b7280)', fontSize: '0.75rem' }}>
          Submitting…
        </div>
        <div style={cellStyle} />
      </li>
    );
  }

  const {
    id, format, status, rowCount, fileSizeBytes,
    createdAt, expiresAt, errorCode, traceId, definition,
  } = job;

  const createdDate = new Date(createdAt).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  const expiryText = expiresAt ? formatRelativeExpiry(expiresAt) : null;
  const isExpired = status === 'expired' || (expiresAt ? new Date(expiresAt) < new Date() : false);
  const isCompleted = status === 'completed' && !isExpired;
  const isFailed = status === 'failed';

  const handleDownload = () => {
    downloadExport.mutate(id);
  };

  const handleRetry = () => {
    createExport.mutate({
      format,
      definition,
      scope: 'report',
    });
  };

  const handleCopyTrace = () => {
    if (!traceId) return;
    navigator.clipboard.writeText(traceId).then(() => {
      setCopyConfirm(true);
      setTimeout(() => setCopyConfirm(false), 2_000);
    }).catch(() => undefined);
  };

  return (
    <li
      role="listitem"
      aria-label={`Export job: ${format.toUpperCase()}, status ${STATUS_LABELS[status] ?? status}`}
      style={rowStyle}
    >
      {/* Format */}
      <div style={cellStyle}>
        <span style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
          {format}
        </span>
      </div>

      {/* Status — text + colour (AC-10) */}
      <div style={cellStyle}>
        <StatusBadge status={status} />
      </div>

      {/* Row count */}
      <div style={{ ...cellStyle, color: 'var(--color-text-secondary, #6b7280)', fontSize: '0.75rem' }}>
        {rowCount != null ? rowCount.toLocaleString() + ' rows' : '—'}
      </div>

      {/* Size */}
      <div style={{ ...cellStyle, color: 'var(--color-text-secondary, #6b7280)', fontSize: '0.75rem' }}>
        {fileSizeBytes != null ? formatBytes(fileSizeBytes) : '—'}
      </div>

      {/* Created */}
      <div style={{ ...cellStyle, color: 'var(--color-text-secondary, #6b7280)', fontSize: '0.75rem' }}>
        {createdDate}
      </div>

      {/* Expiry */}
      <div style={{ ...cellStyle, fontSize: '0.75rem' }}>
        {expiryText ? (
          <span
            title={expiryText.absolute}
            style={{ color: isExpired ? 'var(--color-error, #dc2626)' : 'var(--color-text-secondary, #6b7280)' }}
          >
            {expiryText.relative}
          </span>
        ) : '—'}
      </div>

      {/* Actions */}
      <div style={{ ...cellStyle, gap: 6, display: 'flex', alignItems: 'center' }}>
        {/* Download — only for completed, unexpired (AC-3, AC-5) */}
        {isCompleted && (
          <button
            type="button"
            style={actionBtn}
            onClick={handleDownload}
            disabled={downloadExport.isPending}
            aria-label="Download export file"
          >
            {downloadExport.isPending ? '…' : '↓ Download'}
          </button>
        )}

        {/* Re-run — expired jobs (AC-6) */}
        {isExpired && (
          <button
            type="button"
            style={actionBtn}
            onClick={handleRetry}
            disabled={createExport.isPending}
            aria-label="Re-run this export with the same definition"
          >
            ↺ Re-run
          </button>
        )}

        {/* Retry — failed jobs (AC-7) */}
        {isFailed && (
          <button
            type="button"
            style={actionBtn}
            onClick={handleRetry}
            disabled={createExport.isPending}
            aria-label="Retry this export"
          >
            ↺ Retry
          </button>
        )}

        {/* Dismiss terminal jobs */}
        {isTerminalStatus(status) && onRemove && (
          <button
            type="button"
            onClick={() => onRemove(id)}
            aria-label="Dismiss this job"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '0.875rem',
              color: 'var(--color-text-secondary, #9ca3af)',
              padding: '0 2px',
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* Error row (AC-7) */}
      {isFailed && (
        <div
          style={{
            gridColumn: '1 / -1',
            marginTop: 4,
            padding: '6px 8px',
            background: 'var(--color-error-bg, #fef2f2)',
            borderRadius: 4,
            fontSize: '0.75rem',
            color: 'var(--color-error, #991b1b)',
          }}
          role="note"
          aria-label={`Error details for this export job`}
        >
          <span>{getExportErrorCopy(errorCode)}</span>
          {traceId && (
            <span style={{ marginLeft: 8, color: 'var(--color-text-secondary, #6b7280)' }}>
              Trace:{' '}
              <code style={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>{traceId}</code>
              {' '}
              <button
                type="button"
                onClick={handleCopyTrace}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.7rem',
                  color: 'var(--color-primary, #2563eb)',
                  padding: 0,
                }}
                aria-label="Copy trace ID to clipboard"
              >
                {copyConfirm ? '✓ Copied' : 'Copy'}
              </button>
            </span>
          )}
        </div>
      )}

      {/* Download error */}
      {downloadExport.isError && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            gridColumn: '1 / -1',
            fontSize: '0.75rem',
            color: 'var(--color-error, #dc2626)',
            marginTop: 4,
          }}
        >
          {getExportErrorCopy(
            (downloadExport.error as { code?: string } | null)?.code,
          )}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '3rem 6rem 6rem 5rem 8rem 7rem 1fr',
  gap: '0 8px',
  alignItems: 'center',
  padding: '6px 8px',
  borderRadius: 4,
  listStyle: 'none',
};

const cellStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
};
