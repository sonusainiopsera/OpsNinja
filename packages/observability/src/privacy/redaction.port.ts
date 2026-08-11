/**
 * RedactionPort — injectable abstraction for the audit writer and AI pre-send hook.
 *
 * Both consumers depend on this interface rather than the concrete redactor module,
 * so implementations can be swapped or mocked in tests without changing call sites.
 *
 * NestJS injection token: REDACTION_PORT (string token for module portability).
 */

import { redactObject, redactString as redactStr } from './redactor';

export const REDACTION_PORT = 'REDACTION_PORT';

export interface RedactionPort {
  /**
   * Redact a structured log/audit record.
   * Returns a new object — never mutates input.
   * Never throws: any internal failure produces a REDACTION_ERROR marker.
   */
  redactForLog(record: unknown): unknown;

  /**
   * Redact a record before writing to the audit trail.
   * Identical strategy to redactForLog but can be overridden for stricter rules.
   */
  redactForAudit(record: unknown): unknown;

  /**
   * Redact a free-text string before sending to an external AI provider.
   * Applies pattern-based redaction (email, phone, IP, JWT, AWS key, entropy).
   */
  redactString(text: string): string;
}

/**
 * Default concrete implementation backed by the pure redactor functions.
 * Register this as a NestJS provider using REDACTION_PORT token:
 *
 *   { provide: REDACTION_PORT, useClass: DefaultRedactionService }
 */
export class DefaultRedactionService implements RedactionPort {
  redactForLog(record: unknown): unknown {
    return redactObject(record);
  }

  redactForAudit(record: unknown): unknown {
    return redactObject(record);
  }

  redactString(text: string): string {
    return redactStr(text);
  }
}
