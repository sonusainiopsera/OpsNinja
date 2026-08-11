import { createHmac, timingSafeEqual } from 'crypto';
import { BaseAppError } from '../errors/base-error';

/** Hard cap on maximum page size. Cursors encoding a limit above this are rejected. */
export const LIMIT_CAP = 100;

/** Opaque cursor payload. */
export interface CursorPayload {
  /** The last-seen unique identifier, used as the anchor for the next page. */
  id: string;
  /** Optional ISO-8601 timestamp for multi-column sort stability. */
  ts?: string;
  /** Additional sort-stable fields for complex orderings. */
  [key: string]: string | undefined;
}

/** Standard list response envelope returned by all paginated endpoints. */
export interface ListEnvelope<T> {
  items: T[];
  /** Opaque, HMAC-tagged cursor for the next page, or null if this is the last page. */
  next_cursor: string | null;
}

/**
 * Error thrown when a cursor fails HMAC verification (tampered or produced by a different key).
 * Maps to HTTP 400 with code INVALID_CURSOR.
 */
export class TamperedCursorError extends BaseAppError {
  constructor() {
    super('INVALID_CURSOR', 'Cursor is invalid or has been tampered with', 400, []);
    this.name = 'TamperedCursorError';
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function encodeBase64Url(data: string): string {
  return Buffer.from(data, 'utf8').toString('base64url');
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf8');
}

function computeHmac(encoded: string, secret: string): string {
  return createHmac('sha256', secret).update(encoded).digest('base64url');
}

/**
 * Timing-safe string comparison.
 * Even when the lengths differ we run the comparison with a zero buffer
 * to avoid leaking length information via timing.
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Run a dummy comparison to keep timing consistent
    timingSafeEqual(bufA, Buffer.alloc(bufA.length, 0));
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Encodes a cursor payload into a tamper-evident opaque string.
 * Format: `<base64url(JSON(payload))>.<base64url(HMAC-SHA256(encoded, secret))>`
 */
export function encodeCursor(payload: CursorPayload, secret: string): string {
  const data = JSON.stringify(payload);
  const encoded = encodeBase64Url(data);
  const hmac = computeHmac(encoded, secret);
  return `${encoded}.${hmac}`;
}

/**
 * Decodes and verifies a cursor string.
 * Throws `TamperedCursorError` (HTTP 400) if the HMAC does not match
 * or the format is malformed — this covers expired HMAC keys too.
 */
export function decodeCursor(cursor: string, secret: string): CursorPayload {
  const dotIndex = cursor.lastIndexOf('.');
  if (dotIndex <= 0) {
    throw new TamperedCursorError();
  }

  const encoded = cursor.slice(0, dotIndex);
  const providedHmac = cursor.slice(dotIndex + 1);

  const expectedHmac = computeHmac(encoded, secret);

  if (!safeEqual(providedHmac, expectedHmac)) {
    throw new TamperedCursorError();
  }

  try {
    const data = decodeBase64Url(encoded);
    return JSON.parse(data) as CursorPayload;
  } catch {
    throw new TamperedCursorError();
  }
}

/**
 * Applies the hard limit cap.
 * @param requested - The limit requested by the client.
 * @returns `min(requested, LIMIT_CAP)`.
 */
export function applyLimitCap(requested: number): number {
  return Math.min(requested, LIMIT_CAP);
}

/**
 * Builds a standard `ListEnvelope`.
 *
 * @param items     - The page of items (already sliced to the requested limit).
 * @param hasMore   - Whether additional items exist beyond this page.
 * @param lastItem  - The last item in `items`; used to build the next cursor.
 * @param getPayload - Function that extracts the cursor payload from an item.
 * @param secret    - HMAC secret for cursor signing.
 */
export function buildListEnvelope<T>(
  items: T[],
  hasMore: boolean,
  lastItem: T | undefined,
  getPayload: (item: T) => CursorPayload,
  secret: string,
): ListEnvelope<T> {
  const next_cursor =
    hasMore && lastItem !== undefined ? encodeCursor(getPayload(lastItem), secret) : null;
  return { items, next_cursor };
}
