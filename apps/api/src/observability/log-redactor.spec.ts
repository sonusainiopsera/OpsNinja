import { describe, it, expect } from 'vitest';
import {
  redactString,
  redactValue,
  serializeRequest,
  serializeError,
  PINO_REDACT_PATHS,
} from './log-redactor';

describe('redactString', () => {
  it('removes an email address', () => {
    const result = redactString('Contact us at alice@example.com for help');
    expect(result).not.toContain('alice@example.com');
    expect(result).toContain('[EMAIL]');
  });

  it('removes multiple email addresses in a single string', () => {
    const result = redactString('From: bob@corp.io, CC: carol@vendor.net');
    expect(result).not.toContain('bob@corp.io');
    expect(result).not.toContain('carol@vendor.net');
    expect(result.match(/\[EMAIL\]/g)?.length).toBe(2);
  });

  it('removes an IPv4 address', () => {
    const result = redactString('Client connected from 192.168.1.100');
    expect(result).not.toContain('192.168.1.100');
    expect(result).toContain('[IP]');
  });

  it('removes a phone number (US format)', () => {
    const result = redactString('Call us at 555-867-5309 for support');
    expect(result).not.toContain('555-867-5309');
    expect(result).toContain('[PHONE]');
  });

  it('leaves non-PII strings unchanged', () => {
    const clean = 'Ticket TKT-1234 created by agent';
    expect(redactString(clean)).toBe(clean);
  });
});

describe('redactValue', () => {
  it('redacts email in a nested object', () => {
    const input = {
      user: { email: 'user@test.com', name: 'Alice', role: 'agent' },
    };
    const output = redactValue(input) as typeof input;
    expect(JSON.stringify(output)).not.toContain('user@test.com');
    expect((output.user as Record<string, unknown>)['email']).toContain('[EMAIL]');
    expect((output.user as Record<string, unknown>)['name']).toBe('Alice');
  });

  it('replaces blocked field names with [REDACTED] regardless of value', () => {
    const input = {
      password: 'super-secret-123',
      authorization: 'Bearer eyJ...',
      cookie: 'session=abc',
      username: 'agent01',
    };
    const output = redactValue(input) as Record<string, unknown>;
    expect(output['password']).toBe('[REDACTED]');
    expect(output['authorization']).toBe('[REDACTED]');
    expect(output['cookie']).toBe('[REDACTED]');
    expect(output['username']).toBe('agent01');
  });

  it('redacts values inside arrays', () => {
    const input = ['alice@example.com', 'non-pii', '10.0.0.1'];
    const output = redactValue(input) as string[];
    expect(output).not.toContain('alice@example.com');
    expect(output).not.toContain('10.0.0.1');
    expect(output).toContain('[EMAIL]');
    expect(output).toContain('[IP]');
  });

  it('passes through numbers and booleans unchanged', () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue(true)).toBe(true);
    expect(redactValue(null)).toBeNull();
  });

  it('does not leak seeded email from a deeply nested payload', () => {
    const input = {
      event: {
        actor: { contact: { email: 'seeded@pii.example' } },
      },
    };
    const output = JSON.stringify(redactValue(input));
    expect(output).not.toContain('seeded@pii.example');
  });

  it('caps recursion at maxDepth and returns [DEEP OBJECT]', () => {
    // Build a 7-level deep object
    const deep: Record<string, unknown> = {};
    let cur = deep;
    for (let i = 0; i < 7; i++) {
      const child: Record<string, unknown> = {};
      cur['nested'] = child;
      cur = child;
    }
    cur['value'] = 'leaf';
    const result = redactValue(deep) as Record<string, unknown>;
    // Somewhere in the chain it should hit [DEEP OBJECT]
    expect(JSON.stringify(result)).toContain('[DEEP OBJECT]');
  });
});

describe('serializeRequest', () => {
  it('never emits authorization header', () => {
    const req = {
      id: 'req-1',
      method: 'GET',
      url: '/api/v1/tickets',
      remoteAddress: '10.0.0.1',
      headers: {
        authorization: 'Bearer secret-token',
        cookie: 'session=abc',
        'user-agent': 'Mozilla/5.0',
      },
    };
    const output = serializeRequest(req);
    expect(JSON.stringify(output)).not.toContain('secret-token');
    expect(JSON.stringify(output)).not.toContain('session=abc');
    expect(output['remoteAddress']).toBe('[IP]');
  });

  it('includes safe fields', () => {
    const req = {
      id: 'req-2',
      method: 'POST',
      url: '/api/v1/tickets',
      headers: { 'user-agent': 'test-agent' },
    };
    const output = serializeRequest(req);
    expect(output['method']).toBe('POST');
    expect(output['url']).toBe('/api/v1/tickets');
  });
});

describe('serializeError', () => {
  it('redacts PII from error messages', () => {
    const err = { message: 'User alice@evil.com triggered error', code: 'E_FAIL' };
    const output = serializeError(err);
    expect((output['message'] as string)).not.toContain('alice@evil.com');
    expect((output['message'] as string)).toContain('[EMAIL]');
  });
});

describe('PINO_REDACT_PATHS', () => {
  it('includes authorization and cookie paths', () => {
    expect(PINO_REDACT_PATHS).toContain('req.headers.authorization');
    expect(PINO_REDACT_PATHS).toContain('req.headers.cookie');
  });
});
