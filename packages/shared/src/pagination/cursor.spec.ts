import { describe, it, expect } from 'vitest';
import {
  encodeCursor,
  decodeCursor,
  applyLimitCap,
  buildListEnvelope,
  TamperedCursorError,
  LIMIT_CAP,
} from './cursor';

const SECRET = 'a-test-secret-that-is-at-least-32-chars-long!!';

describe('cursor helpers', () => {
  describe('encodeCursor / decodeCursor', () => {
    it('round-trips a simple cursor payload', () => {
      const payload = { id: '01HQX8K7M2VVTZ4XGXQNZRD5AB' };
      const cursor = encodeCursor(payload, SECRET);
      expect(typeof cursor).toBe('string');
      expect(cursor).not.toContain(payload.id); // must be opaque (base64url-encoded)
      const decoded = decodeCursor(cursor, SECRET);
      expect(decoded).toEqual(payload);
    });

    it('round-trips a cursor with optional timestamp and extra fields', () => {
      const payload = {
        id: 'ticket-999',
        ts: '2024-01-15T12:00:00.000Z',
        sort_key: 'priority',
      };
      const cursor = encodeCursor(payload, SECRET);
      const decoded = decodeCursor(cursor, SECRET);
      expect(decoded).toEqual(payload);
    });

    it('throws TamperedCursorError for a truncated cursor', () => {
      const cursor = encodeCursor({ id: 'abc' }, SECRET);
      const truncated = cursor.slice(0, cursor.length - 10);
      expect(() => decodeCursor(truncated, SECRET)).toThrow(TamperedCursorError);
    });

    it('throws TamperedCursorError for a mutated HMAC', () => {
      const cursor = encodeCursor({ id: 'abc' }, SECRET);
      const lastDot = cursor.lastIndexOf('.');
      const mutated = cursor.slice(0, lastDot + 1) + 'AAAAAAAAAAAAA';
      expect(() => decodeCursor(mutated, SECRET)).toThrow(TamperedCursorError);
    });

    it('throws TamperedCursorError when signed with a different secret (key rotation)', () => {
      const cursor = encodeCursor({ id: 'abc' }, SECRET);
      const differentSecret = 'b-completely-different-secret-at-least-32-chars!!';
      expect(() => decodeCursor(cursor, differentSecret)).toThrow(TamperedCursorError);
    });

    it('throws TamperedCursorError for a cursor with no dot separator', () => {
      expect(() => decodeCursor('nodotthere', SECRET)).toThrow(TamperedCursorError);
    });

    it('throws TamperedCursorError for a cursor with invalid base64url data', () => {
      const hmac = 'validhmac';
      const invalidData = '!!!notbase64url!!!';
      // Even if HMAC were valid (it won't be), invalid base64 should still fail
      expect(() => decodeCursor(`${invalidData}.${hmac}`, SECRET)).toThrow(TamperedCursorError);
    });

    it('TamperedCursorError maps to HTTP 400 with stable code', () => {
      const err = new TamperedCursorError();
      expect(err.httpStatus).toBe(400);
      expect(err.code).toBe('INVALID_CURSOR');
    });
  });

  describe('applyLimitCap', () => {
    it(`caps values above ${LIMIT_CAP}`, () => {
      expect(applyLimitCap(200)).toBe(LIMIT_CAP);
      expect(applyLimitCap(101)).toBe(LIMIT_CAP);
    });

    it('passes through values at or below the cap', () => {
      expect(applyLimitCap(LIMIT_CAP)).toBe(LIMIT_CAP);
      expect(applyLimitCap(50)).toBe(50);
      expect(applyLimitCap(1)).toBe(1);
    });

    it('handles zero', () => {
      expect(applyLimitCap(0)).toBe(0);
    });
  });

  describe('buildListEnvelope', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const getPayload = (item: { id: string }) => ({ id: item.id });

    it('returns null next_cursor when hasMore is false', () => {
      const envelope = buildListEnvelope(items, false, items[items.length - 1], getPayload, SECRET);
      expect(envelope.items).toEqual(items);
      expect(envelope.next_cursor).toBeNull();
    });

    it('returns an encoded cursor when hasMore is true', () => {
      const lastItem = items[items.length - 1]!;
      const envelope = buildListEnvelope(items, true, lastItem, getPayload, SECRET);
      expect(envelope.next_cursor).not.toBeNull();
      // Verify the cursor decodes to the last item
      const decoded = decodeCursor(envelope.next_cursor!, SECRET);
      expect(decoded).toEqual(getPayload(lastItem));
    });

    it('returns null next_cursor when lastItem is undefined', () => {
      const envelope = buildListEnvelope([], true, undefined, getPayload, SECRET);
      expect(envelope.next_cursor).toBeNull();
    });
  });

  describe('concurrent cursor isolation', () => {
    it('distinct payloads produce distinct cursors', () => {
      const c1 = encodeCursor({ id: 'first' }, SECRET);
      const c2 = encodeCursor({ id: 'second' }, SECRET);
      expect(c1).not.toBe(c2);

      const d1 = decodeCursor(c1, SECRET);
      const d2 = decodeCursor(c2, SECRET);
      expect(d1.id).toBe('first');
      expect(d2.id).toBe('second');
    });
  });
});
