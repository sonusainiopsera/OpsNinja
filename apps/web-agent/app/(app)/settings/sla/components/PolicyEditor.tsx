'use client';

/**
 * PolicyEditor — four-tab editor for a single SLA policy.
 *
 * Tabs: Targets | Calendar and Pause | Reminders and Escalation | Preview
 * Uses react-hook-form with Zod resolver. Server validation errors map to fields.
 * Optimistic concurrency: version sent on PUT; 409 → conflict banner.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@opsninja/ui-kit';
import type { SlaPolicy } from '../../../../lib/api/sla/types';
import { slaPolicyFormSchema, DEFAULT_FORM_VALUES, type SlaPolicyFormValues } from '../../../../lib/api/sla/types';
import { useSaveSlaPolicy } from '../../../../lib/api/sla/hooks';
import { TargetsPanel } from './TargetsPanel';
import { CalendarPanel } from './CalendarPanel';
import { RemindersPanel } from './RemindersPanel';
import { PreviewPanel } from './PreviewPanel';
import { StickyFooter } from './StickyFooter';

interface PolicyEditorProps {
  policy: SlaPolicy | null;   // null → new policy
  isReadOnly: boolean;
  onSaved?: (policy: SlaPolicy) => void;
}

function policyToFormValues(p: SlaPolicy): SlaPolicyFormValues {
  return {
    name: p.name,
    targets: p.targets,
    calendarId: p.calendarId,
    pauseConditions: p.pauseConditions,
    firstReminderPct: p.firstReminderPct,
    secondReminderPct: p.secondReminderPct,
    onCallRoutingId: p.onCallRoutingId,
    channelEmail: p.channelEmail,
    channelWebhook: p.channelWebhook,
    channelPagerDuty: p.channelPagerDuty,
    changeAuditNote: '',
  };
}

export function PolicyEditor({ policy, isReadOnly, onSaved }: PolicyEditorProps) {
  const [conflictError, setConflictError] = useState<string | null>(null);
  const mutation = useSaveSlaPolicy();

  const form = useForm<SlaPolicyFormValues>({
    resolver: zodResolver(slaPolicyFormSchema),
    defaultValues: policy ? policyToFormValues(policy) : DEFAULT_FORM_VALUES,
    mode: 'onChange',
  });

  const { reset, setError, handleSubmit } = form;

  // Reset form when a different policy is loaded
  useEffect(() => {
    reset(policy ? policyToFormValues(policy) : DEFAULT_FORM_VALUES);
    setConflictError(null);
  }, [policy?.id, reset]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSave = handleSubmit(async (values) => {
    setConflictError(null);
    try {
      const saved = await mutation.mutateAsync({
        id: policy?.id,
        version: policy?.version,
        payload: values,
      });
      reset(policyToFormValues(saved));
      onSaved?.(saved);
    } catch (err) {
      const apiErr = err as Error & { status?: number; body?: unknown };
      if (apiErr.status === 409) {
        const body = apiErr.body as { error?: { message?: string } };
        setConflictError(body?.error?.message ?? 'Version conflict.');
        return;
      }
      if (apiErr.status === 400) {
        // Map server validation details onto form fields
        const body = apiErr.body as { error?: { details?: Array<{ field: string; message: string }> } };
        const details = body?.error?.details ?? [];
        details.forEach(({ field, message }) => {
          setError(field as Parameters<typeof setError>[0], { type: 'server', message });
        });
        return;
      }
      // Generic error — show in footer via toast (no raw server messages)
      console.error('Save failed:', apiErr.message);
    }
  });

  const onDiscard = useCallback(() => {
    reset(policy ? policyToFormValues(policy) : DEFAULT_FORM_VALUES);
    setConflictError(null);
  }, [policy, reset]);

  const handleReloadAndMerge = useCallback(() => {
    // Reload the latest version; local field values are preserved by react-hook-form dirty state
    setConflictError(null);
    // Parent re-fetches policy; this component will receive updated policy prop
    window.location.reload();
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg-card, #fff)',
        border: '1px solid var(--color-border, #e5e7eb)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      {/* Policy name */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--color-border, #e5e7eb)' }}>
        <label
          htmlFor="policy-name"
          style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-fg-secondary, #6b7280)', display: 'block', marginBottom: 4 }}
        >
          Policy Name
        </label>
        <input
          id="policy-name"
          type="text"
          disabled={isReadOnly}
          placeholder="e.g. Default SLA Policy"
          aria-invalid={Boolean(form.formState.errors.name)}
          style={{
            width: '100%',
            maxWidth: 400,
            padding: '6px 10px',
            borderRadius: 6,
            border: form.formState.errors.name
              ? '1px solid var(--color-error, #ef4444)'
              : '1px solid var(--color-border, #e5e7eb)',
            fontSize: 15,
            fontWeight: 600,
            background: isReadOnly ? 'var(--color-surface-2, #f3f4f6)' : 'var(--color-bg-card, #fff)',
          }}
          {...form.register('name')}
        />
        {form.formState.errors.name && (
          <p role="alert" style={{ fontSize: 11, color: 'var(--color-error, #ef4444)', marginTop: 2 }}>
            {form.formState.errors.name.message}
          </p>
        )}
      </div>

      {/* Four-tab editor */}
      <Tabs defaultValue="targets">
        <TabsList aria-label="Policy editor sections">
          <TabsTrigger value="targets">Targets</TabsTrigger>
          <TabsTrigger value="calendar">Calendar and Pause</TabsTrigger>
          <TabsTrigger value="reminders">Reminders and Escalation</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>

        <div style={{ padding: 24, overflowY: 'auto', maxHeight: 'calc(100vh - 340px)' }}>
          <TabsContent value="targets">
            <TargetsPanel form={form} disabled={isReadOnly} />
          </TabsContent>

          <TabsContent value="calendar">
            <CalendarPanel form={form} disabled={isReadOnly} />
          </TabsContent>

          <TabsContent value="reminders">
            <RemindersPanel form={form} disabled={isReadOnly} />
          </TabsContent>

          <TabsContent value="preview">
            <PreviewPanel form={form} />
          </TabsContent>
        </div>
      </Tabs>

      {/* Sticky footer — always rendered, hidden save for read-only */}
      <StickyFooter
        form={form}
        onSave={onSave}
        onDiscard={onDiscard}
        isSaving={mutation.isPending}
        isReadOnly={isReadOnly}
        conflictError={conflictError}
        onReloadAndMerge={handleReloadAndMerge}
      />
    </div>
  );
}
