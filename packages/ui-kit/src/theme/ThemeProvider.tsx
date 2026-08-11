'use client';

import {
  createContext,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeContextValue {
  theme: ThemeChoice;
  resolvedTheme: ResolvedTheme;
  setTheme: (next: ThemeChoice) => void;
}

const STORAGE_KEY = 'opsninja.theme';
const VALID_CHOICES: ReadonlySet<string> = new Set<ThemeChoice>([
  'light',
  'dark',
  'system',
]);

function isValidChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && VALID_CHOICES.has(value);
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function resolveChoice(choice: ThemeChoice): ResolvedTheme {
  return choice === 'system' ? getSystemTheme() : choice;
}

function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.setAttribute('data-theme', resolved);
}

// Exported for useTheme.ts; null signals "not inside provider"
export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>('system');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');

  // Initialise from localStorage on mount (client-only)
  useEffect(() => {
    let stored: ThemeChoice = 'system';
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (isValidChoice(raw)) stored = raw;
    } catch (err) {
      console.warn('[opsninja/ui-kit] Failed to read theme', {
        key: STORAGE_KEY,
        error: err,
      });
    }

    const resolved = resolveChoice(stored);
    setThemeState(stored);
    setResolvedTheme(resolved);
    applyTheme(resolved);
  }, []);

  // Track OS colour-scheme changes when user is on "system"
  useEffect(() => {
    if (theme !== 'system') return;

    let mq: MediaQueryList;
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }

    const handler = (e: MediaQueryListEvent) => {
      const resolved: ResolvedTheme = e.matches ? 'dark' : 'light';
      setResolvedTheme(resolved);
      applyTheme(resolved);
    };

    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = useCallback((next: ThemeChoice) => {
    const resolved = resolveChoice(next);
    setThemeState(next);
    setResolvedTheme(resolved);
    applyTheme(resolved);

    try {
      if (next === 'system') {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, next);
      }
    } catch (err) {
      console.warn('[opsninja/ui-kit] Failed to persist theme', {
        key: STORAGE_KEY,
        value: next,
        error: err,
      });
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
