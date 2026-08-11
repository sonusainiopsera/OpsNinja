import { DefaultRedactor } from '../redaction.port';

describe('DefaultRedactor', () => {
  const redactor = new DefaultRedactor();

  it('returns null for null input', () => {
    expect(redactor.redact(null)).toBeNull();
  });

  it('redacts email addresses in string values', () => {
    const result = redactor.redact({ contact: 'user@example.com' }) as Record<string, unknown>;
    expect(result.contact).toBe('[REDACTED_EMAIL]');
  });

  it('redacts sensitive key names regardless of value', () => {
    const result = redactor.redact({ password: 'hunter2', secret: 'abc123' }) as Record<string, unknown>;
    expect(result.password).toBe('[REDACTED]');
    expect(result.secret).toBe('[REDACTED]');
  });

  it('does not redact safe keys', () => {
    const result = redactor.redact({ status: 'open', priority: 'p1' }) as Record<string, unknown>;
    expect(result.status).toBe('open');
    expect(result.priority).toBe('p1');
  });

  it('redacts nested objects recursively', () => {
    const result = redactor.redact({
      user: { email: 'a@b.com', name: 'Alice' },
    }) as Record<string, unknown>;
    const user = result.user as Record<string, unknown>;
    expect(user.email).toBe('[REDACTED_EMAIL]');
    expect(user.name).toBe('Alice');
  });

  it('redacts email inside string arrays', () => {
    const result = redactor.redact({ emails: ['user@example.com', 'other@test.org'] }) as Record<string, unknown>;
    const emails = result.emails as string[];
    expect(emails[0]).toBe('[REDACTED_EMAIL]');
    expect(emails[1]).toBe('[REDACTED_EMAIL]');
  });

  it('redacts IPv4 addresses', () => {
    const result = redactor.redact({ ip: '192.168.1.1' }) as Record<string, unknown>;
    expect(result.ip).toBe('[REDACTED_IP]');
  });

  it('does not alter non-string non-object primitives', () => {
    const result = redactor.redact({ count: 42, active: true }) as Record<string, unknown>;
    expect(result.count).toBe(42);
    expect(result.active).toBe(true);
  });

  it('returns a deep copy (does not mutate input)', () => {
    const input = { status: 'open', password: 'secret' };
    const result = redactor.redact(input);
    expect(input.password).toBe('secret');
    expect((result as Record<string, unknown>).password).toBe('[REDACTED]');
  });
});
