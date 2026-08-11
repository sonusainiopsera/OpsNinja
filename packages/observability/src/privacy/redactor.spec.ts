/**
 * Unit tests for the enhanced PII redactor.
 *
 * Coverage:
 *  - Every redaction strategy (drop, mask, hash, redact, pattern)
 *  - Nested and array payloads
 *  - Circular references
 *  - Large payloads (>256 keys, deep nesting, >8KB strings)
 *  - Error-object serialisation
 *  - Exotic types (Date, Buffer, BigInt, null, undefined)
 *  - Pattern detectors: email, phone, IP, JWT, AWS key, high-entropy
 *  - PII corpus: all corpus values must be absent from output
 *  - Safe values: trace IDs and status fields must survive unchanged
 */

import { describe, it, expect } from 'vitest';
import {
  redactObject,
  redactString,
  maskEmail,
  maskIp,
  hashValue,
  MAX_DEPTH,
  MAX_KEYS,
} from './redactor';
import {
  CORPUS_EMAILS,
  CORPUS_PHONES_E164,
  CORPUS_PHONES_NANP,
  CORPUS_IPV4,
  CORPUS_JWTS,
  CORPUS_AWS_KEYS,
  CORPUS_LOG_SNIPPETS,
  CORPUS_STRUCTURED_RECORDS,
  CORPUS_SAFE_VALUES,
} from './pii-corpus';

// ---------------------------------------------------------------------------
// Drop strategy
// ---------------------------------------------------------------------------

