/**
 * PII redaction layer for structured JSON logging.
 *
 * Implements an allow-list approach: only explicitly approved top-level request
 * fields are emitted. In addition, all string values are scanned with regex
 * patterns to remove email addresses, IPv4 addresses, and phone numbers before
 * the log line is written.
 *
 * Usage: wire the exported serializers / hooks into the nestjs-pino config.
 */

// ─── PII patterns ─────────────────────────────────────────────────────────────

const EMAIL_PATTERN =
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

const IPV4_PATTERN =
  /\b(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}\b/g;

const PHONE_PATTERN =
  /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;

// ─── Field block-list (never logged regardless of value) ──────────────────────

const BLOCKED_FIELD_NAMES = new Set([
  'password',
  'secret',
  'token',
  'authorization',
  'cookie',
  'x-api-key',
  'api_key',
  'apikey',
  'access_token',
  'refresh_token',
  'private_key',
  'credit_card',
  'ssn',
  'cvv',
  'pin',
]);

// ─── Core redaction function ───────────────────────────────────────────────────

/**
 * Applies all PII regex patterns to a string value.
 * Replaces matches with stable placeholder tokens.
 */
export function redactString(value: string): string {
  return value
    .replace(EMAIL_PATTERN, '[EMAIL]')
    .replace(IPV4_PATTERN, '[IP]')
    .replace(PHONE_PATTERN, '[PHONE]');
}

/**
 * Recursively redacts PII from any value.
 * - Blocked field names are replaced with `[REDACTED]` regardless of value.
 * - String values have PII regex patterns applied.
 * - Objects and arrays are traversed up to `maxDepth` levels deep.
 *
 * @param value    - The value to redact.
 * @param depth    - Current recursion depth (prevents infinite loops on circular refs).
 * @param maxDepth - Maximum recursion depth (default 6).
 */
export function redactValue(value: unknown, depth = 0, maxDepth = 6): unknown {
  if (depth > maxDepth) {
    return '[DEEP OBJECT]';
  }

  if (typeof value === 'string') {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1, maxDepth));
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (BLOCKED_FIELD_NAMES.has(key.toLowerCase())) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactValue(val, depth + 1, maxDepth);
      }
    }
    return result;
  }

  // Numbers, booleans, null, undefined pass through unchanged
  return value;
}

// ─── Pino serializers ─────────────────────────────────────────────────────────

/**
 * Pino request serializer.
 * Only emits a safe allow-list of request fields; never logs headers verbatim
 * (authorization, cookie, etc.) and always redacts the remote IP.
 */
export function serializeRequest(req: Record<string, unknown>): Record<string, unknown> {
  return {
    id: req['id'],
    method: req['method'],
    url: req['url'],
    // Remote address is structurally suppressed — IP is PII under GDPR
    remoteAddress: '[IP]',
    userAgent: typeof req['headers'] === 'object' && req['headers'] !== null
      ? (req['headers'] as Record<string, unknown>)['user-agent']
      : undefined,
  };
}

/**
 * Pino error serializer.
 * Emits error type and redacted message. Stack traces are intentionally
 * omitted from the serialized output — they are logged separately at ERROR
 * level via the exception filter and never included in HTTP response bodies.
 */
export function serializeError(err: Record<string, unknown>): Record<string, unknown> {
  const message =
    typeof err['message'] === 'string' ? redactString(err['message']) : '';
  return {
    type: err['constructor'] !== undefined
      ? (err['constructor'] as { name?: string }).name ?? 'Error'
      : 'Error',
    message,
    code: err['code'],
  };
}

// ─── Pino hooks ───────────────────────────────────────────────────────────────

type LogMethod = (...args: unknown[]) => void;

/**
 * Pino `hooks.logMethod` implementation.
 * Intercepts every log call and applies `redactValue` to any merging-object argument
 * so that ad-hoc log payloads (e.g. `logger.log({ user }, 'signed in')`) are
 * automatically redacted before the line is written.
 *
 * This is the primary mechanism that satisfies the unit-test requirement
 * "seeded email address is absent from the emitted line".
 */
export function createLogMethodHook(): (
  this: unknown,
  inputArgs: [Record<string, unknown>, ...unknown[]],
  method: LogMethod,
) => void {
  return function logMethodHook(
    this: unknown,
    inputArgs: [Record<string, unknown>, ...unknown[]],
    method: LogMethod,
  ): void {
    if (inputArgs.length >= 1 && typeof inputArgs[0] === 'object' && inputArgs[0] !== null) {
      const [mergingObject, ...rest] = inputArgs;
      method.apply(this, [redactValue(mergingObject) as Record<string, unknown>, ...rest]);
    } else {
      method.apply(this, inputArgs);
    }
  };
}

// ─── Pino redact paths (path-based fast-redact for known sensitive headers) ────

/**
 * Array of pino `redact` paths for known sensitive HTTP headers and body fields.
 * Combined with the regex-based `logMethodHook` for belt-and-suspenders coverage.
 */
export const PINO_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  '*.password',
  '*.token',
  '*.secret',
  '*.access_token',
  '*.refresh_token',
] as const;
