import { describe, it, expect } from 'vitest';
import { LIGHT_TOKENS, DARK_TOKENS } from '../tokens/semantic.js';
import { slaStateMeta, SLA_STATES } from '../tokens/slaStateMeta.js';

// Deuteranopia transformation matrix (Vienot 1999 / Machado 2009 approximation)
const DEUTERANOPIA: readonly [readonly number[], readonly number[], readonly number[]] = [
  [0.29900, 0.58700, 0.11400],
  [0.29900, 0.58700, 0.11400],
  [0.00000, 0.10000, 0.90000],
];

// Protanopia transformation matrix
const PROTANOPIA: readonly [readonly number[], readonly number[], readonly number[]] = [
  [0.10889, 0.89111, 0.00000],
  [0.10889, 0.89111, 0.00000],
  [0.00000, 0.00000, 1.00000],
];

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return [r, g, b];
}

function applyMatrix(
  matrix: readonly [readonly number[], readonly number[], readonly number[]],
  [r, g, b]: [number, number, number],
): [number, number, number] {
  const row0 = matrix[0];
  const row1 = matrix[1];
  const row2 = matrix[2];
  if (!row0 || !row1 || !row2) throw new Error('Invalid matrix');
  const rp = Math.min(1, Math.max(0, (row0[0] ?? 0) * r + (row0[1] ?? 0) * g + (row0[2] ?? 0) * b));
  const gp = Math.min(1, Math.max(0, (row1[0] ?? 0) * r + (row1[1] ?? 0) * g + (row1[2] ?? 0) * b));
  const bp = Math.min(1, Math.max(0, (row2[0] ?? 0) * r + (row2[1] ?? 0) * g + (row2[2] ?? 0) * b));
  return [rp, gp, bp];
}

function perceptualDelta(
  a: [number, number, number],
  b: [number, number, number],
): number {
  // Simple Euclidean distance in RGB space (0-255 scale)
  const dr = (a[0] - b[0]) * 255;
  const dg = (a[1] - b[1]) * 255;
  const db = (a[2] - b[2]) * 255;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

describe('SLA state colour-blind safety', () => {
  it('each SLA state has a distinct iconName (non-colour channel)', () => {
    const icons = SLA_STATES.map((s) => slaStateMeta[s].iconName);
    const unique = new Set(icons);
    expect(unique.size).toBe(SLA_STATES.length);
  });

  it('each SLA state has a distinct patternClass (non-colour channel)', () => {
    const patterns = SLA_STATES.map((s) => slaStateMeta[s].patternClass);
    const unique = new Set(patterns);
    expect(unique.size).toBe(SLA_STATES.length);
  });

  it('each SLA state has a distinct label', () => {
    const labels = SLA_STATES.map((s) => slaStateMeta[s].label);
    const unique = new Set(labels);
    expect(unique.size).toBe(SLA_STATES.length);
  });

  const slaPairs: Array<[string, string, string]> = [
    ['running', 'warning', 'running vs warning'],
    ['running', 'paused', 'running vs paused'],
    ['running', 'breached', 'running vs breached (critical: green/red)'],
    ['warning', 'paused', 'warning vs paused'],
    ['warning', 'breached', 'warning vs breached'],
    ['paused', 'breached', 'paused vs breached'],
  ];

  const MIN_DELTA = 20; // minimum Euclidean distance in simulated RGB space

  for (const theme of ['light', 'dark'] as const) {
    const tokens = theme === 'light' ? LIGHT_TOKENS : DARK_TOKENS;

    describe(`${theme} theme — deuteranopia simulation`, () => {
      for (const [stateA, stateB, label] of slaPairs) {
        it(`${label} are distinguishable via non-colour channel`, () => {
          const metaA = slaStateMeta[stateA as keyof typeof slaStateMeta];
          const metaB = slaStateMeta[stateB as keyof typeof slaStateMeta];
          expect(metaA.iconName).not.toBe(metaB.iconName);
          expect(metaA.patternClass).not.toBe(metaB.patternClass);
        });

        it(`${label} — deuteranopia delta ≥ ${MIN_DELTA} OR non-colour channel present`, () => {
          const hexA = tokens[`sla-${stateA}` as keyof typeof tokens];
          const hexB = tokens[`sla-${stateB}` as keyof typeof tokens];
          const simA = applyMatrix(DEUTERANOPIA, hexToRgb(hexA));
          const simB = applyMatrix(DEUTERANOPIA, hexToRgb(hexB));
          const delta = perceptualDelta(simA, simB);
          const metaA = slaStateMeta[stateA as keyof typeof slaStateMeta];
          const metaB = slaStateMeta[stateB as keyof typeof slaStateMeta];
          const hasNonColourChannel =
            metaA.iconName !== metaB.iconName ||
            metaA.patternClass !== metaB.patternClass;
          expect(
            delta >= MIN_DELTA || hasNonColourChannel,
            `${theme} ${stateA}/${stateB}: simulated delta=${delta.toFixed(1)}, non-colour-channel=${String(hasNonColourChannel)}`,
          ).toBe(true);
        });

        it(`${label} — protanopia delta ≥ ${MIN_DELTA} OR non-colour channel present`, () => {
          const hexA = tokens[`sla-${stateA}` as keyof typeof tokens];
          const hexB = tokens[`sla-${stateB}` as keyof typeof tokens];
          const simA = applyMatrix(PROTANOPIA, hexToRgb(hexA));
          const simB = applyMatrix(PROTANOPIA, hexToRgb(hexB));
          const delta = perceptualDelta(simA, simB);
          const metaA = slaStateMeta[stateA as keyof typeof slaStateMeta];
          const metaB = slaStateMeta[stateB as keyof typeof slaStateMeta];
          const hasNonColourChannel =
            metaA.iconName !== metaB.iconName ||
            metaA.patternClass !== metaB.patternClass;
          expect(
            delta >= MIN_DELTA || hasNonColourChannel,
            `${theme} ${stateA}/${stateB}: simulated delta=${delta.toFixed(1)}, non-colour-channel=${String(hasNonColourChannel)}`,
          ).toBe(true);
        });
      }
    });
  }
});
