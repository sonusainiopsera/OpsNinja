'use client';

/**
 * CalendarPanel — calendar selection and pause-condition checkboxes.
 *
 * Blocks business-hours selection when no calendar exists (AC-4).
 */

import React from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { SlaPolicyFormValues } from '@/lib/api/sla/types';
import { useSlaCalendars } from '@/lib/api/sla/hooks';
import { PAUSE_CONDITIONS } from '@/lib/api/sla/types';

interface CalendarPanelProps {
  form: UseFormReturn<SlaPolicyFormValues>;
  disabled?: boolean;
}

export function CalendarPanel({ form, disabled }: CalendarPanelProps) {
  const { data: calendars = [], isLoading } = useSlaCalendars();
  const { register, watch, formState: { errors } } = form;
  const selectedCalendarId = watch('calendarId');

  const selectedCalendar = calendars.find((c) => c.id === selectedCalendarId);
  const noCalendars = !isLoading && calendars.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Calendar selector */}
      <div>
        <label
          htmlFor="calendar-select"
          style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-fg-primary, #111827)', marginBottom: 6 }}
        >
          Business Calendar
        </label>

        {noCalendars ? (
          <div
            role="alert"
            style={{
              padding: '10px 14px',
              borderRadius: 6,
              background: 'var(--color-warning-surface, #fef3c7)',
              color: 'var(--color-warning, #92400e)',
              fontSize: 13,
            }}
          >
            No calendars configured.{' '}
            <a href="/settings/calendars" style={{ color: 'inherit', fontWeight: 600 }}>
              Create a calendar
            </a>{' '}
            to enable business-hours SLA tracking.
          </div>
        ) : (
          <select
            id="calendar-select"
            disabled={disabled || isLoading}
            aria-invalid={Boolean(errors.calendarId)}
            style={{
              width: '100%',
              maxWidth: 360,
              padding: '7px 10px',
              borderRadius: 6,
              border: errors.calendarId
                ? '1px solid var(--color-error, #ef4444)'
                : '1px solid var(--color-border, #e5e7eb)',
              fontSize: 14,
              background: disabled ? 'var(--color-surface-2, #f3f4f6)' : 'var(--color-bg-card, #fff)',
            }}
            {...register('calendarId')}
          >
            <option value="">— No calendar (24×7) —</option>
            {calendars.map((cal) => (
              <option key={cal.id} value={cal.id}>
                {cal.name} ({cal.calendarType === 'business_hours' ? 'Business hours' : '24×7'})
              </option>
            ))}
          </select>
        )}

        {selectedCalendar && (
          <p style={{ fontSize: 12, color: 'var(--color-fg-secondary, #6b7280)', marginTop: 4 }}>
            Timezone: {selectedCalendar.timezone}
          </p>
        )}
      </div>

      {/* Pause conditions */}
      <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-fg-primary, #111827)', marginBottom: 10 }}>
          Pause Conditions
        </legend>
        <p style={{ fontSize: 12, color: 'var(--color-fg-secondary, #6b7280)', marginBottom: 12 }}>
          The SLA clock pauses when a ticket enters one of these statuses.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PAUSE_CONDITIONS.map(({ value, label }) => (
            <label
              key={value}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 14,
                cursor: disabled ? 'not-allowed' : 'pointer',
                color: disabled ? 'var(--color-fg-disabled, #9ca3af)' : 'var(--color-fg-primary, #111827)',
              }}
            >
              <input
                type="checkbox"
                value={value}
                disabled={disabled}
                style={{ width: 16, height: 16, accentColor: 'var(--color-primary, #4f46e5)' }}
                {...register('pauseConditions')}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
