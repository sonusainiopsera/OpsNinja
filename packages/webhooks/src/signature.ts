/**
 * Webhook HMAC-SHA-256 signature module.
 *
 * Signature format: t={unixSeconds},v1={hexHmacSha256}
 *
 * The signed bytes are: `${timestamp}.${rawBody}` (timestamp string + literal dot + raw body).
 * The timestamp is an integer Unix seconds string.
 *
 * During rotation grace window, both the current and previous secrets are used:
 *   t={unix},v1={hexCurrent},v1={hexPrevious}
 *
 * Receiver verification recipe:
 *  1. Extract t= and all v1= parts from the header.
 *  2. Check that now - t <= 300 seconds (5-minute replay window).
 *  3. Compute HMAC-SHA-256(secret, `${t}.${rawBody}`).
 *  4. Compare hex output to each v1= value using a timing-safe comparison.
 *  5. Accept if any v1 matches.
 */

import { createHmac, timingSafeEqual } from 'crypto';

export interface SignatureInput {
  rawBody: string;
  unixTimestamp: number;
  /** Current signing secret (plaintext). */
  secret: string;
  /** Previous secret during rotation grace window (plaintext). If absent, single v1 emitted. */
  previousSecret?: string;
}

export interface SignatureVerifyInput {
  rawBody: string;
  header: string;
  secret: string;
  /** Allowed skew in seconds. Default 300 (5 minutes). */
  toleranceSeconds?: number;
  clock?: () => number;
}

/** Compute HMAC-SHA-256 of `${unixTimestamp}.${rawBody}` using the provided secret. */
function computeHmac(secret: string, unixTimestamp: number, rawBody: string): string {
  const payload = `${unixTimestamp}.${rawBody}`;
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

/**
 * Build the X-OpsNinja-Signature header value.
 * Produces t=unix,v1=hex for normal delivery,
 * or t=unix,v1=current,v1=previous for rotation.
 */
export function buildSignatureHeader(input: SignatureInput): string {
  const { rawBody, unixTimestamp, secret, previousSecret } = input;

  const currentHmac = computeHmac(secret, unixTimestamp, rawBody);
  let header = `t=${unixTimestamp},v1=${currentHmac}`;

  if (previousSecret) {
    const previousHmac = computeHmac(previousSecret, unixTimestamp, rawBody);
    header += `,v1=${previousHmac}`;
  }

  return header;
}

export interface VerifyResult {
  valid: boolean;
  reason?: 'replay_attack' | 'signature_mismatch' | 'malformed_header';
}

/**
 * Verify an incoming X-OpsNinja-Signature header.
 * Uses timing-safe comparison to prevent timing oracle attacks.
 */
export function verifySignatureHeader(input: SignatureVerifyInput): VerifyResult {
  const { rawBody, header, secret, toleranceSeconds = 300, clock = () => Math.floor(Date.now() / 1000) } = input;

  // Parse header: t=<unix>,v1=<hex>[,v1=<hex>]
  const parts = header.split(',');
  let timestamp: number | undefined;
  const v1Values: string[] = [];

  for (const part of parts) {
    if (part.startsWith('t=')) {
      timestamp = parseInt(part.slice(2), 10);
    } else if (part.startsWith('v1=')) {
      v1Values.push(part.slice(3));
    }
  }

  if (timestamp === undefined || v1Values.length === 0) {
    return { valid: false, reason: 'malformed_header' };
  }

  // Replay window check
  const now = clock();
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return { valid: false, reason: 'replay_attack' };
  }

  // Compute expected HMAC
  const expected = computeHmac(secret, timestamp, rawBody);
  const expectedBuf = Buffer.from(expected, 'hex');

  // Compare against each v1 value (timing-safe)
  for (const v1 of v1Values) {
    if (v1.length !== 64) continue;
    try {
      if (timingSafeEqual(expectedBuf, Buffer.from(v1, 'hex'))) {
        return { valid: true };
      }
    } catch {
      // Invalid hex — continue
    }
  }

  return { valid: false, reason: 'signature_mismatch' };
}
