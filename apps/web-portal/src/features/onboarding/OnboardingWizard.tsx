/**
 * OnboardingWizard — WO-088.
 *
 * Main wizard component rendered when onboardingRequired is true.
 *
 * Structure:
 *   - StepIndicator shows progress (1-2-3)
 *   - Routes between VerifyOrgStep, PreferencesStep, TutorialStep
 *     based on server state (currentStep).
 * - Completion calls POST /complete and redirects to portal home.
 * - Keyboard navigable, aria-live step announcements (AC-9).
 * - Optimistic-but-reconciled progress via TanStack Query (AC-9).
 * - 409 conflict triggers a refetch for reconciliation.
 */

'use client';

import React, { useEffect, useRef } from 'react';
import {
  useOnboardingState,
  useVerifyOrgMutation,
  usePreferencesMutation,
  useTutorialMutation,
  useCompleteMutation,
  type VerifyOrgPayload,
  type PreferencesPayload,
  type TutorialPayload,
} from './useOnboarding';
import { VerifyOrgStep } from './steps/VerifyOrgStep';
import { PreferencesStep } from './steps/PreferencesStep';
import { TutorialStep } from './steps/TutorialStep';

// ---------------------------------------------------------------------------
// Step metadata for StepIndicator
// ---------------------------------------------------------------------------

const STEPS = [
  { key: 'verify-organization', label: 'Verify organization' },
  { key: 'preferences',         label: 'Communication preferences' },
  { key: 'tutorial',            label: 'Tutorial' },
] as const;

// ---------------------------------------------------------------------------
// StepIndicator
// ---------------------------------------------------------------------------

interface StepIndicatorProps {
  current: string;
  steps:   ReadonlyArray<{ key: string; label: string }>;
}

