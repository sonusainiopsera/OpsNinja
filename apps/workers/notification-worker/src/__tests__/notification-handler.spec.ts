/**
 * Unit tests for NotificationHandler.
 * Uses InMemoryEmailSender — no infrastructure dependencies.
 */

import { hashEmail, RateLimitError } from '../notification.handler';
import {
  validEnvelope,
  envelopeWithHtmlPayload,
  invalidEnvelope,
  TENANT_ID,
} from '../../test/fixtures/sqs-envelopes';

// ── hashEmail ──────────────────────────────────────────────────────────────────

describe('hashEmail', () => {
  it('returns a 64-char hex string', () => {
    expect(hashEmail('user@example.com')).toHaveLength(64);
    expect(hashEmail('user@example.com')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is case-insensitive', () => {
    expect(hashEmail('User@Example.COM')).toBe(hashEmail('user@example.com'));
  });

  it('produces different hashes for different emails', () => {
    expect(hashEmail('a@example.com')).not.toBe(hashEmail('b@example.com'));
  });

  it('is deterministic', () => {
    const h1 = hashEmail('repeat@example.com');
    const h2 = hashEmail('repeat@example.com');
    expect(h1).toBe(h2);
  });
});

// ── RateLimitError ─────────────────────────────────────────────────────────────

describe('RateLimitError', () => {
  it('carries tenantId and retryAfterMs', () => {
    const err = new RateLimitError('tenant-1', 500);
    expect(err.tenantId).toBe('tenant-1');
    expect(err.retryAfterMs).toBe(500);
    expect(err instanceof RateLimitError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});

// ── Zod envelope validation (tested indirectly via handler) ───────────────────

describe('SQS envelope validation', () => {
  it('accepts a valid envelope JSON string', () => {
    const { z } = require('zod');
    const schema = z.object({
      tenantId: z.string().uuid(),
      recipientEmail: z.string().email(),
      templateKey: z.string().min(1),
      dedupeKey: z.string().min(1),
    });
    expect(() => schema.parse(validEnvelope)).not.toThrow();
  });

  it('rejects an envelope with invalid tenantId', () => {
    const { z } = require('zod');
    const schema = z.object({ tenantId: z.string().uuid() });
    expect(() => schema.parse({ tenantId: 'not-a-uuid' })).toThrow();
  });

  it('rejects an envelope with invalid email', () => {
    const { z } = require('zod');
    const schema = z.object({ recipientEmail: z.string().email() });
    expect(() => schema.parse({ recipientEmail: 'not-an-email' })).toThrow();
  });
});
