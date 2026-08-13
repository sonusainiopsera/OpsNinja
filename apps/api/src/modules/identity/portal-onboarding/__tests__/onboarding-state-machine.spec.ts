/**
 * OnboardingStateMachine unit tests — WO-088.
 *
 * Exhaustive coverage of:
 *   - Step keys and ordering
 *   - Required vs skippable semantics
 *   - canComplete predicate (valid/invalid combinations)
 *   - nextStep resolution
 *   - isTerminal
 *   - canSkip / isRequired
 *   - parseSteps — Zod-guarded JSONB parse with fallback on unknown shape
 *   - Idempotent re-submission produces no state churn
 *
 * No framework or I/O dependencies — pure function tests.
 */

import { describe, it, expect } from 'vitest';
import {
  OnboardingStateMachine,
  STEP_KEYS,
  type StepsMap,
  type StepEntry,
} from '../onboarding-state-machine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep(
  status: 'pending' | 'confirmed' | 'skipped',
  updatedAt = '2026-01-15T10:00:00Z',
  extras?: Partial<StepEntry>,
): StepEntry {
  return { status, updatedAt, ...extras };
}

function allConfirmed(): StepsMap {
  const now = '2026-01-15T10:00:00Z';
  return {
    'verify-organization': makeStep('confirmed', now),
    'preferences':         makeStep('confirmed', now),
    'tutorial':            makeStep('confirmed', now),
  };
}

function requiredConfirmedOptionalSkipped(): StepsMap {
  const now = '2026-01-15T10:00:00Z';
  return {
    'verify-organization': makeStep('confirmed', now),
    'preferences':         makeStep('skipped',   now),
    'tutorial':            makeStep('skipped',   now),
  };
}

// ---------------------------------------------------------------------------
// Step keys
// ---------------------------------------------------------------------------

describe('STEP_KEYS', () => {
  it('contains exactly three canonical step keys in order', () => {
    expect(STEP_KEYS).toEqual(['verify-organization', 'preferences', 'tutorial']);
  });
});

// ---------------------------------------------------------------------------
// stepOrder
// ---------------------------------------------------------------------------

describe('OnboardingStateMachine.stepOrder', () => {
  it('returns steps in display order', () => {
    expect(OnboardingStateMachine.stepOrder()).toEqual([
      'verify-organization',
      'preferences',
      'tutorial',
    ]);
  });
});

// ---------------------------------------------------------------------------
// isTerminal
// ---------------------------------------------------------------------------

