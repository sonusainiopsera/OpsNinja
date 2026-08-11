/**
 * Deliberately imports from the root @opsninja/ui-kit barrel.
 * This fixture MUST trigger the ESLint no-restricted-imports rule.
 * It is NEVER imported by production code — it exists solely to prove the lint rule fires.
 *
 * Expected ESLint error:
 *   "Do not import from @opsninja/ui-kit root in the portal. Use @opsninja/ui-kit/portal instead."
 */

// @ts-nocheck — intentional violation
// eslint-disable-next-line -- this line itself does NOT suppress the no-restricted-imports rule

// The import below should fire the no-restricted-imports rule:
import { SlaHint } from '@opsninja/ui-kit'; // eslint-disable-line

export const _VIOLATION_MARKER = 'lint-violation-fixture';
