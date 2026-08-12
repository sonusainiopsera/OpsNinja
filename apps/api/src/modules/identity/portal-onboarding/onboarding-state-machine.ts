/**
 * OnboardingStateMachine — WO-088.
 *
 * Pure module (no I/O, no framework dependencies) describing:
 *   - Step keys and display order
 *   - Required vs skippable semantics
 *   - Allowed status values per step
 *   - canComplete predicate
 *   - nextStep helper
 *
 * Designed to be unit-testable in isolation and shared between the service
 * and the DTO validation layer.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const STEP_KEYS = ['verify-organization', 'preferences', 'tutorial'] as const;
export type StepKey = typeof STEP_KEYS[number];

export type StepStatus = 'pending' | 'confirmed' | 'skipped';

export interface StepEntry {
  status: StepStatus;
  updatedAt: string;        // ISO-8601
  data?: Record<string, unknown>;
  contentVersion?: string;  // for tutorial re-prompt
}

export type StepsMap = Partial<Record<StepKey, StepEntry>>;

// ---------------------------------------------------------------------------
// Step metadata
// ---------------------------------------------------------------------------

interface StepMeta {
  key:       StepKey;
  required:  boolean;  // if true, 'skipped' does NOT satisfy completion
  skippable: boolean;  // if true, 'skip' action is allowed
}

const STEP_DEFINITIONS: StepMeta[] = [
  { key: 'verify-organization', required: true,  skippable: false },
  { key: 'preferences',         required: true,  skippable: true  },
  { key: 'tutorial',            required: false, skippable: true  },
];

// ---------------------------------------------------------------------------
// OnboardingStateMachine
// ---------------------------------------------------------------------------

export class OnboardingStateMachine {
  // ---------------------------------------------------------------------------
  // canComplete — all required steps must be in a terminal state
  // ---------------------------------------------------------------------------

  static canComplete(steps: StepsMap): { ok: boolean; outstanding: StepKey[] } {
    const outstanding: StepKey[] = [];

    for (const def of STEP_DEFINITIONS) {
      if (!def.required) continue;

      const entry = steps[def.key];
      const status = entry?.status ?? 'pending';

      // Required but not skippable: must be 'confirmed'
      // Required and skippable:      'confirmed' or 'skipped' both satisfy
      const satisfied =
        status === 'confirmed' ||
        (def.skippable && status === 'skipped');

      if (!satisfied) {
        outstanding.push(def.key);
      }
    }

    return { ok: outstanding.length === 0, outstanding };
  }

  // ---------------------------------------------------------------------------
  // nextStep — first pending/uncompleted step in order
  // ---------------------------------------------------------------------------

  static nextStep(steps: StepsMap): StepKey {
    for (const def of STEP_DEFINITIONS) {
      const entry = steps[def.key];
      if (!entry || entry.status === 'pending') {
        return def.key;
      }
    }
    // All steps have a status — wizard is at the final step
    return STEP_DEFINITIONS[STEP_DEFINITIONS.length - 1]!.key;
  }

  // ---------------------------------------------------------------------------
  // isTerminal — whether a step is in a terminal state
  // ---------------------------------------------------------------------------

  static isTerminal(status: StepStatus): boolean {
    return status === 'confirmed' || status === 'skipped';
  }

  // ---------------------------------------------------------------------------
  // canSkip — whether skipping is allowed for a step
  // ---------------------------------------------------------------------------

  static canSkip(step: StepKey): boolean {
    return STEP_DEFINITIONS.find((d) => d.key === step)?.skippable ?? false;
  }

  // ---------------------------------------------------------------------------
  // isRequired
  // ---------------------------------------------------------------------------

  static isRequired(step: StepKey): boolean {
    return STEP_DEFINITIONS.find((d) => d.key === step)?.required ?? false;
  }

  // ---------------------------------------------------------------------------
  // stepOrder — return display-ordered steps
  // ---------------------------------------------------------------------------

  static stepOrder(): StepKey[] {
    return STEP_DEFINITIONS.map((d) => d.key);
  }

  // ---------------------------------------------------------------------------
  // parseSteps — Zod-guarded JSONB parse with fallback on unknown shape
  // ---------------------------------------------------------------------------

  static parseSteps(raw: unknown): StepsMap {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {};
    }
    const result: StepsMap = {};
    for (const key of STEP_KEYS) {
      const entry = (raw as Record<string, unknown>)[key];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const e = entry as Record<string, unknown>;
      const status = e['status'];
      if (status !== 'pending' && status !== 'confirmed' && status !== 'skipped') continue;
      result[key] = {
        status:         status as StepStatus,
        updatedAt:      typeof e['updatedAt'] === 'string' ? e['updatedAt'] : new Date().toISOString(),
        data:           typeof e['data'] === 'object' && !Array.isArray(e['data']) && e['data'] !== null
                          ? (e['data'] as Record<string, unknown>)
                          : undefined,
        contentVersion: typeof e['contentVersion'] === 'string' ? e['contentVersion'] : undefined,
      };
    }
    return result;
  }
}
