'use client';

import { useContext } from 'react';
import { ThemeContext } from './ThemeProvider.js';
import type { ThemeContextValue } from './ThemeProvider.js';

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) {
    throw new Error('[opsninja/ui-kit] useTheme must be used inside <ThemeProvider>');
  }
  return ctx;
}
