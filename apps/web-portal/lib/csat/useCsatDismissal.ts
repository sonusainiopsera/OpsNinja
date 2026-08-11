'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY_PREFIX = 'opsninja.portal.csat.dismissed.';

function readDismissed(surveyId: string): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_PREFIX + surveyId) === 'true';
  } catch {
    return false;
  }
}

function writeDismissed(surveyId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + surveyId, 'true');
  } catch {
    // localStorage unavailable — dismissal is not persisted (fine, survey shows again on reload)
  }
}

/**
 * Tracks per-survey CSAT dismissal with SSR-safe localStorage.
 *
 * On the server (and initial hydration frame) `isDismissed` is false; after
 * mount it reads from localStorage so there is no hydration mismatch.
 */
export function useCsatDismissal(surveyId: string | undefined | null) {
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    if (!surveyId) return;
    setIsDismissed(readDismissed(surveyId));
  }, [surveyId]);

  const dismiss = useCallback(() => {
    if (!surveyId) return;
    writeDismissed(surveyId);
    setIsDismissed(true);
  }, [surveyId]);

  return { isDismissed, dismiss };
}
