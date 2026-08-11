'use client';

/**
 * RemindersPanel — two threshold sliders, on-call routing, channel toggles.
 *
 * Enforces: first < second < 100 both interactively and on submit (AC-5).
 * PagerDuty is presented as a webhook target (no separate PagerDuty integration).
 */

import React from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import type { SlaPolicyFormValues } from '@/lib/api/sla/types';
import { Slider } from '@opsninja/ui-kit';
import { Toggle } from '@opsninja/ui-kit';

interface RemindersPanelProps {
  form: UseFormReturn<SlaPolicyFormValues>;
  disabled?: boolean;
}

export function RemindersPanel({ form, disabled }: RemindersPanelProps) {
  const { control, watch, formState: { errors } } = form;
  const [first, second] = watch(['firstReminderPct', 'secondReminderPct']);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Threshold sliders */}
      <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-fg-primary, #111827)', marginBottom: 12 }}>
          Reminder Thresholds
        </legend>
        <p style={{ fontSize: 12, color: 'var(--color-fg-secondary, #6b7280)', marginBottom: 16 }}>
          Reminders are sent when SLA elapsed time reaches these percentages of the target.
        </p>

        {/* First threshold */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <label htmlFor="first-reminder" style={{ fontSize: 13, fontWeight: 500 }}>
              First reminder
            </label>
            <span
              aria-live="polite"
              aria-atomic="true"
              style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-warning, #b45309)' }}
            >
              {first}%
            </span>
          </div>
          <Controller
            name="firstReminderPct"
            control={control}
            rules={{
              min: { value: 1, message: 'Must be at least 1%' },
              max: { value: 98, message: 'Must be less than second reminder' },
            }}
            render={({ field }) => (
              <Slider
                id="first-reminder"
                value={field.value}
                onChange={field.onChange}
                min={1}
                max={99}
                step={1}
                disabled={disabled}
                aria-label={`First reminder at ${field.value}%`}
              />
            )}
          />
          {errors.firstReminderPct && (
            <p role="alert" style={{ fontSize: 11, color: 'var(--color-error, #ef4444)', marginTop: 4 }}>
              {errors.firstReminderPct.message}
            </p>
          )}
        </div>

        {/* Second threshold */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <label htmlFor="second-reminder" style={{ fontSize: 13, fontWeight: 500 }}>
              Second reminder
            </label>
            <span
              aria-live="polite"
              aria-atomic="true"
              style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-error, #dc2626)' }}
            >
              {second}%
            </span>
          </div>
          <Controller
            name="secondReminderPct"
            control={control}
            rules={{
              min: { value: 2, message: 'Must be greater than first reminder' },
              max: { value: 99, message: 'Must be less than 100%' },
              validate: {
                greaterThanFirst: (v) =>
                  v > first || `Second reminder (${v}%) must be greater than first reminder (${first}%)`,
              },
            }}
            render={({ field }) => (
              <Slider
                id="second-reminder"
                value={field.value}
                onChange={field.onChange}
                min={2}
                max={99}
                step={1}
                disabled={disabled}
                aria-label={`Second reminder at ${field.value}%`}
                aria-describedby={errors.secondReminderPct ? 'second-reminder-error' : undefined}
              />
            )}
          />
          {errors.secondReminderPct && (
            <p id="second-reminder-error" role="alert" style={{ fontSize: 11, color: 'var(--color-error, #ef4444)', marginTop: 4 }}>
              {errors.secondReminderPct.message}
            </p>
          )}
        </div>
      </fieldset>

      {/* On-call routing */}
      <div>
        <label
          htmlFor="oncall-routing"
          style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-fg-primary, #111827)', marginBottom: 6 }}
        >
          On-Call Routing
        </label>
        <select
          id="oncall-routing"
          disabled={disabled}
          style={{
            width: '100%',
            maxWidth: 360,
            padding: '7px 10px',
            borderRadius: 6,
            border: '1px solid var(--color-border, #e5e7eb)',
            fontSize: 14,
            background: disabled ? 'var(--color-surface-2, #f3f4f6)' : 'var(--color-bg-card, #fff)',
          }}
          {...form.register('onCallRoutingId')}
        >
          <option value="">— None —</option>
          <option value="primary-oncall">Primary On-Call</option>
          <option value="secondary-oncall">Secondary On-Call</option>
        </select>
      </div>

      {/* Notification channels */}
      <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-fg-primary, #111827)', marginBottom: 12 }}>
          Notification Channels
        </legend>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Controller
            name="channelEmail"
            control={control}
            render={({ field }) => (
              <Toggle
                checked={field.value}
                onChange={field.onChange}
                disabled={disabled}
                label="Email"
                aria-label="Enable email notifications"
              />
            )}
          />
          <Controller
            name="channelWebhook"
            control={control}
            render={({ field }) => (
              <Toggle
                checked={field.value}
                onChange={field.onChange}
                disabled={disabled}
                label="Webhook"
                aria-label="Enable webhook notifications"
              />
            )}
          />
          <Controller
            name="channelPagerDuty"
            control={control}
            render={({ field }) => (
              <Toggle
                checked={field.value}
                onChange={field.onChange}
                disabled={disabled}
                label="PagerDuty (via webhook)"
                aria-label="Enable PagerDuty notifications via webhook"
              />
            )}
          />
        </div>
      </fieldset>
    </div>
  );
}
