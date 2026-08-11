import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { themeScript } from '../theme/themeScript.js';

// jsdom provides localStorage but not matchMedia — we need to stub it
function mockMatchMedia(prefersDark: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query.includes('dark') ? prefersDark : !prefersDark,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

describe('themeScript (inline pre-hydration IIFE)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('is a non-empty string', () => {
    expect(typeof themeScript).toBe('string');
    expect(themeScript.length).toBeGreaterThan(0);
  });

  it('sets data-theme=light when no stored preference and system is light', () => {
    mockMatchMedia(false);
    // eslint-disable-next-line no-new-func
    new Function(themeScript)();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('sets data-theme=dark when no stored preference and system is dark', () => {
    mockMatchMedia(true);
    new Function(themeScript)();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('respects explicit "light" stored preference', () => {
    localStorage.setItem('opsninja.theme', 'light');
    mockMatchMedia(true); // even if OS prefers dark
    new Function(themeScript)();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('respects explicit "dark" stored preference', () => {
    localStorage.setItem('opsninja.theme', 'dark');
    mockMatchMedia(false); // even if OS prefers light
    new Function(themeScript)();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('ignores invalid stored preference and falls back to system', () => {
    localStorage.setItem('opsninja.theme', 'invalid-value');
    mockMatchMedia(false);
    new Function(themeScript)();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('ignores "system" as explicit stored value — falls through to system detection', () => {
    // 'system' is not in the valid=['light','dark'] list in themeScript, so falls back to system
    localStorage.setItem('opsninja.theme', 'system');
    mockMatchMedia(true);
    new Function(themeScript)();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});

describe('ThemeProvider state transitions', () => {
  it('themeScript contains the opsninja.theme storage key', () => {
    expect(themeScript).toContain('opsninja.theme');
  });

  it('themeScript sets the data-theme attribute', () => {
    expect(themeScript).toContain('data-theme');
  });

  it('themeScript handles localStorage errors gracefully (try/catch present)', () => {
    expect(themeScript).toContain('try');
    expect(themeScript).toContain('catch');
  });
});
