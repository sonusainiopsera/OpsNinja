/**
 * Jira webhook signature verifier — WO-054.
 *
 * Jira signs webhook deliveries with HMAC-SHA-256. OpsNinja uses two headers:
 *   X-Hub-Signature:    sha256=<lowercase hex>   — HMAC over `${timestamp}.${rawBody}`
 *   X-OpsNinja-Timestamp: <unix seconds>         — used in the signed payload
 *
 * Verification steps:
 *  1. Parse X-OpsNinja-Timestamp; reject non-integer or missing values.
 *  2. Reject if |now - timestamp| > toleranceSeconds (default 300, i.e. 5 minutes).
 *  3. Parse sha256=<hex> from X-Hub-Signature; reject malformed values.
 *  4. Compute HMAC-SHA-256 over `${timestamp}.${rawBody}` using the current secret.
 *  5. If a previousSecret is provided (rotation grace window), compute a second HMAC.
 *  6. Accept if either HMAC matches using timingSafeEqual.
 *
 * The comparison is constant-time to prevent timing oracle attacks. The raw body
 * is a Buffer so no charset re-encoding can alter the signed bytes.
 */

import { createHmac, timingSafeEqual } from 'crypto';

export type VerifyFailureReason =
  | 'missing_header'
  | 'malformed_header'
  | 'stale_signature'
  | 'signature_mismatch';

export interface VerifyResult {
  valid: boolean;
  reason?: VerifyFailureReason;
}

export interface JiraSignatureVerifyInput {
  rawBody: Buffer;
  /** Value of the X-Hub-Signature header, e.g. "sha256=abcd1234…" */
  hubSignatureHeader: string | undefined;
  /** Value of the X-OpsNinja-Timestamp header, e.g. "1712345678" */
  timestampHeader: string | undefined;
  /** Current HMAC secret (plaintext, fetched from vault). */
  secret: string;
  /** Previous secret active during the rotation overlap window. */
  previousSecret?: string;
  /** Allowed replay window in seconds (default 300). */
  toleranceSeconds?: number;
  /** Override clock for testing. Returns current Unix seconds. */
  clock?: () => number;
}

/**
 * Verify the HMAC-SHA-256 signature on an inbound Jira webhook request.
 *
 * Returns `{ valid: true }` on success, or `{ valid: false, reason }` on
 * any failure. Callers must never log `reason` in responses (no information
 * disclosure to potential attackers).
 */
export function verifyJiraWebhookSignature(input: JiraSignatureVerifyInput): VerifyResult {
  const {
    rawBody,
    hubSignatureHeader,
    timestampHeader,
    secret,
    previousSecret,
    toleranceSeconds = 300,
    clock = () => Math.floor(Date.now() / 1000),
  } = input;

  // ── 1. Presence check ─────────────────────────────────────────────────────
  if (!hubSignatureHeader || !timestampHeader) {
    return { valid: false, reason: 'missing_header' };
  }

  // ── 2. Parse timestamp ────────────────────────────────────────────────────
  const timestamp = parseInt(timestampHeader, 10);
  if (!Number.isFinite(timestamp) || String(timestamp) !== timestampHeader.trim()) {
    return { valid: false, reason: 'malformed_header' };
  }

  // ── 3. Replay window ──────────────────────────────────────────────────────
  const now = clock();
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return { valid: false, reason: 'stale_signature' };
  }

  // ── 4. Parse X-Hub-Signature: sha256=<hex> ────────────────────────────────
  if (!hubSignatureHeader.startsWith('sha256=')) {
    return { valid: false, reason: 'malformed_header' };
  }
  const receivedHex = hubSignatureHeader.slice('sha256='.length).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(receivedHex)) {
    return { valid: false, reason: 'malformed_header' };
  }
  const receivedBuf = Buffer.from(receivedHex, 'hex');

  // ── 5. Compute and compare ────────────────────────────────────────────────
  const secrets = previousSecret ? [secret, previousSecret] : [secret];

  for (const s of secrets) {
    const signed = Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]);
    const expected = createHmac('sha256', s).update(signed).digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');

    if (expectedBuf.length === receivedBuf.length) {
      try {
        if (timingSafeEqual(expectedBuf, receivedBuf)) {
          return { valid: true };
        }
      } catch {
        // Buffer lengths mismatch guard (should not happen after length check)
      }
    }
  }

  return { valid: false, reason: 'signature_mismatch' };
}

/**
 * Build the X-Hub-Signature and X-OpsNinja-Timestamp headers for outbound
 * webhook signing (used in test helpers and the secret rotation CLI).
 */
export function buildJiraWebhookHeaders(
  rawBody: Buffer,
  secret: string,
  unixTimestamp: number,
): { 'X-Hub-Signature': string; 'X-OpsNinja-Timestamp': string } {
  const signed = Buffer.concat([Buffer.from(`${unixTimestamp}.`), rawBody]);
  const hmac = createHmac('sha256', secret).update(signed).digest('hex');
  return {
    'X-Hub-Signature': `sha256=${hmac}`,
    'X-OpsNinja-Timestamp': String(unixTimestamp),
  };
}
