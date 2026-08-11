import { describe, it, expect } from 'vitest';
import { AnonymisationValidator } from '../src/validation/anonymisation-validator';
import { SeededRandom } from '../src/prng';
import { buildUsers } from '../src/factories/user.factory';
import { buildOrganizations } from '../src/factories/organization.factory';

const validator = new AnonymisationValidator();
const NOW = new Date('2025-06-15T12:00:00Z');

describe('AnonymisationValidator', () => {
  it('accepts records with allowed email domains', () => {
    const result = validator.validate([
      { email: 'alice@example.com', name: 'Alice' },
      { email: 'bob@example.org', name: 'Bob' },
      { email: 'test@test.invalid', name: 'Test' },
    ]);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('rejects real email domains', () => {
    const result = validator.validate([
      { email: 'user@gmail.com', name: 'User' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.rule === 'REAL_EMAIL_DOMAIN')).toBe(true);
  });

  it('rejects US phone numbers', () => {
    const result = validator.validate([
      { phone: '555-867-5309', name: 'Contact' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.rule === 'PHONE_PATTERN')).toBe(true);
  });

  it('rejects IPv4 addresses', () => {
    const result = validator.validate([
      { server: '192.168.1.100', name: 'Server' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.rule === 'IPV4_ADDRESS')).toBe(true);
  });

  it('rejects AWS access keys', () => {
    const result = validator.validate([
      { metadata: { key: 'AKIAIOSFODNN7EXAMPLE' } },
    ]);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.rule === 'AWS_ACCESS_KEY')).toBe(true);
  });

  it('validates generated user records as clean', () => {
    const rng = new SeededRandom(42);
    const users = buildUsers(rng, 'tenant-1', 50, NOW);
    const records = users.map((u) => u.record) as unknown as Record<string, unknown>[];
    const result = validator.validate(records);
    expect(result.valid).toBe(true);
  });

  it('validates generated organization records as clean', () => {
    const rng = new SeededRandom(42);
    const orgs = buildOrganizations(rng, 'tenant-1', 12, NOW);
    const records = orgs.map((o) => o.record) as unknown as Record<string, unknown>[];
    const result = validator.validate(records);
    expect(result.valid).toBe(true);
  });

  it('returns all violations, not just the first', () => {
    const result = validator.validate([
      { email: 'bad@gmail.com', phone: '555-123-4567' },
    ]);
    expect(result.violations.length).toBeGreaterThan(1);
  });

  it('handles nested objects', () => {
    const result = validator.validate([
      { user: { contact: { email: 'real@yahoo.com' } } },
    ]);
    expect(result.valid).toBe(false);
    expect(result.violations[0]!.field).toContain('user.contact.email');
  });

  it('handles arrays of objects', () => {
    const result = validator.validate([
      {
        users: [
          { email: 'ok@example.com' },
          { email: 'bad@hotmail.com' },
        ],
      },
    ]);
    expect(result.valid).toBe(false);
  });
});
