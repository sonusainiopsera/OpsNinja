/**
 * SSR-safe sidebar collapse persistence.
 *
 * Reads from localStorage on the client only; defaults to expanded
 * when localStorage is unavailable (SSR, private browsing, quota exceeded).
 */

const STORAGE_KEY = 'opsninja.shell.sidebar';

export function readSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === 'true';
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(collapsed));
  } catch {
    // Quota exceeded or private browsing — continue without persistence
  }
}
