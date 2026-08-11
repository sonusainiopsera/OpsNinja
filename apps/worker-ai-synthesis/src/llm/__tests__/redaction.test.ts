import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  redactText,
  redactThread,
  containsRedactableContent,
  REDACTION_RULES,
} from '../redaction.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '../../../../test/fixtures/threads');

// ---------------------------------------------------------------------------
// Helper: load PII fixture thread
// ---------------------------------------------------------------------------

function loadPiiFixture() {
  const raw = readFileSync(resolve(FIXTURES_DIR, 'pii-thread.json'), 'utf8');
  return JSON.parse(raw) as { thread: Array<{ body: string }> };
}

// ---------------------------------------------------------------------------
// Email redaction
// ---------------------------------------------------------------------------

describe('email redaction', () => {
  it('redacts a plain email address', () => {
    expect(redactText('Contact us at john.doe@example.com for help.')).not.toContain('@');
  });

  it('redacts email in a sentence', () => {
    const result = redactText('Please email support@company.co.uk');
    expect(result).toContain('[EMAIL]');
    expect(result).not.toMatch(/support@company/);
  });

  it('redacts email with plus addressing', () => {
    const result = redactText('Sent to user+tag@domain.org');
    expect(result).toContain('[EMAIL]');
  });

  it('preserves text around email', () => {
    const result = redactText('Call us or email help@example.com now.');
    expect(result).toMatch(/^Call us or email \[EMAIL\] now\.$/);
  });
});

// ---------------------------------------------------------------------------
// Phone redaction
// ---------------------------------------------------------------------------

describe('phone redaction', () => {
  it('redacts US format (555) 123-4567', () => {
    expect(redactText('Call (555) 123-4567 now')).toContain('[PHONE]');
  });

  it('redacts E.164 format +1 555 123 4567', () => {
    expect(redactText('International: +1 555 123 4567')).toContain('[PHONE]');
  });

  it('redacts dot-separated phone 555.123.4567', () => {
    expect(redactText('555.123.4567 is the number')).toContain('[PHONE]');
  });
});

// ---------------------------------------------------------------------------
// IP address redaction
// ---------------------------------------------------------------------------

describe('IP address redaction', () => {
  it('redacts IPv4 address', () => {
    const result = redactText('Server at 192.168.1.100 is unreachable.');
    expect(result).toContain('[IP]');
    expect(result).not.toContain('192.168');
  });

  it('redacts IPv4 loopback', () => {
    expect(redactText('localhost 127.0.0.1')).toContain('[IP]');
  });

  it('redacts IPv6 address', () => {
    expect(redactText('IPv6: 2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toContain('[IP]');
  });
});

// ---------------------------------------------------------------------------
// Bearer token redaction
// ---------------------------------------------------------------------------

describe('bearer token redaction', () => {
  it('redacts Bearer token header value', () => {
    const result = redactText('Authorization: Bearer abc123def456ghi789');
    expect(result).toContain('[KEY_HEADER]');
    expect(result).not.toContain('abc123def456ghi789');
  });

  it('redacts Bearer token inline', () => {
    const result = redactText('Token used: Bearer eyJhbGciOiJSUzI1NiJ9.payload.signature');
    expect(result).not.toMatch(/eyJhbGciOiJSUzI1NiJ9/);
  });
});

// ---------------------------------------------------------------------------
// API key redaction
// ---------------------------------------------------------------------------

describe('API key redaction', () => {
  it('redacts AWS access key ID', () => {
    const result = redactText('Key: AKIAIOSFODNN7EXAMPLE used for access');
    expect(result).toContain('[AWS_KEY]');
    expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('redacts long alphanumeric string (generic key)', () => {
    const result = redactText('api_key=abcdef1234567890abcdef1234567890');
    expect(result).not.toContain('abcdef1234567890abcdef1234567890');
  });
});

// ---------------------------------------------------------------------------
// PII fixture corpus
// ---------------------------------------------------------------------------

describe('PII fixture corpus', () => {
  it('redactThread removes all PII from pii-thread fixture', () => {
    const fixture = loadPiiFixture();
    const redacted = redactThread(fixture.thread);

    for (const comment of redacted) {
      // No raw email addresses
      expect(comment.body).not.toMatch(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
      // No raw IPv4 addresses
      expect(comment.body).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
      // No raw Bearer tokens
      expect(comment.body).not.toMatch(/Bearer\s+[A-Za-z0-9]{10,}/);
    }
  });

  it('original comments are not mutated', () => {
    const fixture = loadPiiFixture();
    const original = fixture.thread.map((c) => c.body);
    redactThread(fixture.thread);
    fixture.thread.forEach((c, i) => expect(c.body).toBe(original[i]));
  });
});

// ---------------------------------------------------------------------------
// Rule set properties
// ---------------------------------------------------------------------------

describe('REDACTION_RULES', () => {
  it('has unique rule names', () => {
    const names = REDACTION_RULES.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('all rules have global flag', () => {
    for (const rule of REDACTION_RULES) {
      expect(rule.pattern.global).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// containsRedactableContent
// ---------------------------------------------------------------------------

describe('containsRedactableContent', () => {
  it('returns true for text with an email', () => {
    expect(containsRedactableContent('Email: test@example.com')).toBe(true);
  });

  it('returns false for clean text', () => {
    expect(containsRedactableContent('This is a clean sentence with no PII.')).toBe(false);
  });
});
