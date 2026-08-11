/**
 * signature.ts – HMAC SHA-256 webhook signing.
 *
 * Signed string: `${unixSeconds}.${rawBody}`
 * Header format (single secret):   `t=${unixSeconds},v1=${hexHmac}`
 * Header format (rotation window): `t=${unixSeconds},v1=${hexCurrent},v1=${hexPrevious}`
 *
 * Receivers MUST:
 *  1. Parse t= to get the timestamp.
 *  2. Compute HMAC SHA-256 of "${t}.${rawBody}" using their secret.
 *  3. Constant-time compare their computed hex to each v1= value.
 *  4. Reject if no v1 matches or if |now – t| > 300 seconds (5 minutes).
 *
 * NOTE: Clock skew on the receiver side larger than 5 minutes must be
 * corrected on the receiver — the sender's timestamp is authoritative.
 */

import { createHmac, timingSafeEqual } from 'crypto';

export interface SignatureResult {
  header: string;
  timestamp: number;
}

/**
 * Signs rawBody with the provided secret(s) and returns the header value.
 *
 * @param rawBody        The exact bytes that will be transmitted.
 * @param secret         Current signing secret (base64url-encoded plaintext).
 * @param previousSecret Previous secret during rotation grace window (optional).
 * @param clock          Timestamp source; injectable for tests.
 */
export function buildSignatureHeader(
  rawBody: string,
  secret: string,
  previousSecret?: string,
  clock: () => number = () => Math.floor(Date.now() / 1000),
): SignatureResult {
  const timestamp = clock();
  const signedPayload = `${timestamp}.${rawBody}`;

  const currentHex = hmacHex(secret, signedPayload);

  if (previousSecret) {
    const previousHex = hmacHex(previousSecret, signedPayload);
    return {
      header: `t=${timestamp},v1=${currentHex},v1=${previousHex}`,
      timestamp,
    };
  }

  return {
    header: `t=${timestamp},v1=${currentHex}`,
    timestamp,
  };
}

/**
 * Verifies an X-OpsNinja-Signature header against the raw body.
 * Returns true if any v1= value matches (handles rotation window).
 *
 * @param header    The full X-OpsNinja-Signature header value.
 * @param rawBody   The raw request body as received.
 * @param secret    The current (or expected) signing secret.
 * @param toleranceSec  Replay window tolerance in seconds (default 300).
 */
export function verifySignatureHeader(
  header: string,
  rawBody: string,
  secret: string,
  toleranceSec = 300,
  clock: () => number = () => Math.floor(Date.now() / 1000),
): boolean {
  const parts = header.split(',');

  let timestamp: number | undefined;
  const signatures: string[] = [];

  for (const part of parts) {
    if (part.startsWith('t=')) {
      timestamp = parseInt(part.slice(2), 10);
    } else if (part.startsWith('v1=')) {
      signatures.push(part.slice(3));
    }
  }

  if (timestamp === undefined || signatures.length === 0) return false;

  const now = clock();
  if (Math.abs(now - timestamp) > toleranceSec) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = hmacHex(secret, signedPayload);
  const expectedBuf = Buffer.from(expected, 'hex');

  return signatures.some((sig) => {
    try {
      const sigBuf = Buffer.from(sig, 'hex');
      if (sigBuf.length !== expectedBuf.length) return false;
      return timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      return false;
    }
  });
}

function hmacHex(secret: string, payload: string): string {
  return createHmac('sha256', Buffer.from(secret, 'base64url')).update(payload).digest('hex');
}