function StepIndicator({ current, steps }: StepIndicatorProps) {
  const currentIdx = steps.findIndex((s) => s.key === current);

  return (
    <nav aria-label="Onboarding progress" style={{ marginBottom: 32 }}>
      <ol
        style={{
          display:        'flex',
          listStyle:      'none',
          padding:        0,
          margin:         0,
          gap:            0,
        }}
      >
        {steps.map((step, idx) => {
          const isCompleted = idx < currentIdx;
          const isCurrent   = idx === currentIdx;
          const isPending   = idx > currentIdx;

          return (
            <li
              key={step.key}
              aria-current={isCurrent ? 'step' : undefined}
              style={{ flex: 1, display: 'flex', alignItems: 'center' }}
            >
              {/* Connector line before step (except first) */}
              {idx > 0 && (
                <div
                  aria-hidden="true"
                  style={{
                    flex:       1,
                    height:     2,
                    background: isCompleted
                      ? 'var(--portal-primary, #2563eb)'
                      : 'var(--portal-border, #e5e7eb)',
                  }}
                />
              )}

              {/* Step circle */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 80 }}>
                <div
                  aria-hidden="true"
                  style={{
                    width:          32,
                    height:         32,
                    borderRadius:   '50%',
                    display:        'flex',
                    alignItems:     'center',
                    justifyContent: 'center',
                    fontWeight:     700,
                    fontSize:       '0.875rem',
                    background: isCompleted
                      ? 'var(--portal-primary, #2563eb)'
                      : isCurrent
                        ? 'var(--portal-primary, #2563eb)'
                        : 'var(--portal-bg-alt, #f3f4f6)',
                    color: (isCompleted || isCurrent) ? '#fff' : '#9ca3af',
                    border: `2px solid ${isCurrent ? 'var(--portal-primary, #2563eb)' : 'transparent'}`,
                    transition: 'background 0.2s, color 0.2s',
                  }}
                >
                  {isCompleted ? '✓' : idx + 1}
                </div>
                <span
                  style={{
                    marginTop: 6,
                    fontSize:  '0.75rem',
                    fontWeight: isCurrent ? 600 : 400,
                    color: isCompleted
                      ? 'var(--portal-primary, #2563eb)'
                      : isCurrent
                        ? 'var(--portal-text, #111827)'
                        : '#9ca3af',
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {step.label}
                </span>
              </div>

              {/* Connector line after step (except last) */}
              {idx < steps.length - 1 && (
                <div
                  aria-hidden="true"
                  style={{
                    flex:       1,
                    height:     2,
                    background: isCompleted
                      ? 'var(--portal-primary, #2563eb)'
                      : 'var(--portal-border, #e5e7eb)',
                  }}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// OnboardingWizard
// ---------------------------------------------------------------------------

export function OnboardingWizard() {
  const { data: state, isLoading, error: queryError } = useOnboardingState();

  const verifyMutation      = useVerifyOrgMutation();
  const preferencesMutation = usePreferencesMutation();
  const tutorialMutation    = useTutorialMutation();
  const completeMutation    = useCompleteMutation();

  // Announce step changes to screen readers (AC-9)
  const liveRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state?.currentStep && liveRef.current) {
      const step = STEPS.find((s) => s.key === state.currentStep);
      if (step) {
        liveRef.current.textContent = `Now on step: ${step.label}`;
      }
    }
  }, [state?.currentStep]);

  // Redirect to portal home on completion
  useEffect(() => {
    if (state?.completedAt && typeof window !== 'undefined') {
      window.location.href = '/portal/tickets';
    }
  }, [state?.completedAt]);

  if (isLoading) {
    return (
      <div
        role="status"
        aria-label="Loading onboarding wizard"
        style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}
      >
        <div aria-hidden="true" style={{ fontSize: '2rem', marginBottom: 12 }}>⏳</div>
        Loading your onboarding progress…
      </div>
    );
  }

  if (queryError || !state) {
    return (
      <div
        role="alert"
        style={{ padding: 32, color: '#dc2626', background: '#fef2f2', borderRadius: 8 }}
      >
        <strong>Unable to load onboarding wizard.</strong>
        <br />
        {queryError?.message ?? 'Please refresh the page and try again.'}
      </div>
    );
  }

  // ── Post-complete: POST /complete ──────────────────────────────────────────
  if (state.currentStep === 'complete' && !state.completedAt) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <h2 style={{ fontWeight: 600, fontSize: '1.25rem', marginBottom: 12 }}>
          All steps complete!
        </h2>
        <p style={{ color: '#6b7280', marginBottom: 24 }}>
          Click below to finish onboarding and access the portal.
        </p>
        {completeMutation.isError && (
          <p role="alert" style={{ color: '#dc2626', marginBottom: 12 }}>
            {completeMutation.error?.message ?? 'Could not complete onboarding. Please try again.'}
          </p>
        )}
        <button
          type="button"
          onClick={() => completeMutation.mutate()}
          disabled={completeMutation.isPending}
          aria-busy={completeMutation.isPending}
          data-testid="finish-onboarding-btn"
          style={{
            padding:      '12px 28px',
            background:   'var(--portal-primary, #2563eb)',
            color:        '#fff',
            border:       'none',
            borderRadius: 8,
            cursor:       'pointer',
            fontSize:     '1rem',
            fontWeight:   600,
          }}
        >
          {completeMutation.isPending ? 'Finishing…' : 'Enter the portal'}
        </button>
      </div>
    );
  }

  // ── Wizard step rendering ──────────────────────────────────────────────────

  function handleVerifyOrg(payload: VerifyOrgPayload) {
    verifyMutation.mutate(payload);
  }

  function handlePreferences(payload: PreferencesPayload) {
    preferencesMutation.mutate(payload);
  }

  function handleTutorial(payload: TutorialPayload) {
    tutorialMutation.mutate(payload);
  }

  const stepError =
    verifyMutation.error?.message ??
    preferencesMutation.error?.message ??
    tutorialMutation.error?.message ??
    null;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 16px' }}>
      {/* aria-live region for global step announcements (AC-9) */}
      <div
        ref={liveRef}
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />

      {/* Wizard header */}
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 6px' }}>
          Welcome to the OpsNinja portal
        </h1>
        <p style={{ margin: 0, color: 'var(--portal-text-secondary, #6b7280)', fontSize: '0.9375rem' }}>
          Complete these steps to set up your account.
        </p>
      </header>

      {/* Step indicator */}
      <StepIndicator current={state.currentStep} steps={STEPS} />

      {/* Active step content */}
      <main id="wizard-main" aria-label="Onboarding step">
        {state.currentStep === 'verify-organization' && (
          <VerifyOrgStep
            state={state}
            onSubmit={handleVerifyOrg}
            isSubmitting={verifyMutation.isPending}
            error={verifyMutation.error?.message ?? null}
          />
        )}

        {state.currentStep === 'preferences' && (
          <PreferencesStep
            state={state}
            onSubmit={handlePreferences}
            isSubmitting={preferencesMutation.isPending}
            error={preferencesMutation.error?.message ?? null}
          />
        )}

        {state.currentStep === 'tutorial' && (
          <TutorialStep
            state={state}
            onSubmit={handleTutorial}
            isSubmitting={tutorialMutation.isPending}
            error={tutorialMutation.error?.message ?? null}
          />
        )}
      </main>
    </div>
  );
}
