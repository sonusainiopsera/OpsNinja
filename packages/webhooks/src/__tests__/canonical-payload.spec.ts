import { stableStringify, buildCanonicalPayload, WebhookEventEnvelope } from '../canonical-payload';

const ENVELOPE: WebhookEventEnvelope = {
  id: 'evt-001',
  type: 'ticket.created',
  occurredAt: '2025-06-01T12:00:00.000Z',
  tenantId: 'tenant-abc',
  data: { ticketId: 'tkt-1', priority: 'p1' },
};

// ── Golden file (deterministic output must not change) ────────────────────────
const GOLDEN = '{"id":"evt-001","type":"ticket.created","occurredAt":"2025-06-01T12:00:00.000Z","tenantId":"tenant-abc","data":{"priority":"p1","ticketId":"tkt-1"}}';

describe('stableStringify', () => {
  it('sorts object keys lexicographically', () => {
    expect(stableStringify({ z: 1, a: 2, m: 3 })).toBe('{"a":2,"m":3,"z":1}');
  });

  it('sorts nested object keys', () => {
    const result = stableStringify({ b: { d: 1, c: 2 }, a: 0 });
    expect(result).toBe('{"a":0,"b":{"c":2,"d":1}}');
  });

  it('preserves array element order', () => {
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('handles arrays of objects (keys sorted per element)', () => {
    const result = stableStringify([{ z: 1, a: 2 }, { b: 3 }]);
    expect(result).toBe('[{"a":2,"z":1},{"b":3}]');
  });

  it('handles null', () => {
    expect(stableStringify(null)).toBe('null');
  });

  it('handles primitives', () => {
    expect(stableStringify(42)).toBe('42');
    expect(stableStringify('hello')).toBe('"hello"');
    expect(stableStringify(true)).toBe('true');
  });

  it('produces identical output on repeated calls (determinism)', () => {
    const a = stableStringify({ x: [1, 2], y: { b: 1, a: 2 } });
    const b = stableStringify({ x: [1, 2], y: { b: 1, a: 2 } });
    expect(a).toBe(b);
  });
});

describe('buildCanonicalPayload', () => {
  it('matches the golden file exactly', () => {
    expect(buildCanonicalPayload(ENVELOPE)).toBe(GOLDEN);
  });

  it('top-level key order is always id, type, occurredAt, tenantId, data', () => {
    const json = buildCanonicalPayload(ENVELOPE);
    const parsed = JSON.parse(json);
    const keys = Object.keys(parsed);
    expect(keys[0]).toBe('id');
    expect(keys[1]).toBe('type');
    expect(keys[2]).toBe('occurredAt');
    expect(keys[3]).toBe('tenantId');
    expect(keys[4]).toBe('data');
  });

  it('data sub-keys are sorted even when insertion order differs', () => {
    const env: WebhookEventEnvelope = { ...ENVELOPE, data: { z: 1, a: 2, m: 3 } };
    const json = buildCanonicalPayload(env);
    const parsed = JSON.parse(json);
    expect(Object.keys(parsed.data)).toEqual(['a', 'm', 'z']);
  });

  it('is stable across different source key insertion orders', () => {
    const env1: WebhookEventEnvelope = { ...ENVELOPE, data: { b: 2, a: 1 } };
    const env2: WebhookEventEnvelope = { ...ENVELOPE, data: { a: 1, b: 2 } };
    expect(buildCanonicalPayload(env1)).toBe(buildCanonicalPayload(env2));
  });
});
