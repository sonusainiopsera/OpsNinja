/**
 * Unit tests for PII redaction (WO-016).
 *
 * Asserts that email addresses, phone numbers, raw IP addresses,
 * and free-text fields are stripped from structured log records
 * before they leave the process boundary.
 */

import {
  redactLogRecord,
  redactString,
  containsEmail,
  containsPhone,
  containsIp,
  redactPhone,
  redactIp,
} from '@opsninja/observability';

// ── redactLogRecord ───────────────────────────────────────────────────────────

describe('redactLogRecord', () => {
  it('redacts known PII field names regardless of value', () => {
    const log = {
      email: 'user@example.com',
      phone: '+44 7700 900000',
      ipAddress: '192.168.1.1',
      rawIp: '10.0.0.1',
      message: 'Processing request',
    };
    redactLogRecord(log);
    expect(log.email).toBe('[REDACTED]');
    expect(log.phone).toBe('[REDACTED]');
    expect(log.ipAddress).toBe('[REDACTED]');
    expect(log.rawIp).toBe('[REDACTED]');
    expect(log.message).toBe('[REDACTED]');
  });

  it('redacts email addresses embedded in arbitrary string values', () => {
    const log = { detail: 'User alice@example.com logged in from 203.0.113.1' };
    redactLogRecord(log);
    expect(containsEmail(log.detail)).toBe(false);
    expect(log.detail).toContain('[REDACTED_EMAIL]');
  });

  it('redacts IPv4 addresses from string values', () => {
    const log = { context: 'Request from 203.0.113.1 failed' };
    redactLogRecord(log);
    expect(containsIp(log.context)).toBe(false);
    expect(log.context).toContain('[REDACTED_IP]');
  });

  it('recursively redacts nested objects', () => {
    const log = {
      outer: 'safe',
      inner: {
        email: 'nested@example.com',
        deep: { phone: '+12125551234' },
      },
    };
    redactLogRecord(log);
    expect((log.inner as Record<string, unknown>)['email']).toBe('[REDACTED]');
    expect(
      ((log.inner as Record<string, unknown>)['deep'] as Record<string, unknown>)['phone'],
    ).toBe('[REDACTED]');
  });

  it('does NOT redact safe fields', () => {
    const log = { traceId: 'abc123', event: 'auth.token_refreshed', outcome: 'success' };
    redactLogRecord(log);
    expect(log.traceId).toBe('abc123');
    expect(log.event).toBe('auth.token_refreshed');
    expect(log.outcome).toBe('success');
  });

  it('redacts free-text "body" and "comment" fields', () => {
    const log = {
      comment: 'Please call me at 07700 900000',
      body: 'Email me at test@example.com',
    };
    redactLogRecord(log);
    expect(log.comment).toBe('[REDACTED]');
    expect(log.body).toBe('[REDACTED]');
  });
});

// ── containsEmail / containsPhone / containsIp ────────────────────────────────

describe('PII detection helpers', () => {
  it('containsEmail detects email addresses', () => {
    expect(containsEmail('user@example.com')).toBe(true);
    expect(containsEmail('no email here')).toBe(false);
  });

  it('containsPhone detects phone number patterns', () => {
    expect(containsPhone('+44 7700 900000')).toBe(true);
    expect(containsPhone('just a number 42')).toBe(false);
  });

  it('containsIp detects IPv4 addresses', () => {
    expect(containsIp('203.0.113.1')).toBe(true);
    expect(containsIp('no ip here')).toBe(false);
  });
});

// ── redactString ──────────────────────────────────────────────────────────────

describe('redactString', () => {
  it('replaces email pattern with [REDACTED_EMAIL]', () => {
    const result = redactString('Hello admin@example.com, your request was processed.');
    expect(result).toBe('Hello [REDACTED_EMAIL], your request was processed.');
    expect(containsEmail(result)).toBe(false);
  });
});

// ── redactPhone / redactIp ────────────────────────────────────────────────────

describe('redactPhone', () => {
  it('removes phone number from string', () => {
    const result = redactPhone('Call us at +44 7700 900000 for support.');
    expect(result).toContain('[REDACTED_PHONE]');
  });
});

describe('redactIp', () => {
  it('removes IPv4 from string', () => {
    const result = redactIp('Request from 198.51.100.1 was blocked.');
    expect(result).toContain('[REDACTED_IP]');
    expect(containsIp(result)).toBe(false);
  });
});
