/**
 * Opaque keyset cursor for organization list pagination.
 *
 * Format (internal):
 *   payload = JSON.stringify({ c: createdAt.toISOString(), i: id, v: 1 })
 *   cursor  = base64url(payload)
 *
 * Tamper detection:
 *   Decoding checks that the payload parses, that both fields are present,
 *   that `c` is a valid ISO-8601 date, and that `i` is a valid UUID.
 *   A malformed or truncated cursor returns null so the caller can return 400.
 *
 * No HMAC is used for simplicity — the cursor carries no secret data and its
 * worst-case misuse is triggering a benign keyset query with bad parameters,
 * which the validation guards catch.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CursorPayload {
  /** ISO-8601 createdAt timestamp of the last row in the previous page. */
  createdAt: Date;
  /** UUID of the last row in the previous page. */
  id: string;
}

/**
 * Encode a keyset position into an opaque cursor string.
 */
export function encodeCursor(payload: CursorPayload): string {
  const raw = JSON.stringify({ c: payload.createdAt.toISOString(), i: payload.id, v: 1 });
  return Buffer.from(raw).toString('base64url');
}

/**
 * Decode an opaque cursor string back to a keyset position.
 *
 * Returns null if the cursor is malformed, tampered or missing required fields.
 * Callers must return 400 on null.
 */
export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const obj = JSON.parse(raw) as unknown;
    if (typeof obj !== 'object' || obj === null) return null;

    const { c, i } = obj as Record<string, unknown>;
    if (typeof c !== 'string' || typeof i !== 'string') return null;

    const createdAt = new Date(c);
    if (isNaN(createdAt.getTime())) return null;
    if (!UUID_RE.test(i)) return null;

    return { createdAt, id: i };
  } catch {
    return null;
  }
}
