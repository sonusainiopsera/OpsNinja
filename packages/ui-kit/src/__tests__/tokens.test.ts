import { describe, it, expect } from 'vitest';
import {
  TOKENS_VERSION,
  SEMANTIC_ROLES,
  LIGHT_TOKENS,
  DARK_TOKENS,
  getCSSVar,
  type SemanticRole,
} from '../tokens/semantic.js';
import { slaStateMeta, SLA_STATES } from '../tokens/slaStateMeta.js';

describe('TOKENS_VERSION', () => {
  it('is a semver string', () => {
    expect(TOKENS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('SEMANTIC_ROLES snapshot', () => {
  it('stable role catalogue — rename/remove detected here', () => {
    expect(SEMANTIC_ROLES).toMatchInlineSnapshot(`
      [
        "surface",
        "surface-raised",
        "surface-sunken",
        "border-default",
        "border-subtle",
        "text-primary",
        "text-secondary",
        "text-muted",
        "text-inverse",
        "accent",
        "accent-hover",
        "accent-fg",
        "focus-ring",
        "danger",
        "warning",
        "success",
        "info",
        "sla-running",
        "sla-warning",
        "sla-paused",
        "sla-breached",
      ]
    `);
  });

  it('has exactly 21 roles', () => {
    expect(SEMANTIC_ROLES).toHaveLength(21);
  });

  it('has no duplicate roles', () => {
    const unique = new Set(SEMANTIC_ROLES);
    expect(unique.size).toBe(SEMANTIC_ROLES.length);
  });
});

describe('LIGHT_TOKENS', () => {
  it('every semantic role has a non-empty hex value', () => {
    for (const role of SEMANTIC_ROLES) {
      const value = LIGHT_TOKENS[role];
      expect(value, `light token '${role}' must be a non-empty string`).toBeTruthy();
      expect(value).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('surface-raised and surface are valid in light theme', () => {
    expect(LIGHT_TOKENS['surface']).toBe('#ffffff');
    expect(LIGHT_TOKENS['surface-raised']).toBe('#ffffff');
  });
});

describe('DARK_TOKENS', () => {
  it('every semantic role has a non-empty hex value', () => {
    for (const role of SEMANTIC_ROLES) {
      const value = DARK_TOKENS[role];
      expect(value, `dark token '${role}' must be a non-empty string`).toBeTruthy();
      expect(value).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('surface is dark in dark theme', () => {
    expect(DARK_TOKENS['surface']).toBe('#111827');
  });

  it('text-primary is light in dark theme', () => {
    expect(DARK_TOKENS['text-primary']).toBe('#f9fafb');
  });
});

describe('getCSSVar', () => {
  it('wraps role in var(--on-color-{role})', () => {
    const role: SemanticRole = 'accent';
    expect(getCSSVar(role)).toBe('var(--on-color-accent)');
  });

  it('generates vars for all roles without throwing', () => {
    for (const role of SEMANTIC_ROLES) {
      expect(() => getCSSVar(role)).not.toThrow();
      expect(getCSSVar(role)).toMatch(/^var\(--on-color-/);
    }
  });
});

describe('slaStateMeta', () => {
  it('covers all SLA states', () => {
    expect(SLA_STATES).toHaveLength(4);
    for (const state of SLA_STATES) {
      expect(slaStateMeta[state]).toBeDefined();
    }
  });

  it('each descriptor has required fields', () => {
    for (const state of SLA_STATES) {
      const meta = slaStateMeta[state];
      expect(meta.token).toBeTruthy();
      expect(meta.iconName).toBeTruthy();
      expect(meta.label).toBeTruthy();
      expect(meta.patternClass).toBeTruthy();
    }
  });

  it('token references are valid semantic roles', () => {
    const roleSet = new Set(SEMANTIC_ROLES);
    for (const state of SLA_STATES) {
      expect(
        roleSet.has(slaStateMeta[state].token),
        `slaStateMeta[${state}].token must be a valid SemanticRole`,
      ).toBe(true);
    }
  });
});