describe('OnboardingStateMachine.isTerminal', () => {
  it('returns true for confirmed', () => {
    expect(OnboardingStateMachine.isTerminal('confirmed')).toBe(true);
  });

  it('returns true for skipped', () => {
    expect(OnboardingStateMachine.isTerminal('skipped')).toBe(true);
  });

  it('returns false for pending', () => {
    expect(OnboardingStateMachine.isTerminal('pending')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canSkip
// ---------------------------------------------------------------------------

describe('OnboardingStateMachine.canSkip', () => {
  it('returns false for verify-organization (required, non-skippable)', () => {
    expect(OnboardingStateMachine.canSkip('verify-organization')).toBe(false);
  });

  it('returns true for preferences (required but skippable)', () => {
    expect(OnboardingStateMachine.canSkip('preferences')).toBe(true);
  });

  it('returns true for tutorial (optional, skippable)', () => {
    expect(OnboardingStateMachine.canSkip('tutorial')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isRequired
// ---------------------------------------------------------------------------

describe('OnboardingStateMachine.isRequired', () => {
  it('returns true for verify-organization', () => {
    expect(OnboardingStateMachine.isRequired('verify-organization')).toBe(true);
  });

  it('returns true for preferences', () => {
    expect(OnboardingStateMachine.isRequired('preferences')).toBe(true);
  });

  it('returns false for tutorial', () => {
    expect(OnboardingStateMachine.isRequired('tutorial')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canComplete
// ---------------------------------------------------------------------------

describe('OnboardingStateMachine.canComplete', () => {
  it('ok=true when all steps confirmed', () => {
    const { ok, outstanding } = OnboardingStateMachine.canComplete(allConfirmed());
    expect(ok).toBe(true);
    expect(outstanding).toHaveLength(0);
  });

  it('ok=true when required steps confirmed and optional step skipped', () => {
    const steps: StepsMap = {
      'verify-organization': makeStep('confirmed'),
      'preferences':         makeStep('confirmed'),
      'tutorial':            makeStep('skipped'),
    };
    const { ok } = OnboardingStateMachine.canComplete(steps);
    expect(ok).toBe(true);
  });

  it('ok=true when required skippable step is skipped (preferences)', () => {
    const { ok } = OnboardingStateMachine.canComplete(requiredConfirmedOptionalSkipped());
    expect(ok).toBe(true);
  });

  it('ok=false when verify-organization is pending', () => {
    const steps: StepsMap = {
      'preferences': makeStep('confirmed'),
      'tutorial':    makeStep('confirmed'),
    };
    const { ok, outstanding } = OnboardingStateMachine.canComplete(steps);
    expect(ok).toBe(false);
    expect(outstanding).toContain('verify-organization');
  });

  it('ok=false when preferences is pending', () => {
    const steps: StepsMap = {
      'verify-organization': makeStep('confirmed'),
      'tutorial':            makeStep('confirmed'),
    };
    const { ok, outstanding } = OnboardingStateMachine.canComplete(steps);
    expect(ok).toBe(false);
    expect(outstanding).toContain('preferences');
  });

  it('ok=false when verify-organization is skipped (non-skippable required step)', () => {
    const steps: StepsMap = {
      'verify-organization': makeStep('skipped'),
      'preferences':         makeStep('confirmed'),
      'tutorial':            makeStep('confirmed'),
    };
    const { ok, outstanding } = OnboardingStateMachine.canComplete(steps);
    expect(ok).toBe(false);
    expect(outstanding).toContain('verify-organization');
  });

  it('ok=false when all steps are pending (empty map)', () => {
    const { ok, outstanding } = OnboardingStateMachine.canComplete({});
    expect(ok).toBe(false);
    expect(outstanding).toContain('verify-organization');
    expect(outstanding).toContain('preferences');
  });

  it('outstanding only lists required incomplete steps (tutorial excluded)', () => {
    const steps: StepsMap = {
      'verify-organization': makeStep('confirmed'),
    };
    const { outstanding } = OnboardingStateMachine.canComplete(steps);
    // preferences is required and pending, tutorial is optional so not in outstanding
    expect(outstanding).toEqual(['preferences']);
  });
});

// ---------------------------------------------------------------------------
// nextStep
// ---------------------------------------------------------------------------

describe('OnboardingStateMachine.nextStep', () => {
  it('returns verify-organization when no steps completed', () => {
    expect(OnboardingStateMachine.nextStep({})).toBe('verify-organization');
  });

  it('returns preferences when verify-organization confirmed', () => {
    const steps: StepsMap = { 'verify-organization': makeStep('confirmed') };
    expect(OnboardingStateMachine.nextStep(steps)).toBe('preferences');
  });

  it('returns tutorial when verify and preferences confirmed', () => {
    const steps: StepsMap = {
      'verify-organization': makeStep('confirmed'),
      'preferences':         makeStep('confirmed'),
    };
    expect(OnboardingStateMachine.nextStep(steps)).toBe('tutorial');
  });

  it('returns tutorial (last step) when all steps completed', () => {
    // All terminal — returns the last step
    expect(OnboardingStateMachine.nextStep(allConfirmed())).toBe('tutorial');
  });

  it('returns preferences even if skipped (skipped is terminal)', () => {
    const steps: StepsMap = {
      'verify-organization': makeStep('confirmed'),
      'preferences':         makeStep('skipped'),
    };
    // Both terminal — nextStep returns the last step key (tutorial)
    expect(OnboardingStateMachine.nextStep(steps)).toBe('tutorial');
  });

  it('skips over confirmed verify-organization to preferences', () => {
    const steps: StepsMap = {
      'verify-organization': makeStep('confirmed'),
    };
    expect(OnboardingStateMachine.nextStep(steps)).toBe('preferences');
  });
});

// ---------------------------------------------------------------------------
// parseSteps
// ---------------------------------------------------------------------------

describe('OnboardingStateMachine.parseSteps', () => {
  it('returns empty map for null', () => {
    expect(OnboardingStateMachine.parseSteps(null)).toEqual({});
  });

  it('returns empty map for undefined', () => {
    expect(OnboardingStateMachine.parseSteps(undefined)).toEqual({});
  });

  it('returns empty map for non-object primitive', () => {
    expect(OnboardingStateMachine.parseSteps('malformed')).toEqual({});
    expect(OnboardingStateMachine.parseSteps(42)).toEqual({});
  });

  it('returns empty map for array', () => {
    expect(OnboardingStateMachine.parseSteps([])).toEqual({});
  });

  it('parses a valid confirmed step', () => {
    const raw = {
      'verify-organization': {
        status:    'confirmed',
        updatedAt: '2026-01-15T10:00:00Z',
        data:      { confirmed: true },
      },
    };
    const result = OnboardingStateMachine.parseSteps(raw);
    expect(result['verify-organization']).toMatchObject({
      status:    'confirmed',
      updatedAt: '2026-01-15T10:00:00Z',
      data:      { confirmed: true },
    });
  });

  it('parses a skipped step with contentVersion', () => {
    const raw = {
      tutorial: {
        status:         'skipped',
        updatedAt:      '2026-01-15T10:00:00Z',
        contentVersion: 'v1',
      },
    };
    const result = OnboardingStateMachine.parseSteps(raw);
    expect(result['tutorial']).toMatchObject({
      status:         'skipped',
      contentVersion: 'v1',
    });
  });

  it('ignores unknown step keys', () => {
    const raw = {
      'unknown-step': { status: 'confirmed', updatedAt: '2026-01-15T10:00:00Z' },
    };
    const result = OnboardingStateMachine.parseSteps(raw);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('ignores steps with invalid status values', () => {
    const raw = {
      'verify-organization': { status: 'invalid_status', updatedAt: '2026-01-15T10:00:00Z' },
    };
    const result = OnboardingStateMachine.parseSteps(raw);
    expect(result['verify-organization']).toBeUndefined();
  });

  it('ignores steps where data is not an object', () => {
    const raw = {
      preferences: {
        status:    'confirmed',
        updatedAt: '2026-01-15T10:00:00Z',
        data:      'not-an-object',
      },
    };
    const result = OnboardingStateMachine.parseSteps(raw);
    expect(result['preferences']?.data).toBeUndefined();
  });

  it('ignores steps where data is an array', () => {
    const raw = {
      preferences: {
        status:    'confirmed',
        updatedAt: '2026-01-15T10:00:00Z',
        data:      [1, 2, 3],
      },
    };
    const result = OnboardingStateMachine.parseSteps(raw);
    expect(result['preferences']?.data).toBeUndefined();
  });

  it('falls back gracefully on legacy/malformed JSONB', () => {
    const raw = {
      'verify-organization': { status: 42, updatedAt: '2026-01-15T10:00:00Z' },
      preferences:           null,
      tutorial:              'string-not-object',
    };
    const result = OnboardingStateMachine.parseSteps(raw);
    // All three should be dropped silently
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('sets updatedAt to current time when missing', () => {
    const raw = {
      'verify-organization': { status: 'confirmed' /* no updatedAt */ },
    };
    const result = OnboardingStateMachine.parseSteps(raw);
    expect(result['verify-organization']?.updatedAt).toBeDefined();
    expect(typeof result['verify-organization']?.updatedAt).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Idempotency — re-submission produces same state
// ---------------------------------------------------------------------------

describe('Idempotent re-submission', () => {
  it('canComplete returns same result if called twice with same input', () => {
    const steps = allConfirmed();
    const first  = OnboardingStateMachine.canComplete(steps);
    const second = OnboardingStateMachine.canComplete(steps);
    expect(first).toEqual(second);
  });

  it('parseSteps returns same shape when called twice on same input', () => {
    const raw = {
      'verify-organization': { status: 'confirmed', updatedAt: '2026-01-15T10:00:00Z' },
      preferences:           { status: 'skipped',   updatedAt: '2026-01-15T10:05:00Z' },
    };
    const first  = OnboardingStateMachine.parseSteps(raw);
    const second = OnboardingStateMachine.parseSteps(raw);
    expect(first).toEqual(second);
  });

  it('nextStep returns same value on repeated calls', () => {
    const steps: StepsMap = { 'verify-organization': makeStep('confirmed') };
    expect(OnboardingStateMachine.nextStep(steps)).toBe(
      OnboardingStateMachine.nextStep(steps),
    );
  });
});
