'use client';

/**
 * ScheduleModal — modal for creating recurring export schedules (WO-079 AC-8).
 *
 * AC-8:  Collects cadence (daily/weekly/monthly/custom), timezone, format,
 *        recipients. Validates recipients client-side for shape. Maps server
 *        422 RECIPIENT_DOMAIN_NOT_ALLOWED and SCHEDULE_INTERVAL_TOO_SHORT
 *        inline against the offending field.
 * AC-10: Focus trap; labelled controls; keyboard-accessible.
 *
 * Uses react-hook-form + zod resolver.
 */

import React, { useEffect, useRef } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { CreateExportPayload } from '../../../lib/api/reporting/types';
import { ReportingApiError } from '../../../lib/api/reporting/types';

// ---------------------------------------------------------------------------
// Zod schema — mirrors the server schedule DTO
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Minimum cadence interval the server allows: 1 hour = 3600 seconds. */
const CUSTOM_CRON_MIN_INTERVAL_NOTE =
  'Custom cadences must have a minimum interval of 1 hour (e.g. 0 * * * *).';

export const scheduleSchema = z
  .object({
    cadence: z.enum(['daily', 'weekly', 'monthly', 'custom'], {
      required_error: 'Cadence is required.',
    }),
    cronExpression: z.string().optional(),
    timezone: z.string().min(1, 'Timezone is required.'),
    format: z.enum(['csv', 'pdf']),
    recipientsRaw: z
      .string()
      .min(1, 'At least one recipient email is required.')
      .refine(
        (val) =>
          val
            .split(/[\s,]+/)
            .filter(Boolean)
            .every((e) => EMAIL_RE.test(e)),
        { message: 'All recipients must be valid email addresses.' },
      ),
  })
  .superRefine((data, ctx) => {
    if (data.cadence === 'custom' && !data.cronExpression?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cronExpression'],
        message: 'A cron expression is required for custom cadence.',
      });
    }
  });

type ScheduleFormValues = z.infer<typeof scheduleSchema>;

// ---------------------------------------------------------------------------
// Server-error field map
// ---------------------------------------------------------------------------

const SERVER_FIELD_MAP: Record<string, keyof ScheduleFormValues | 'root'> = {
  RECIPIENT_DOMAIN_NOT_ALLOWED: 'recipientsRaw',
  SCHEDULE_INTERVAL_TOO_SHORT: 'cadence',
};

// ---------------------------------------------------------------------------
// Timezone list (abbreviated — server validates fully)
// ---------------------------------------------------------------------------

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
  zIndex: 500,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const dialogStyle: React.CSSProperties = {
  background: 'var(--color-surface, #fff)',
  borderRadius: 'var(--radius-lg, 12px)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
  width: 480,
  maxWidth: '95vw',
  maxHeight: '90vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8rem',
  fontWeight: 600,
  marginBottom: 4,
  color: 'var(--color-text-secondary, #374151)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  borderRadius: 6,
  border: '1px solid var(--color-border, #d1d5db)',
  fontSize: '0.875rem',
  background: 'var(--color-bg-input, #fff)',
  color: 'var(--color-text-primary, #111827)',
  boxSizing: 'border-box',
};

const errorStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--color-error, #dc2626)',
  marginTop: 3,
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ScheduleModalProps {
  definition?: CreateExportPayload['definition'];
  definitionId?: string;
  onClose: () => void;
  onScheduled?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScheduleModal({
  definition,
  definitionId,
  onClose,
  onScheduled,
}: ScheduleModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ScheduleFormValues>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: {
      cadence: 'daily',
      timezone: 'UTC',
      format: 'csv',
      recipientsRaw: '',
    },
  });

  const cadence = watch('cadence');

  // Focus trap — move focus to dialog on open
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // Keyboard: Escape closes the modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Focus trap: keep focus within dialog
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const nodes = Array.from(dialog.querySelectorAll<HTMLElement>(focusable));
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    dialog.addEventListener('keydown', handler);
    return () => dialog.removeEventListener('keydown', handler);
  }, []);

  const onSubmit = async (values: ScheduleFormValues) => {
    const recipients = values.recipientsRaw.split(/[\s,]+/).filter(Boolean);
    const payload = {
      cadence: values.cadence,
      ...(values.cadence === 'custom' ? { cronExpression: values.cronExpression } : {}),
      timezone: values.timezone,
      format: values.format,
      recipients,
      ...(definitionId ? { definitionId } : { definition }),
    };

    try {
      const res = await fetch('/api/v1/schedules', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let body: unknown;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        const env = body as {
          error?: {
            code?: string;
            message?: string;
            details?: Array<{ code: string; field?: string; message: string }>;
          };
        } | null;

        const code = env?.error?.code;
        // Map server 422 details to fields (AC-8)
        if (res.status === 422 && env?.error?.details?.length) {
          for (const detail of env.error.details) {
            const field = SERVER_FIELD_MAP[detail.code] ?? 'root';
            if (field === 'root') {
              setError('root' as keyof ScheduleFormValues, { message: detail.message });
            } else {
              setError(field, { message: detail.message });
            }
          }
          return;
        }
        // Single-code errors
        if (code && SERVER_FIELD_MAP[code]) {
          const field = SERVER_FIELD_MAP[code]!;
          if (field !== 'root') {
            setError(field, {
              message:
                code === 'RECIPIENT_DOMAIN_NOT_ALLOWED'
                  ? 'One or more recipient domains are not allowed for this tenant.'
                  : 'Schedule interval is too short — minimum is 1 hour.',
            });
            return;
          }
        }
        throw new ReportingApiError(
          res.status,
          code ?? 'UNKNOWN',
          env?.error?.message ?? `HTTP ${res.status}`,
        );
      }

      onScheduled?.();
      onClose();
    } catch (err) {
      const msg =
        err instanceof ReportingApiError
          ? err.message
          : 'Failed to create schedule. Please try again.';
      setError('root' as keyof ScheduleFormValues, { message: msg });
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="schedule-modal-title"
      style={overlayStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={dialogRef} style={dialogStyle}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--color-border, #e5e7eb)',
          }}
        >
          <h2
            id="schedule-modal-title"
            style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}
          >
            Schedule Recurring Export
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close schedule modal"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '1.25rem',
              color: 'var(--color-text-secondary, #6b7280)',
              lineHeight: 1,
              padding: '4px 6px',
            }}
          >
            ×
          </button>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          style={{
            padding: '20px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          {/* Root error */}
          {errors.root && (
            <div
              role="alert"
              aria-live="polite"
              style={{
                padding: '8px 12px',
                background: 'var(--color-error-bg, #fef2f2)',
                border: '1px solid var(--color-error, #fca5a5)',
                borderRadius: 6,
                fontSize: '0.8rem',
                color: 'var(--color-error, #991b1b)',
              }}
            >
              {errors.root.message}
            </div>
          )}

          {/* Cadence */}
          <div>
            <label htmlFor="schedule-cadence" style={labelStyle}>
              Cadence <span aria-hidden="true">*</span>
            </label>
            <select
              id="schedule-cadence"
              {...register('cadence')}
              aria-required="true"
              aria-describedby={errors.cadence ? 'cadence-err' : undefined}
              aria-invalid={!!errors.cadence}
              style={inputStyle}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="custom">Custom (cron)</option>
            </select>
            {errors.cadence && (
              <span id="cadence-err" role="alert" style={errorStyle}>
                {errors.cadence.message}
              </span>
            )}
          </div>

          {/* Cron expression (only for custom) */}
          {cadence === 'custom' && (
            <div>
              <label htmlFor="schedule-cron" style={labelStyle}>
                Cron expression <span aria-hidden="true">*</span>
              </label>
              <input
                id="schedule-cron"
                type="text"
                placeholder="0 9 * * 1-5"
                {...register('cronExpression')}
                aria-required="true"
                aria-describedby="cron-hint cron-err"
                aria-invalid={!!errors.cronExpression}
                style={inputStyle}
              />
              <span
                id="cron-hint"
                style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary, #6b7280)' }}
              >
                {CUSTOM_CRON_MIN_INTERVAL_NOTE}
              </span>
              {errors.cronExpression && (
                <span id="cron-err" role="alert" style={errorStyle}>
                  {errors.cronExpression.message}
                </span>
              )}
            </div>
          )}

          {/* Timezone */}
          <div>
            <label htmlFor="schedule-timezone" style={labelStyle}>
              Timezone <span aria-hidden="true">*</span>
            </label>
            <select
              id="schedule-timezone"
              {...register('timezone')}
              aria-required="true"
              style={inputStyle}
            >
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
            {errors.timezone && (
              <span role="alert" style={errorStyle}>
                {errors.timezone.message}
              </span>
            )}
          </div>

          {/* Format */}
          <div>
            <label htmlFor="schedule-format" style={labelStyle}>
              Format <span aria-hidden="true">*</span>
            </label>
            <select
              id="schedule-format"
              {...register('format')}
              aria-required="true"
              style={inputStyle}
            >
              <option value="csv">CSV</option>
              <option value="pdf">PDF</option>
            </select>
          </div>

          {/* Recipients */}
          <div>
            <label htmlFor="schedule-recipients" style={labelStyle}>
              Recipients <span aria-hidden="true">*</span>
            </label>
            <textarea
              id="schedule-recipients"
              rows={3}
              placeholder="user@example.com, another@example.com"
              {...register('recipientsRaw')}
              aria-required="true"
              aria-describedby="recipients-hint recipients-err"
              aria-invalid={!!errors.recipientsRaw}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            />
            <span
              id="recipients-hint"
              style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary, #6b7280)' }}
            >
              Comma or newline separated email addresses.
            </span>
            {errors.recipientsRaw && (
              <span id="recipients-err" role="alert" style={errorStyle}>
                {errors.recipientsRaw.message}
              </span>
            )}
          </div>

          {/* Actions */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '0.5rem',
              paddingTop: '0.5rem',
              borderTop: '1px solid var(--color-border, #e5e7eb)',
              marginTop: '0.5rem',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: 6,
                border: '1px solid var(--color-border, #d1d5db)',
                background: 'var(--color-surface, #fff)',
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                padding: '0.5rem 1.25rem',
                borderRadius: 6,
                border: 'none',
                background: isSubmitting
                  ? 'var(--color-bg-alt, #e5e7eb)'
                  : 'var(--color-primary, #2563eb)',
                color: isSubmitting ? 'var(--color-text-secondary, #6b7280)' : '#fff',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                fontSize: '0.875rem',
              }}
            >
              {isSubmitting ? 'Scheduling…' : 'Create Schedule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
