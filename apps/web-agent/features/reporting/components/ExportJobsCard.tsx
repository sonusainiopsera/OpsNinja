'use client';

/**
 * ExportJobsCard — tray listing recent export jobs (WO-079).
 *
 * AC-3:  Lists jobs newest first: format, status, row count, human-readable
 *        byte size, created time, relative expiry, Download (completed/unexpired).
 * AC-4:  Polling with tiered backoff handled inside useExportJobs.
 * AC-10: aria-live polite region announces transitions to completed or failed.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useExportJobs } from '../api/export.queries';
import { JobRow } from './JobRow';
import type { ExportJob } from '../../../lib/api/reporting/types';
import type { OptimisticExportJob } from '../api/export.queries';
import { isTerminalStatus } from '../api/export.queries';

// ---------------------------------------------------------------------------
// Announcement helper — detects status transitions and announces them
// ---------------------------------------------------------------------------

function useStatusAnnouncements(
  jobs: Array<ExportJob | OptimisticExportJob>,
): string {
  const prevStatusRef = useRef<Map<string, string>>(new Map());
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const next = new Map<string, string>();
    let msg = '';

    for (const job of jobs) {
      if (!('id' in job)) continue; // skip optimistic
      const real = job as ExportJob;
      const prev = prevStatusRef.current.get(real.id);
      next.set(real.id, real.status);

      if (prev && prev !== real.status) {
        if (real.status === 'completed') {
          msg = `Export completed — ${real.format.toUpperCase()} file is ready to download.`;
        } else if (real.status === 'failed') {
          msg = `Export failed — ${real.format.toUpperCase()} job encountered an error.`;
        } else if (real.status === 'expired') {
          msg = `Export expired — the ${real.format.toUpperCase()} download link is no longer available.`;
        }
      }
    }

    prevStatusRef.current = next;
    if (msg) setAnnouncement(msg);
  }, [jobs]);

  return announcement;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ExportJobsCardProps {
  /** Controls whether the card is shown at all when empty. */
  hideWhenEmpty?: boolean;
}

export function ExportJobsCard({ hideWhenEmpty = false }: ExportJobsCardProps) {
  const { jobs, isLoading, hasStuckJob, removeJob } = useExportJobs();
  const announcement = useStatusAnnouncements(jobs);

  if (hideWhenEmpty && jobs.length === 0 && !isLoading) {
    return null;
  }

  return (
    <section
      aria-label="Export jobs"
      style={{
        border: '1px solid var(--color-border, #e5e7eb)',
        borderRadius: 'var(--radius-md, 8px)',
        background: 'var(--color-surface, #fff)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid var(--color-border, #e5e7eb)',
          background: 'var(--color-bg-alt, #f9fafb)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>
          Exports
          {jobs.length > 0 && (
            <span
              aria-label={`${jobs.length} job${jobs.length !== 1 ? 's' : ''}`}
              style={{
                marginLeft: 6,
                fontSize: '0.7rem',
                fontWeight: 500,
                color: 'var(--color-text-secondary, #6b7280)',
              }}
            >
              ({jobs.length})
            </span>
          )}
        </h2>
        {isLoading && (
          <span
            aria-label="Loading export jobs"
            style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary, #6b7280)' }}
          >
            Loading…
          </span>
        )}
      </div>

      {/* Stuck-job support notice */}
      {hasStuckJob && (
        <div
          role="alert"
          style={{
            padding: '8px 12px',
            background: 'var(--color-warning-bg, #fffbeb)',
            borderBottom: '1px solid var(--color-border, #e5e7eb)',
            fontSize: '0.8rem',
            color: 'var(--color-warning-fg, #92400e)',
          }}
        >
          One or more exports are taking longer than expected.{' '}
          <a
            href="mailto:support@opsninja.io"
            style={{ color: 'inherit', textDecoration: 'underline' }}
          >
            Contact support
          </a>{' '}
          if this persists.
        </div>
      )}

      {/* aria-live polite region for status transitions (AC-10) */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {announcement}
      </div>

      {/* Empty state */}
      {jobs.length === 0 && !isLoading && (
        <p
          style={{
            margin: 0,
            padding: '16px 12px',
            textAlign: 'center',
            color: 'var(--color-text-secondary, #6b7280)',
            fontSize: '0.8rem',
          }}
        >
          No exports yet. Click Export CSV or Export PDF above to start.
        </p>
      )}

      {/* Column headers */}
      {jobs.length > 0 && (
        <div
          aria-hidden="true"
          style={{
            display: 'grid',
            gridTemplateColumns: '3rem 6rem 6rem 5rem 8rem 7rem 1fr',
            gap: '0 8px',
            padding: '4px 8px',
            borderBottom: '1px solid var(--color-border, #e5e7eb)',
            fontSize: '0.7rem',
            fontWeight: 600,
            color: 'var(--color-text-secondary, #9ca3af)',
            textTransform: 'uppercase',
            letterSpacing: '0.03em',
          }}
        >
          <span>Type</span>
          <span>Status</span>
          <span>Rows</span>
          <span>Size</span>
          <span>Created</span>
          <span>Expiry</span>
          <span>Actions</span>
        </div>
      )}

      {/* Job rows */}
      {jobs.length > 0 && (
        <ul
          aria-label="Export job list"
          style={{
            margin: 0,
            padding: '4px 0',
            listStyle: 'none',
            maxHeight: 320,
            overflowY: 'auto',
          }}
        >
          {jobs.map((job) => {
            const key = 'id' in job ? job.id : job.tempId;
            return (
              <JobRow
                key={key}
                job={job}
                onRemove={removeJob}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
