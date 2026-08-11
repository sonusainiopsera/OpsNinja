/**
 * Log redactor — backward-compatibility shim.
 *
 * This module forwards all calls to the enhanced privacy/redactor.ts
 * (WO-094).  The three exported functions are preserved so existing call
 * sites in webhooks, CSAT and notification modules require no changes.
 *
 * New code should import directly from '@opsninja/observability' (which
 * re-exports the full set of privacy utilities).
 */

export {
  redactEmailsInString,
  redactLogObject,
  toRedactedLogString,
} from './privacy/redactor';
