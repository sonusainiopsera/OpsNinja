'use client';

/**
 * TargetsPanel — P1–P4 response and resolution minute inputs.
 *
 * Rejects: non-integer, zero, negative, above-43200 values with inline errors.
 */

import React from 'react';
import type { UseFormReturn, FieldError } from 'react-hook-form';
import type { SlaPolicyFormValues, SlaPriority } from '../../../../lib/api/sla/types';

const PRIORITIES: SlaPriority[] = ['P1', 'P2', 'P3', 'P4'];

const PRIORITY_LABELS: Record<SlaPriority, string> = {
  P1: 'P1 — Critical',
  P2: 'P2 — High',
  P3: 'P3 — Medium',
  P4: 'P4 — Low',
};

interface PriorityTargetRowProps {
  index: number;
  priority: SlaPriority;
  form: UseFormReturn<SlaPolicyFormValues>;
  disabled?: boolean;
}

function PriorityTargetRow({ index, priority, form, disabled }: PriorityTargetRowProps) {
  const { register, formState: { errors } } = form;
  const rowErrors = errors.targets?.[index];

  function parseMinutes(value: string): number {
    const n = parseFloat(value);
    return isNaN(n) ? 0 : n;
  }

  return (
    <div
      role="row"
      style={{
        display: 'grid',
        gridTemplateColumns: '140px 1fr 1fr',
        gap: 12,
        alignItems: 'start',
        paddingBottom: 12,
        borderBottom: '1px solid var(--color-border, #e5e7eb)',
        marginBottom: 12,
      }}
    >
      {/* Priority label */}
      <div
        role="rowheader"
        style={{
          fontWeight: 600,
          fontSize: 13,
          color: 'var(--color-fg-primary, #111827)',
          paddingTop: 8,
        }}
      >
        {PRIORITY_LABELS[priority]}
      </div>

      {/* Response minutes */}
      <div>
        <label htmlFor={`targets-${index}-response`} style={{ fontSize: 12, color: 'var(--color-fg-secondary, #6b7280)', display: 'block', marginBottom: 4 }}>
          Response (minutes)
        </label>
        <input
          id={`targets-${index}-response`}
          type="number"
          min={1}
          max={43200}
          step={1}
          disabled={disabled}
          aria-invalid={Boolean(rowErrors?.responseMinutes)}
          aria-describedby={rowErrors?.responseMinutes ? `targets-${index}-response-error` : undefined}
          style={{
            width: '100%',
            padding: '6px 10px',
            borderRadius: 6,
            border: rowErrors?.responseMinutes
              ? '1px solid var(--color-error, #ef4444)'
              : '1px solid var(--color-border, #e5e7eb)',
            fontSize: 14,
            background: disabled ? 'var(--color-surface-2, #f3f4f6)' : 'var(--color-bg-card, #fff)',
          }}
          {...register(`targets.${index}.responseMinutes`, {
            valueAsNumber: true,
            validate: {
              positive: (v) => v > 0 || 'Must be greater than 0',
              integer: (v) => Number.isInteger(v) || 'Must be a whole number',
              max: (v) => v <= 43200 || 'Cannot exceed 43,200 minutes',
            },
          })}
        />
        {rowErrors?.responseMinutes && (
          <p id={`targets-${index}-response-error`} role="alert" style={{ fontSize: 11, color: 'var(--color-error, #ef4444)', marginTop: 2 }}>
            {(rowErrors.responseMinutes as FieldError).message}
          </p>
        )}
      </div>

      {/* Resolution minutes */}
      <div>
        <label htmlFor={`targets-${index}-resolution`} style={{ fontSize: 12, color: 'var(--color-fg-secondary, #6b7280)', display: 'block', marginBottom: 4 }}>
          Resolution (minutes)
        </label>
        <input
          id={`targets-${index}-resolution`}
          type="number"
          min={1}
          max={43200}
          step={1}
          disabled={disabled}
          aria-invalid={Boolean(rowErrors?.resolutionMinutes)}
          aria-describedby={rowErrors?.resolutionMinutes ? `targets-${index}-resolution-error` : undefined}
          style={{
            width: '100%',
            padding: '6px 10px',
            borderRadius: 6,
            border: rowErrors?.resolutionMinutes
              ? '1px solid var(--color-error, #ef4444)'
              : '1px solid var(--color-border, #e5e7eb)',
            fontSize: 14,
            background: disabled ? 'var(--color-surface-2, #f3f4f6)' : 'var(--color-bg-card, #fff)',
          }}
          {...register(`targets.${index}.resolutionMinutes`, {
            valueAsNumber: true,
            validate: {
              positive: (v) => v > 0 || 'Must be greater than 0',
              integer: (v) => Number.isInteger(v) || 'Must be a whole number',
              max: (v) => v <= 43200 || 'Cannot exceed 43,200 minutes',
            },
          })}
        />
        {rowErrors?.resolutionMinutes && (
          <p id={`targets-${index}-resolution-error`} role="alert" style={{ fontSize: 11, color: 'var(--color-error, #ef4444)', marginTop: 2 }}>
            {(rowErrors.resolutionMinutes as FieldError).message}
          </p>
        )}
      </div>
    </div>
  );
}

interface TargetsPanelProps {
  form: UseFormReturn<SlaPolicyFormValues>;
  disabled?: boolean;
}

export function TargetsPanel({ form, disabled }: TargetsPanelProps) {
  return (
    <div role="table" aria-label="Priority target inputs">
      <div role="rowgroup">
        {PRIORITIES.map((priority, index) => (
          <PriorityTargetRow
            key={priority}
            index={index}
            priority={priority}
            form={form}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  );
}
