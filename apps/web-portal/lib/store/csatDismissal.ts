/**
 * SSR-safe CSAT survey dismissal persistence.
 * Keyed by survey id so dismissing one survey never suppresses a future different one.
 */

const STORAGE_PREFIX = 'opsninja.portal.csat.dismissed.';

export function isSurveyDismissed(surveyId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + surveyId) === 'true';
  } catch {
    return false;
  }
}

export function dismissSurvey(surveyId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + surveyId, 'true');
  } catch {
    // Quota exceeded or private browsing — continue without persistence
  }
}
