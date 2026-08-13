/**
 * TutorialStep — WO-088.
 *
 * Step 3: Short tutorial on submitting effective DevOps support requests.
 *
 * - Tutorial content version is stored on completion so changes can re-prompt
 *   without resetting other steps (AC-4).
 * - User may complete OR skip — both are terminal states for this step.
 * - Tutorial content is versioned; contentVersion is passed back to the API.
 * - Full keyboard navigation and ARIA (AC-9).
 */

'use client';

import React, { useEffect, useRef } from 'react';
import type { OnboardingState, TutorialPayload } from '../useOnboarding';

interface TutorialStepProps {
  state:        OnboardingState;
  onSubmit:     (payload: TutorialPayload) => void;
  isSubmitting: boolean;
  error?:       string | null;
}

export function TutorialStep({ state, onSubmit, isSubmitting, error }: TutorialStepProps) {
  const { tutorial, version } = state;
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  function handleComplete() {
    onSubmit({ action: 'complete', contentVersion: tutorial.contentVersion, version });
  }

  function handleSkip() {
    onSubmit({ action: 'skip', contentVersion: tutorial.contentVersion, version });
  }

  return (
    <section aria-labelledby="tutorial-heading" style={{ maxWidth: 640 }}>
      {/* aria-live region for step announcements (AC-9) */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        Step 3 of 3: Tutorial — how to submit effective DevOps support requests
      </div>

      <h2
        id="tutorial-heading"
        ref={headingRef}
        tabIndex={-1}
        style={{ marginBottom: 8, outline: 'none', fontSize: '1.25rem', fontWeight: 600 }}
      >
        How to submit effective DevOps support requests
      </h2>

      <p style={{ marginBottom: 24, color: 'var(--portal-text-secondary, #6b7280)', fontSize: '0.9375rem' }}>
        Take a few minutes to learn what makes a great support ticket. This will
        help our team resolve your issues faster and with less back-and-forth.
      </p>

      {/* Tutorial content */}
      <article aria-label="Tutorial content" style={{ marginBottom: 32 }}>
        {TUTORIAL_SECTIONS.map((section, idx) => (
          <section
            key={section.id}
            aria-labelledby={`tutorial-section-${section.id}`}
            style={{
              padding:      16,
              marginBottom: 12,
              borderRadius: 8,
              border:       '1px solid var(--portal-border, #e5e7eb)',
              background:   'var(--portal-bg-surface, #fff)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <span
                aria-hidden="true"
                style={{
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'center',
                  width:           28,
                  height:          28,
                  borderRadius:   '50%',
                  background:     'var(--portal-primary, #2563eb)',
                  color:          '#fff',
                  fontWeight:     700,
                  fontSize:       '0.875rem',
                  flexShrink:     0,
                }}
              >
                {idx + 1}
              </span>
              <div>
                <h3
                  id={`tutorial-section-${section.id}`}
                  style={{ margin: '2px 0 6px', fontSize: '1rem', fontWeight: 600 }}
                >
                  {section.heading}
                </h3>
                <p style={{ margin: 0, fontSize: '0.9rem', color: '#374151', lineHeight: 1.6 }}>
                  {section.body}
                </p>
              </div>
            </div>
          </section>
        ))}
      </article>

      {/* Quick checklist */}
      <div
        style={{
          padding:      16,
          borderRadius: 8,
          background:   'var(--portal-primary-bg, #eff6ff)',
          border:       '1px solid var(--portal-primary-border, #bfdbfe)',
          marginBottom: 24,
        }}
      >
        <h3 style={{ margin: '0 0 8px', fontSize: '0.9375rem', fontWeight: 600, color: '#1d4ed8' }}>
          Before you submit a ticket, include:
        </h3>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: '0.9rem', color: '#1e40af', lineHeight: 1.7 }}>
          <li>Environment (production, staging, development)</li>
          <li>Steps to reproduce the issue</li>
          <li>Expected behaviour vs what actually happened</li>
          <li>Relevant logs, error messages, and screenshots</li>
          <li>Impact: who is affected and how many users?</li>
        </ul>
      </div>

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
          type="button"
          onClick={handleComplete}
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          data-testid="tutorial-complete-btn"
          style={primaryButtonStyle}
        >
          {isSubmitting ? 'Saving…' : 'Got it — continue'}
        </button>
        <button
          type="button"
          onClick={handleSkip}
          disabled={isSubmitting}
          data-testid="tutorial-skip-btn"
          style={secondaryButtonStyle}
        >
          Skip tutorial
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Static tutorial content (versioned; contentVersion tracks which was shown)
// ---------------------------------------------------------------------------

const TUTORIAL_SECTIONS = [
  {
    id:      'why-it-matters',
    heading: 'Why good tickets matter',
    body:    'Clear, detailed tickets help our team reproduce your issue and resolve it faster. ' +
             'A well-written ticket can cut resolution time in half.',
  },
  {
    id:      'required-info',
    heading: 'Required information',
    body:    'Always include the environment (prod/staging/dev), exact steps to reproduce, ' +
             'and what you expected to happen versus what actually occurred.',
  },
  {
    id:      'attach-evidence',
    heading: 'Attach logs and screenshots',
    body:    'Logs and screenshots eliminate the most common back-and-forth. Attach error output, ' +
             'stack traces, and annotated screenshots to every ticket.',
  },
  {
    id:      'impact',
    heading: 'Describe the impact',
    body:    'Tell us how many users are affected, whether there is a workaround, and the ' +
             'business impact. This helps us prioritise correctly.',
  },
];

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

const secondaryButtonStyle: React.CSSProperties = {
  padding:      '10px 20px',
  background:   'var(--portal-bg-alt, #f9fafb)',
  color:        'var(--portal-text, #111827)',
  border:       '1px solid var(--portal-border, #e5e7eb)',
  borderRadius: 6,
  cursor:       'pointer',
  fontSize:     '0.9375rem',
};
