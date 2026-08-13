/**
 * PreferencesStep — WO-088.
 *
 * Step 2: Communication channel and digest cadence controls.
 *
 * - Channel selections (email, webhook) are written through the notifications
 *   module service interface server-side.
 * - Digest cadence selection controls delivery frequency.
 * - Empty channel selection is an explicit opt-out (AC-3).
 * - Full keyboard navigation and ARIA (AC-9).
 */

'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { OnboardingState, PreferencesPayload } from '../useOnboarding';

interface PreferencesStepProps {
  state:        OnboardingState;
  onSubmit:     (payload: PreferencesPayload) => void;
  isSubmitting: boolean;
  error?:       string | null;
}

const CADENCE_LABELS: Record<string, string> = {
  immediate:    'Immediate — receive each update right away',
  daily_digest: 'Daily digest — one summary email per day',
  weekly_digest: 'Weekly digest — one summary email per week',
};

const CHANNEL_LABELS: Record<string, string> = {
  email:   'Email notifications',
  webhook: 'Webhook delivery',
};

export function PreferencesStep({ state, onSubmit, isSubmitting, error }: PreferencesStepProps) {
  const { preferenceOptions, steps, version } = state;

  // Pre-fill from previously submitted values (AC-6 — resumable)
  const savedPrefs = steps['preferences']?.data as {
    channels?: string[];
    digestCadence?: string;
  } | undefined;

  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(
    () => new Set(savedPrefs?.channels ?? []),
  );
  const [cadence, setCadence] = useState<string>(
    savedPrefs?.digestCadence ?? 'immediate',
  );

  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  function toggleChannel(channel: string) {
    setSelectedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(channel)) {
        next.delete(channel);
      } else {
        next.add(channel);
      }
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      channels:      Array.from(selectedChannels),
      digestCadence: cadence,
      version,
    });
  }

  return (
    <section aria-labelledby="preferences-heading" style={{ maxWidth: 580 }}>
      {/* aria-live region for step announcements (AC-9) */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        Step 2 of 3: Communication preferences
      </div>

      <h2
        id="preferences-heading"
        ref={headingRef}
        tabIndex={-1}
        style={{ marginBottom: 16, outline: 'none', fontSize: '1.25rem', fontWeight: 600 }}
      >
        Communication preferences
      </h2>

      <p style={{ marginBottom: 24, color: 'var(--portal-text-secondary, #6b7280)' }}>
        Choose how you want to be notified about ticket updates.
        You can change these preferences at any time in your account settings.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        {/* Channel selection */}
        <fieldset style={{ border: 'none', padding: 0, marginBottom: 24 }}>
          <legend style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 12, color: '#111827' }}>
            Notification channels
          </legend>

          {preferenceOptions.channels.map((channel) => (
            <label
              key={channel}
              style={{
                display:       'flex',
                alignItems:    'flex-start',
                gap:           12,
                padding:       '12px 14px',
                marginBottom:  8,
                borderRadius:  8,
                border:        `2px solid ${selectedChannels.has(channel)
                  ? 'var(--portal-primary, #2563eb)'
                  : 'var(--portal-border, #e5e7eb)'}`,
                cursor:        'pointer',
                background:    selectedChannels.has(channel)
                  ? 'var(--portal-primary-bg, #eff6ff)'
                  : 'var(--portal-bg-surface, #fff)',
              }}
            >
              <input
                type="checkbox"
                checked={selectedChannels.has(channel)}
                onChange={() => toggleChannel(channel)}
                data-testid={`channel-checkbox-${channel}`}
                style={{ marginTop: 2, accentColor: 'var(--portal-primary, #2563eb)' }}
              />
              <span>
                <strong style={{ display: 'block', fontSize: '0.9375rem' }}>
                  {CHANNEL_LABELS[channel] ?? channel}
                </strong>
                {channel === 'email' && (
                  <span style={{ fontSize: '0.8125rem', color: '#6b7280' }}>
                    Notifications sent to your registered email address
                  </span>
                )}
                {channel === 'webhook' && (
                  <span style={{ fontSize: '0.8125rem', color: '#6b7280' }}>
                    POST requests sent to your configured webhook endpoint
                  </span>
                )}
              </span>
            </label>
          ))}

          {selectedChannels.size === 0 && (
            <p style={{ fontSize: '0.875rem', color: '#9ca3af', marginTop: 4 }}>
              No channels selected — you will not receive notifications.
            </p>
          )}
        </fieldset>

        {/* Cadence selection */}
        <fieldset style={{ border: 'none', padding: 0, marginBottom: 24 }}>
          <legend style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 12, color: '#111827' }}>
            Delivery frequency
          </legend>

          {preferenceOptions.digestCadences.map((c) => (
            <label
              key={c}
              style={{
                display:       'flex',
                alignItems:    'center',
                gap:           10,
                padding:       '10px 14px',
                marginBottom:  6,
                borderRadius:  8,
                border:        `2px solid ${cadence === c
                  ? 'var(--portal-primary, #2563eb)'
                  : 'var(--portal-border, #e5e7eb)'}`,
                cursor:        'pointer',
                background:    cadence === c
                  ? 'var(--portal-primary-bg, #eff6ff)'
                  : 'var(--portal-bg-surface, #fff)',
                fontSize:      '0.9375rem',
              }}
            >
              <input
                type="radio"
                name="digestCadence"
                value={c}
                checked={cadence === c}
                onChange={() => setCadence(c)}
                data-testid={`cadence-radio-${c}`}
                style={{ accentColor: 'var(--portal-primary, #2563eb)' }}
              />
              {CADENCE_LABELS[c] ?? c}
            </label>
          ))}
        </fieldset>

        {/* Error display */}
        {error && (
          <div
            role="alert"
            aria-live="assertive"
            style={{ marginBottom: 16, color: 'var(--portal-error, #dc2626)', fontSize: '0.875rem' }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            type="submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            data-testid="preferences-submit-btn"
            style={primaryButtonStyle}
          >
            {isSubmitting ? 'Saving…' : 'Save preferences'}
          </button>
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const primaryButtonStyle: React.CSSProperties = {
  padding:      '10px 24px',
  background:   'var(--portal-primary, #2563eb)',
  color:        '#fff',
  border:       'none',
  borderRadius: 6,
  cursor:       'pointer',
  fontSize:     '0.9375rem',
  fontWeight:   600,
};
