'use client';

/**
 * CsatBanner — dismissible post-resolution CSAT survey prompt.
 *
 * - role=status so it announces without stealing focus
 * - Dismissal persisted per survey id via SSR-safe localStorage
 * - Keyboard-dismissible via Escape key and explicit close button
 * - Never renders if already dismissed
 */

import React, { useEffect, useState } from 'react';
import { isSurveyDismissed, dismissSurvey } from '../../lib/store/csatDismissal';
import type { PendingSurvey } from '../../lib/api/client';

interface CsatBannerProps {
  survey: PendingSurvey;
}

export function CsatBanner({ survey }: CsatBannerProps) {
  const [dismissed, setDismissed] = useState(true); // default hidden until client check

  useEffect(() => {
    // SSR-safe: check localStorage after hydration
    setDismissed(isSurveyDismissed(survey.id));
  }, [survey.id]);

  const handleDismiss = () => {
    dismissSurvey(survey.id);
    setDismissed(true);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !dismissed) handleDismiss();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  if (dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Customer satisfaction survey"
      data-testid="csat-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '10px 20px',
        background: 'var(--portal-csat-bg, #eff6ff)',
        borderBottom: '1px solid var(--portal-csat-border, #bfdbfe)',
        fontSize: 13,
        color: 'var(--portal-csat-fg, #1e40af)',
      }}
    >
      <span>
        How was your experience with{' '}
        <strong>
          {survey.ticketSubject.length > 40
            ? survey.ticketSubject.slice(0, 39) + '…'
            : survey.ticketSubject}
        </strong>
        ?{' '}
        <a
          href={`/survey/${survey.id}`}
          style={{ color: 'var(--portal-accent, #0ea5e9)', fontWeight: 600 }}
        >
          Share feedback
        </a>
      </span>
      <button
        aria-label="Dismiss survey prompt"
        onClick={handleDismiss}
        data-testid="csat-dismiss-btn"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: 16,
          color: 'var(--portal-csat-fg, #1e40af)',
          padding: '0 4px',
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}
