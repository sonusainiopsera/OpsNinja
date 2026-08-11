'use client';

import React from 'react';
import type { PendingCsatSurvey } from '../../lib/identity/usePortalIdentity';
import { useCsatDismissal } from '../../lib/csat/useCsatDismissal';

interface CsatBannerProps {
  survey: PendingCsatSurvey;
}

export function CsatBanner({ survey }: CsatBannerProps) {
  const { isDismissed, dismiss } = useCsatDismissal(survey.surveyId);

  if (isDismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Survey notification"
      data-testid="csat-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        padding: '0.625rem 1.5rem',
        background: 'var(--color-info-bg, #eff6ff)',
        borderBottom: '1px solid var(--color-info-border, #bfdbfe)',
        fontSize: '0.875rem',
        flexWrap: 'wrap',
      }}
    >
      <span data-testid="csat-prompt" style={{ flex: 1, minWidth: 0 }}>
        {survey.prompt}
      </span>
      <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
        <a
          href={survey.surveyUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="csat-take-survey"
          style={{
            padding: '0.375rem 0.875rem',
            background: 'var(--color-accent, #4f46e5)',
            color: '#fff',
            borderRadius: '0.375rem',
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: '0.8125rem',
          }}
        >
          Take survey
        </a>
        <button
          onClick={dismiss}
          data-testid="csat-dismiss"
          aria-label="Dismiss survey notification"
          style={{
            padding: '0.375rem 0.75rem',
            background: 'none',
            border: '1px solid var(--color-border, #e5e7eb)',
            borderRadius: '0.375rem',
            cursor: 'pointer',
            fontSize: '0.8125rem',
            color: 'var(--color-text-secondary, #4b5563)',
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
