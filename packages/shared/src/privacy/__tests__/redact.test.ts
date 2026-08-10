import { describe, it, expect } from 'vitest';
import {
  redact,
  isClassifiedField,
  classifyField,
  REDACTED_SENTINEL,
  HASHED_PREFIX,
} from '../redact.js';

describe('redact', () => {
  it('passes through non-PII fields unchanged', () => {
    const input = { id: 'uuid-1', status: 'open', priority: 'P1', attempts: 3 };
    expect(redact(input)).toEqual(input);
  });

  it('replaces email (Confidential) with [REDACTED]', () => {
    const result = redact({ email: 'alice@example.com', id: 'uuid-1' }) as Record<string, unknown>;
    expect(result['email']).toBe(REDACTED_SENTINEL);
    expect(result['id']).toBe('uuid-1');
  });

  it('replaces comment body (Confidential) with [REDACTED]', () => {
    const result = redact({ body: 'Internal note about PII' }) as Record<string, unknown>;
    expect(result['body']).toBe(REDACTED_SENTINEL);
  });

  it('replaces token (Restricted) with SHA-256 hash', () => {
    const result = redact({ token: 'secret-token-value' }) as Record<string, unknown>;
    const hashed = result['token'] as string;
    expect(hashed.startsWith(HASHED_PREFIX)).toBe(true);
    expect(hashed.endsWith(']')).toBe(true);
    expect(hashed).not.toContain('secret-token-value');
  });

  it('hashes apiKey (Restricted) deterministically', () => {
    const input = { apiKey: 'my-api-key-123' };
    const first = redact(input) as Record<string, unknown>;
    const second = redact(input) as Record<string, unknown>;
    expect(first['apiKey']).toBe(second['apiKey']);
  });

  it('redacts nested PII in nested objects', () => {
    const result = redact({
      organization: { id: 'org-1', contactEmail: 'bob@example.com', region: 'us-east-1' },
    }) as Record<string, unknown>;
    const org = result['organization'] as Record<string, unknown>;
    expect(org['contactEmail']).toBe(REDACTED_SENTINEL);
    expect(org['id']).toBe('org-1');
    expect(org['region']).toBe('us-east-1');
  });

  it('redacts PII inside arrays', () => {
    const result = redact([{ email: 'a@b.com' }, { email: 'c@d.com' }]) as Array<Record<string, unknown>>;
    expect(result[0]?.['email']).toBe(REDACTED_SENTINEL);
    expect(result[1]?.['email']).toBe(REDACTED_SENTINEL);
  });

  it('does not mutate the original object', () => {
    const original = { email: 'a@b.com', id: 'x' };
    redact(original);
    expect(original.email).toBe('a@b.com');
  });

  it('handles null and undefined gracefully', () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });

  it('handles primitive strings (pass-through)', () => {
    expect(redact('hello')).toBe('hello');
  });
});

describe('isClassifiedField', () => {
  it('returns true for email', () => {
    expect(isClassifiedField('email')).toBe(true);
  });

  it('returns true for token', () => {
    expect(isClassifiedField('token')).toBe(true);
  });

  it('returns false for non-PII field', () => {
    expect(isClassifiedField('status')).toBe(false);
    expect(isClassifiedField('id')).toBe(false);
  });
});

describe('classifyField', () => {
  it('classifies email as confidential', () => {
    expect(classifyField('email')).toBe('confidential');
  });

  it('classifies body as confidential', () => {
    expect(classifyField('body')).toBe('confidential');
  });

  it('classifies token as restricted', () => {
    expect(classifyField('token')).toBe('restricted');
  });

  it('classifies status as public', () => {
    expect(classifyField('status')).toBe('public');
  });
});
