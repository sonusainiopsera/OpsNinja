'use client';

/**
 * PreviewPanel — live SLA timeline preview.
 *
 * Reuses the shared SlaTimeline from @opsninja/ui-kit.
 * Recomputes markers locally as targets and thresholds change — no server round trip.
 */

import React from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { SlaPolicyFormValues, SlaPriority } from '../../../../lib/api/sla/types';
import { SlaTimeline } from '@opsninja/ui-kit';

const PRIORITIES: { priority: SlaPriority; label: string }[] = [
  { priority: 'P1', label: 'P1 — Critical' },
  { priority: 'P2', label: 'P2 — High' },
  { priority: 'P3', label: 'P3 — Medium' },
  { priority: 'P4', label: 'P4 — Low' },
];

interface PreviewPanelProps {
  form: UseFormReturn<SlaPolicyFormValues>;
}

export function PreviewPanel({ form }: PreviewPanelProps) {
  const { watch } = form;
  const [targets, firstReminderPct, secondReminderPct] = watch([
    'targets',
    'firstReminderPct',
    'secondReminderPct',
  ]);

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--color-fg-secondary, #6b7280)', marginBottom: 20 }}>
        Preview shows how reminders are positioned relative to each priority target. Markers update live as you adjust targets and thresholds.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {PRIORITIES.map(({ priority, label }, index) => {
          const target = targets[index];
          const resMinutes = target?.resolutionMinutes ?? 0;

          return (
            <section key={priority} aria-label={`${label} SLA preview`}>
              <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--color-fg-primary, #111827)' }}>
                {label}
                {resMinutes > 0 && (
                  <span style={{ fontWeight: 400, color: 'var(--color-fg-secondary, #6b7280)', marginLeft: 8 }}>
                    ({resMinutes} min resolution target)
                  </span>
                )}
              </h3>
              <SlaTimeline
                firstReminderPct={firstReminderPct ?? 50}
                secondReminderPct={secondReminderPct ?? 75}
                targetMinutes={resMinutes > 0 ? resMinutes : 60}
              />
            </section>
          );
        })}
      </div>

      <p style={{ fontSize: 11, color: 'var(--color-fg-secondary, #6b7280)', marginTop: 16 }}>
        <strong>Note:</strong> Preview uses resolution minutes. Response reminder times are proportionally identical.
      </p>
    </div>
  );
}
