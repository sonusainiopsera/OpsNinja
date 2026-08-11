import { describe, it, expect } from 'vitest';
import { CONTRAST_PAIRS } from '../fixtures/contrast-pairs.js';

function linearize(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('WCAG 2.2 AA contrast matrix', () => {
  it('has at least one contrast pair in the fixture', () => {
    expect(CONTRAST_PAIRS.length).toBeGreaterThan(0);
  });

  for (const pair of CONTRAST_PAIRS) {
    it(`${pair.id} ≥ ${pair.minRatio}:1 — ${pair.rationale}`, () => {
      const ratio = contrastRatio(pair.fgHex, pair.bgHex);
      expect(
        ratio,
        `${pair.id}: ${pair.fgRole} (${pair.fgHex}) on ${pair.bgRole} (${pair.bgHex}) ` +
          `measured ${ratio.toFixed(2)}:1, required ≥${pair.minRatio}:1`,
      ).toBeGreaterThanOrEqual(pair.minRatio);
    });
  }

  it('covers both light and dark themes', () => {
    const themes = new Set(CONTRAST_PAIRS.map((p) => p.theme));
    expect(themes.has('light')).toBe(true);
    expect(themes.has('dark')).toBe(true);
  });
});
