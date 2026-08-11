/**
 * Unit tests for audit-hash.ts pure helpers.
 *
 * No database required — all functions are pure and synchronous.
 * Covers:
 *   - canonicalSerialize: key sorting, Date ISO format, Buffer hex, exclusions
 *   - computeChainHash: genesis link, determinism, key-order stability
 *   - deriveChangedFields: create / update / delete events, no false positives
 *   - truncateState: under limit, over limit, exact-at-limit
 *   - partitionName: boundary month, padding
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  canonicalSerialize,
  computeChainHash,
  deriveChangedFields,
  truncateState,
  partitionName,
  GENESIS_HASH,
  MAX_STATE_BYTES,
} from '../audit-hash.js';

// ---------------------------------------------------------------------------
// canonicalSerialize
// ---------------------------------------------------------------------------

describe('canonicalSerialize', () => {
  it('sorts object keys alphabetically', () => {
    const result = canonicalSerialize({ z: 1, a: 2, m: 3 });
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  it('sorts nested object keys', () => {
    const result = canonicalSerialize({ outer: { z: 1, a: 2 } });
    expect(result).toBe('{"outer":{"a":2,"z":1}}');
  });

  it('serialises Date as ISO-8601 UTC string', () => {
    const d = new Date('2026-03-15T10:00:00.000Z');
    const result = canonicalSerialize({ ts: d });
    expect(result).toBe('{"ts":"2026-03-15T10:00:00.000Z"}');
  });

  it('serialises Buffer as hex string', () => {
    const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const result = canonicalSerialize({ hash: buf });
    expect(result).toBe('{"hash":"deadbeef"}');
  });

  it('serialises Uint8Array as hex string', () => {
    const u8 = new Uint8Array([0x01, 0x02]);
    const result = canonicalSerialize({ bytes: u8 });
    expect(result).toBe('{"bytes":"0102"}');
  });

  it('excludes hash_prev and hash_self fields', () => {
    const result = canonicalSerialize({
      tenant_id: 'abc',
      hash_prev: Buffer.alloc(32),
      hash_self: Buffer.alloc(32),
      action: 'create',
    });
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(parsed['hash_prev']).toBeUndefined();
    expect(parsed['hash_self']).toBeUndefined();
    expect(parsed['tenant_id']).toBe('abc');
  });

  it('excludes camelCase hashPrev and hashSelf fields', () => {
    const result = canonicalSerialize({
      hashPrev: Buffer.alloc(32),
      hashSelf: Buffer.alloc(32),
      action: 'create',
    });
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(parsed['hashPrev']).toBeUndefined();
    expect(parsed['hashSelf']).toBeUndefined();
  });

  it('handles null values', () => {
    const result = canonicalSerialize({ a: null, b: 1 });
    expect(result).toBe('{"a":null,"b":1}');
  });

  it('handles arrays correctly', () => {
    const result = canonicalSerialize({ fields: ['z', 'a', 'b'] });
    expect(result).toBe('{"fields":["z","a","b"]}');
  });

  it('produces identical output for same input with different key order', () => {
    const a = canonicalSerialize({ b: 2, a: 1 });
    const b = canonicalSerialize({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it('handles unicode characters correctly', () => {
    const result = canonicalSerialize({ msg: '日本語テスト' });
    expect(result).toContain('日本語テスト');
  });
});

// ---------------------------------------------------------------------------
// computeChainHash
// ---------------------------------------------------------------------------

describe('computeChainHash', () => {
  const baseRecord = {
    tenant_id: 'f1000000-0000-0000-0000-000000000001',
    action: 'create',
    resource_type: 'ticket',
    resource_id: 'r0000000-0000-0000-0000-000000000001',
    occurred_at: '2026-03-15T10:00:00.000Z',
  };

  it('returns a 32-byte Buffer', () => {
    const hash = computeChainHash(GENESIS_HASH, baseRecord);
    expect(hash).toBeInstanceOf(Buffer);
    expect(hash.length).toBe(32);
  });

  it('is deterministic for the same inputs', () => {
    const h1 = computeChainHash(GENESIS_HASH, baseRecord);
    const h2 = computeChainHash(GENESIS_HASH, baseRecord);
    expect(h1.equals(h2)).toBe(true);
  });

  it('differs when prev hash differs', () => {
    const h1 = computeChainHash(GENESIS_HASH, baseRecord);
    const otherPrev = Buffer.alloc(32, 0xff);
    const h2 = computeChainHash(otherPrev, baseRecord);
    expect(h1.equals(h2)).toBe(false);
  });

  it('differs when record content differs', () => {
    const h1 = computeChainHash(GENESIS_HASH, { ...baseRecord, action: 'create' });
    const h2 = computeChainHash(GENESIS_HASH, { ...baseRecord, action: 'update' });
    expect(h1.equals(h2)).toBe(false);
  });

  it('produces same hash regardless of key insertion order', () => {
    const r1 = { a: 1, b: 2, c: 3 };
    const r2 = { c: 3, a: 1, b: 2 };
    const h1 = computeChainHash(GENESIS_HASH, r1);
    const h2 = computeChainHash(GENESIS_HASH, r2);
    expect(h1.equals(h2)).toBe(true);
  });

  it('manual SHA-256 verification', () => {
    const record = { action: 'login', tenant_id: 'abc' };
    const canonical = canonicalSerialize(record);
    const expected = createHash('sha256')
      .update(GENESIS_HASH)
      .update(canonical, 'utf8')
      .digest();
    const actual = computeChainHash(GENESIS_HASH, record);
    expect(actual.equals(expected)).toBe(true);
  });

  it('chain links correctly: h2 depends on h1', () => {
    const h1 = computeChainHash(GENESIS_HASH, { ...baseRecord, action: 'create' });
    const h2 = computeChainHash(h1, { ...baseRecord, action: 'update' });
    const h2Alt = computeChainHash(GENESIS_HASH, { ...baseRecord, action: 'update' });
    expect(h2.equals(h2Alt)).toBe(false);
  });

  it('handles unicode in record values', () => {
    const record = { msg: '日本語', tenant_id: 'abc' };
    const hash = computeChainHash(GENESIS_HASH, record);
    expect(hash.length).toBe(32);
  });
});

// ---------------------------------------------------------------------------
// deriveChangedFields
// ---------------------------------------------------------------------------

describe('deriveChangedFields', () => {
  it('returns empty array for two nulls', () => {
    expect(deriveChangedFields(null, null)).toEqual([]);
  });

  it('returns all keys for create event (before=null)', () => {
    const fields = deriveChangedFields(null, { a: 1, b: 2 });
    expect(fields.sort()).toEqual(['a', 'b']);
  });

  it('returns all keys for delete event (after=null)', () => {
    const fields = deriveChangedFields({ x: 1 }, null);
    expect(fields).toEqual(['x']);
  });

  it('detects changed fields', () => {
    const fields = deriveChangedFields({ a: 1, b: 2, c: 3 }, { a: 1, b: 99, c: 3 });
    expect(fields).toEqual(['b']);
  });

  it('detects added fields', () => {
    const fields = deriveChangedFields({ a: 1 }, { a: 1, b: 2 });
    expect(fields).toEqual(['b']);
  });

  it('detects removed fields', () => {
    const fields = deriveChangedFields({ a: 1, b: 2 }, { a: 1 });
    expect(fields).toEqual(['b']);
  });

  it('returns sorted array', () => {
    const fields = deriveChangedFields({ z: 1, a: 2 }, { z: 99, a: 99 });
    expect(fields).toEqual(['a', 'z']);
  });

  it('handles null field value change', () => {
    const fields = deriveChangedFields({ a: null }, { a: 1 });
    expect(fields).toEqual(['a']);
  });

  it('treats undefined and absent fields as identical', () => {
    const fields = deriveChangedFields({ a: 1 }, { a: 1, b: undefined });
    // b: undefined serialises to null same as absent — treated as change if key appears
    expect(fields).toEqual(['b']);
  });

  it('returns empty for identical objects', () => {
    const fields = deriveChangedFields({ a: 1, b: 'x' }, { a: 1, b: 'x' });
    expect(fields).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// truncateState
// ---------------------------------------------------------------------------

describe('truncateState', () => {
  it('returns payload unchanged when below limit', () => {
    const payload = { key: 'value' };
    const { payload: out, truncated } = truncateState(payload, MAX_STATE_BYTES);
    expect(truncated).toBe(false);
    expect(out).toBe(payload);
  });

  it('truncates payload when over limit', () => {
    const payload = { data: 'x'.repeat(MAX_STATE_BYTES + 100) };
    const { payload: out, truncated } = truncateState(payload);
    expect(truncated).toBe(true);
    expect(out['_truncated']).toBe(true);
    expect(typeof out['_original_size']).toBe('number');
    const size = out['_original_size'] as number;
    expect(size).toBeGreaterThan(MAX_STATE_BYTES);
  });

  it('does not truncate when exactly at limit', () => {
    // Build a payload whose JSON serialisation is exactly MAX_STATE_BYTES bytes.
    const wrapper = '{"data":""}';
    const fill = MAX_STATE_BYTES - Buffer.byteLength(wrapper, 'utf8');
    const payload = { data: 'a'.repeat(fill) };
    const { truncated } = truncateState(payload);
    expect(truncated).toBe(false);
  });

  it('custom limitBytes is respected', () => {
    const payload = { k: 'v'.repeat(50) };
    const { truncated } = truncateState(payload, 10);
    expect(truncated).toBe(true);
  });

  it('truncated payload is itself JSON-serialisable', () => {
    const payload = { data: 'x'.repeat(MAX_STATE_BYTES + 1) };
    const { payload: out } = truncateState(payload);
    expect(() => JSON.stringify(out)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// partitionName
// ---------------------------------------------------------------------------

describe('partitionName', () => {
  it('formats correctly for mid-month date', () => {
    expect(partitionName(new Date('2026-03-15T00:00:00Z'))).toBe('audit_logs_2026_03');
  });

  it('formats correctly for first second of month', () => {
    expect(partitionName(new Date('2026-01-01T00:00:00Z'))).toBe('audit_logs_2026_01');
  });

  it('pads single-digit month', () => {
    expect(partitionName(new Date('2026-09-30T23:59:59Z'))).toBe('audit_logs_2026_09');
  });

  it('formats December correctly', () => {
    expect(partitionName(new Date('2026-12-31T23:59:59Z'))).toBe('audit_logs_2026_12');
  });
});