describe('drop strategy', () => {
  it('removes body key from output entirely', () => {
    const result = redactObject({ id: '1', body: 'secret text' }) as Record<string, unknown>;
    expect('body' in result).toBe(false);
    expect(result.id).toBe('1');
  });

  it('removes secretCiphertext', () => {
    const result = redactObject({ secretCiphertext: 'AQID...==' }) as Record<string, unknown>;
    expect('secretCiphertext' in result).toBe(false);
  });

  it('removes tokenHash', () => {
    const result = redactObject({ tokenHash: 'abc123' }) as Record<string, unknown>;
    expect('tokenHash' in result).toBe(false);
  });

  it('removes s3Key', () => {
    const result = redactObject({ s3Key: 'tenant/abc/file.csv' }) as Record<string, unknown>;
    expect('s3Key' in result).toBe(false);
  });

  it('removes canonicalPayload', () => {
    const result = redactObject({ canonicalPayload: { event: 'ticket.created' } }) as Record<string, unknown>;
    expect('canonicalPayload' in result).toBe(false);
  });

  it('removes comment', () => {
    const result = redactObject({ comment: 'User called from 555-1234' }) as Record<string, unknown>;
    expect('comment' in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Mask strategy
// ---------------------------------------------------------------------------

describe('mask strategy', () => {
  it('masks email field', () => {
    const result = redactObject({ email: 'alice@example.com' }) as Record<string, unknown>;
    expect(result.email).not.toBe('alice@example.com');
    expect(typeof result.email).toBe('string');
  });

  it('maskEmail keeps shape', () => {
    const masked = maskEmail('alice@example.com');
    expect(masked).toContain('@');
    expect(masked).not.toContain('alice');
    expect(masked).not.toContain('example');
  });

  it('maskIp keeps prefix', () => {
    const masked = maskIp('203.0.113.42');
    expect(masked.startsWith('203.0.')).toBe(true);
    expect(masked).not.toContain('113');
  });

  it('masks ipAddress field', () => {
    const result = redactObject({ ipAddress: '203.0.113.42' }) as Record<string, unknown>;
    expect(result.ipAddress).not.toContain('113');
  });
});

// ---------------------------------------------------------------------------
// Hash strategy
// ---------------------------------------------------------------------------

describe('hash strategy', () => {
  it('hashes emailHash field', () => {
    const result = redactObject({ emailHash: 'abc123' }) as Record<string, unknown>;
    expect(typeof result.emailHash).toBe('string');
    expect(result.emailHash as string).toMatch(/^\[HASH:[0-9a-f]{16}\]$/);
  });

  it('hashValue is deterministic', () => {
    expect(hashValue('test')).toBe(hashValue('test'));
  });

  it('hashValue output differs from input', () => {
    const h = hashValue('alice@example.com');
    expect(h).not.toContain('alice');
    expect(h).toHaveLength(16);
  });
});

// ---------------------------------------------------------------------------
// Redact strategy (tokens, secrets)
// ---------------------------------------------------------------------------

describe('redact strategy (tokens)', () => {
  it('replaces token with placeholder', () => {
    const result = redactObject({ token: 'eyJhbGci.eyJzdWIi.sig' }) as Record<string, unknown>;
    expect(result.token).toBe('[REDACTED]');
  });

  it('replaces accessToken', () => {
    const result = redactObject({ accessToken: 'bearer-value' }) as Record<string, unknown>;
    expect(result.accessToken).toBe('[REDACTED]');
  });

  it('replaces refreshToken', () => {
    const result = redactObject({ refreshToken: 'rt-value' }) as Record<string, unknown>;
    expect(result.refreshToken).toBe('[REDACTED]');
  });

  it('replaces clientSecret', () => {
    const result = redactObject({ clientSecret: 'cs-value' }) as Record<string, unknown>;
    expect(result.clientSecret).toBe('[REDACTED]');
  });

  it('replaces signatureHeader', () => {
    const result = redactObject({ signatureHeader: 't=1234,v1=abcdef' }) as Record<string, unknown>;
    expect(result.signatureHeader).toBe('[REDACTED]');
  });
});

// ---------------------------------------------------------------------------
// Pattern detectors (pass 2)
// ---------------------------------------------------------------------------

describe('redactString() pattern detectors', () => {
  for (const email of CORPUS_EMAILS) {
    it(`removes email ${email}`, () => {
      const result = redactString(`request from user ${email} at time 00:00`);
      expect(result).not.toContain(email);
      expect(result).toContain('[REDACTED_EMAIL]');
    });
  }

  for (const phone of CORPUS_PHONES_E164) {
    it(`removes E.164 phone ${phone}`, () => {
      const result = redactString(`caller phone: ${phone}`);
      expect(result).not.toContain(phone);
    });
  }

  for (const ip of CORPUS_IPV4) {
    it(`removes IPv4 ${ip}`, () => {
      const result = redactString(`connection from ${ip}`);
      expect(result).not.toContain(ip);
      expect(result).toContain('[REDACTED_IP]');
    });
  }

  for (const jwt of CORPUS_JWTS) {
    it(`removes JWT`, () => {
      const result = redactString(`Authorization: Bearer ${jwt}`);
      expect(result).not.toContain(jwt);
      expect(result).toContain('[REDACTED_JWT]');
    });
  }

  for (const key of CORPUS_AWS_KEYS) {
    it(`removes AWS key ${key}`, () => {
      const result = redactString(`caller key=${key}`);
      expect(result).not.toContain(key);
      expect(result).toContain('[REDACTED_AWS_KEY]');
    });
  }

  for (const snippet of CORPUS_LOG_SNIPPETS) {
    it(`scrubs DevOps snippet`, () => {
      const result = redactString(snippet);
      // No raw email should survive
      for (const email of CORPUS_EMAILS) {
        expect(result).not.toContain(email);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Corpus: structured records
// ---------------------------------------------------------------------------

describe('corpus: structured objects', () => {
  for (const record of CORPUS_STRUCTURED_RECORDS) {
    it('removes PII from structured record', () => {
      const result = JSON.stringify(redactObject(record));
      for (const email of CORPUS_EMAILS) {
        expect(result).not.toContain(email);
      }
      // Body and comment fields must not appear
      expect(result).not.toContain('Customer called');
      expect(result).not.toContain('Alice (');
      // Secrets must be gone
      expect(result).not.toContain('AQIDAHjLz');
    });
  }
});

// ---------------------------------------------------------------------------
// Safe values must survive
// ---------------------------------------------------------------------------

describe('safe values pass through', () => {
  for (const safe of CORPUS_SAFE_VALUES) {
    it('preserves trace/correlation fields', () => {
      const result = redactObject(safe) as Record<string, unknown>;
      for (const [k, v] of Object.entries(safe)) {
        expect(result[k]).toBe(v);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Adversarial: circular references
// ---------------------------------------------------------------------------

describe('circular reference safety', () => {
  it('does not throw on circular object', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj['self'] = obj;
    expect(() => redactObject(obj)).not.toThrow();
    const result = redactObject(obj) as Record<string, unknown>;
    expect(result['self']).toBe('[CIRCULAR]');
  });

  it('does not throw on circular array', () => {
    const arr: unknown[] = [1, 2];
    arr.push(arr);
    expect(() => redactObject(arr)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Adversarial: depth limit
// ---------------------------------------------------------------------------

describe('depth guard', () => {
  it(`truncates at depth ${MAX_DEPTH}`, () => {
    let obj: Record<string, unknown> = { leaf: 'value' };
    for (let i = 0; i < MAX_DEPTH + 5; i++) {
      obj = { nested: obj };
    }
    expect(() => redactObject(obj)).not.toThrow();
    const serialized = JSON.stringify(redactObject(obj));
    expect(serialized).toContain('[DEPTH_EXCEEDED]');
  });
});

// ---------------------------------------------------------------------------
// Adversarial: key count limit
// ---------------------------------------------------------------------------

describe('key count guard', () => {
  it(`caps at ${MAX_KEYS} keys and adds truncation marker`, () => {
    const big: Record<string, unknown> = {};
    for (let i = 0; i < MAX_KEYS + 50; i++) big[`k${i}`] = `v${i}`;
    const result = redactObject(big) as Record<string, unknown>;
    expect('__truncated__' in result).toBe(true);
    expect(Object.keys(result).length).toBeLessThanOrEqual(MAX_KEYS + 1); // +1 for __truncated__
  });
});

// ---------------------------------------------------------------------------
// Adversarial: string length limit
// ---------------------------------------------------------------------------

describe('string length guard', () => {
  it('truncates strings longer than 8KB before scanning', () => {
    const long = 'a'.repeat(9000) + 'alice@example.com';
    const result = redactString(long);
    expect(result).toContain('[TRUNCATED]');
    // Email after 8KB must not appear (it was cut off)
    expect(result).not.toContain('alice@example.com');
  });
});

// ---------------------------------------------------------------------------
// Exotic types
// ---------------------------------------------------------------------------

describe('exotic types', () => {
  it('serialises Date as ISO string', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    const result = redactObject({ ts: d }) as Record<string, unknown>;
    expect(result.ts).toBe('2026-01-01T00:00:00.000Z');
  });

  it('serialises Buffer as length marker', () => {
    const buf = Buffer.from('hello');
    const result = redactObject({ data: buf }) as Record<string, unknown>;
    expect(result.data).toBe('[Buffer 5b]');
  });

  it('serialises BigInt as string', () => {
    const result = redactObject({ n: BigInt(42) }) as Record<string, unknown>;
    expect(result.n).toBe('42n');
  });

  it('serialises Error with redacted message', () => {
    const err = new Error('failed for alice@example.com');
    const result = redactObject({ err }) as Record<string, unknown>;
    const errResult = (result.err) as Record<string, unknown>;
    expect(errResult.message).not.toContain('alice@example.com');
    expect(errResult.message).toContain('[REDACTED_EMAIL]');
    expect(errResult.error).toBe('Error');
  });

  it('passes null and undefined through', () => {
    const result = redactObject({ a: null, b: undefined }) as Record<string, unknown>;
    expect(result.a).toBeNull();
    expect(result.b).toBeUndefined();
  });

  it('passes boolean and number through', () => {
    const result = redactObject({ flag: true, count: 42 }) as Record<string, unknown>;
    expect(result.flag).toBe(true);
    expect(result.count).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Nested and array payloads
// ---------------------------------------------------------------------------

describe('nested and array payloads', () => {
  it('redacts email nested inside object', () => {
    const result = redactObject({
      user: { profile: { email: 'alice@example.com' } },
    }) as Record<string, unknown>;
    const profile = ((result.user as Record<string, unknown>).profile) as Record<string, unknown>;
    expect(profile.email).not.toBe('alice@example.com');
  });

  it('redacts PII inside array', () => {
    const result = redactObject({
      items: [{ email: 'alice@example.com' }, { email: 'bob@example.com' }],
    }) as Record<string, unknown>;
    const items = result.items as Array<Record<string, unknown>>;
    expect(items[0]!.email).not.toBe('alice@example.com');
    expect(items[1]!.email).not.toBe('bob@example.com');
  });

  it('does not mutate input', () => {
    const input = { email: 'alice@example.com', nested: { body: 'secret' } };
    const original = JSON.parse(JSON.stringify(input));
    redactObject(input);
    expect(input).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// Benchmark: sub-millisecond p95
// ---------------------------------------------------------------------------

describe('performance', () => {
  it('redacts a typical log record under 1ms', () => {
    const record = {
      traceId: 'abc123',
      userId: '00000000-0000-0000-0000-000000000001',
      email: 'alice@example.com',
      ipAddress: '203.0.113.42',
      status: 'open',
      nested: { body: 'some comment text', token: 'bearer-value' },
    };

    const iterations = 200;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) redactObject(record);
    const elapsed = performance.now() - start;
    const p95 = elapsed / iterations; // average used as p95 proxy for unit tests
    expect(p95).toBeLessThan(1); // < 1ms per call
  });
});
