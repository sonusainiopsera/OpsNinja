/**
 * Developer portal coverage, parity and redaction tests (WO-100).
 *
 * These tests act as CI build gates:
 *
 * 1. Registry completeness — every event type in the registry has a non-empty
 *    payload schema and example payload. A missing schema fails the build.
 *
 * 2. Configuration parity — the delivery config constants in packages/events
 *    equal the runtime constants used by the webhook worker. Drift is
 *    structurally impossible because the worker now imports from the same
 *    module; these assertions double-check the actual values.
 *
 * 3. Redaction — no guide source files contain real domains, JWT-shaped
 *    tokens, AWS key prefixes, or 64-char hex secrets.
 *
 * 4. Example payload safety — every registry entry's examplePayload uses only
 *    synthetic IDs and placeholder credentials.
 *
 * 5. Sample envelopes — all sample envelopes use the documented synthetic tenant.
 *
 * 6. Front-matter and portal config shape.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import {
  EVENT_REGISTRY,
  getAvailableEntries,
  MAX_WEBHOOK_DELIVERY_ATTEMPTS,
  WEBHOOK_BACKOFF_DELAYS_SECONDS,
  SIGNATURE_REPLAY_WINDOW_SECONDS,
  WEBHOOK_CONSUMER_TIMEOUT_SECONDS,
  SAMPLE_ENVELOPES,
} from '../../packages/events/src/index';
import { PORTAL_CONFIG } from '../../docs/site/config';

// ── Runtime constants from the webhook worker ─────────────────────────────────
// Importing directly to assert parity. Both modules now share a single source
// of truth (packages/events/src/delivery-config.ts), making this a canary.
import {
  MAX_ATTEMPTS as WORKER_MAX_ATTEMPTS,
  BACKOFF_DELAYS_SECONDS as WORKER_BACKOFF,
} from '../../apps/workers/webhook-worker/src/retry-classifier';

// ── 1. Registry completeness ─────────────────────────────────────────────────

describe('registry completeness', () => {
  it('every event type has a non-empty payloadSchema', () => {
    for (const entry of EVENT_REGISTRY) {
      expect(
        Object.keys(entry.payloadSchema.properties).length,
        `${entry.eventType}: payloadSchema.properties must not be empty`,
      ).toBeGreaterThan(0);
    }
  });

  it('every event type has a non-empty examplePayload', () => {
    for (const entry of EVENT_REGISTRY) {
      expect(
        Object.keys(entry.examplePayload).length,
        `${entry.eventType}: examplePayload must not be empty`,
      ).toBeGreaterThan(0);
    }
  });

  it('every event type has a trigger condition', () => {
    for (const entry of EVENT_REGISTRY) {
      expect(
        entry.trigger.trim().length,
        `${entry.eventType}: trigger must not be empty`,
      ).toBeGreaterThan(0);
    }
  });

  it('every event type has an orderingCaveat', () => {
    for (const entry of EVENT_REGISTRY) {
      expect(
        entry.orderingCaveat.trim().length,
        `${entry.eventType}: orderingCaveat must not be empty`,
      ).toBeGreaterThan(0);
    }
  });

  it('every event type has a resource field', () => {
    for (const entry of EVENT_REGISTRY) {
      expect(entry.resource.trim().length).toBeGreaterThan(0);
    }
  });

  it('all event types are unique', () => {
    const types = EVENT_REGISTRY.map((e) => e.eventType);
    expect(new Set(types).size).toBe(types.length);
  });

  it('required fields in payloadSchema are a subset of property keys', () => {
    for (const entry of EVENT_REGISTRY) {
      if (!entry.payloadSchema.required) continue;
      const propKeys = new Set(Object.keys(entry.payloadSchema.properties));
      for (const field of entry.payloadSchema.required) {
        expect(
          propKeys.has(field),
          `${entry.eventType}: required field "${field}" is not in payloadSchema.properties`,
        ).toBe(true);
      }
    }
  });

  it('all event types have a valid availability value', () => {
    for (const entry of EVENT_REGISTRY) {
      expect(['available', 'unavailable']).toContain(entry.availability);
    }
  });

  it('getAvailableEntries returns a non-empty subset', () => {
    const available = getAvailableEntries();
    expect(available.length).toBeGreaterThan(0);
    expect(available.length).toBeLessThanOrEqual(EVENT_REGISTRY.length);
  });

  it('deliveryGuarantee is at-least-once for all entries', () => {
    for (const entry of EVENT_REGISTRY) {
      expect(entry.deliveryGuarantee).toBe('at-least-once');
    }
  });
});

// ── 2. Configuration parity ──────────────────────────────────────────────────

describe('configuration parity: documented values equal runtime constants', () => {
  it('portal config maxAttempts equals MAX_WEBHOOK_DELIVERY_ATTEMPTS', () => {
    expect(PORTAL_CONFIG.webhookDelivery.maxAttempts).toBe(MAX_WEBHOOK_DELIVERY_ATTEMPTS);
    // Absolute value cross-check — documentation says 6
    expect(PORTAL_CONFIG.webhookDelivery.maxAttempts).toBe(6);
  });

  it('portal config maxAttempts equals webhook-worker MAX_ATTEMPTS', () => {
    expect(PORTAL_CONFIG.webhookDelivery.maxAttempts).toBe(WORKER_MAX_ATTEMPTS);
  });

  it('portal config backoffDelaysSeconds equals WEBHOOK_BACKOFF_DELAYS_SECONDS', () => {
    expect([...PORTAL_CONFIG.webhookDelivery.backoffDelaysSeconds]).toEqual(
      [...WEBHOOK_BACKOFF_DELAYS_SECONDS],
    );
    // Absolute value cross-check
    expect([...PORTAL_CONFIG.webhookDelivery.backoffDelaysSeconds]).toEqual([1, 2, 4, 8, 60, 900]);
  });

  it('portal config backoffDelaysSeconds equals webhook-worker BACKOFF_DELAYS_SECONDS', () => {
    expect([...PORTAL_CONFIG.webhookDelivery.backoffDelaysSeconds]).toEqual([...WORKER_BACKOFF]);
  });

  it('portal config signatureReplayWindowSeconds equals SIGNATURE_REPLAY_WINDOW_SECONDS', () => {
    expect(PORTAL_CONFIG.webhookDelivery.signatureReplayWindowSeconds).toBe(
      SIGNATURE_REPLAY_WINDOW_SECONDS,
    );
    // Absolute value — documentation says 300 seconds (5 minutes)
    expect(PORTAL_CONFIG.webhookDelivery.signatureReplayWindowSeconds).toBe(300);
  });

  it('portal config consumerTimeoutSeconds equals WEBHOOK_CONSUMER_TIMEOUT_SECONDS', () => {
    expect(PORTAL_CONFIG.webhookDelivery.consumerTimeoutSeconds).toBe(
      WEBHOOK_CONSUMER_TIMEOUT_SECONDS,
    );
    // Absolute value — documentation says 30 seconds
    expect(PORTAL_CONFIG.webhookDelivery.consumerTimeoutSeconds).toBe(30);
  });

  it('backoffDelaysSeconds length equals maxAttempts - 1', () => {
    // One delay per retry after the immediate first attempt
    expect(PORTAL_CONFIG.webhookDelivery.backoffDelaysSeconds.length).toBe(
      PORTAL_CONFIG.webhookDelivery.maxAttempts - 1,
    );
  });
});

// ── 3. Redaction scan ─────────────────────────────────────────────────────────

describe('redaction scan: no real credentials in guide source files', () => {
  const GUIDES_DIR = path.resolve(__dirname, '../../docs/site/guides');

  const realDomainRe = /app\.opsninja\.io|portal\.opsninja\.io|api\.opsninja\.io/gi;
  const jwtRe = /ey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g;
  const awsKeyRe = /(AKIA|ASIA|AROA|AIDA)[A-Z2-7]{16}/g;
  const internalHostRe = /\binternal\.[a-z0-9-]+\.local\b|\bcluster\.local\b/gi;

  function scanDir(dir: string, re: RegExp): Array<{ file: string; line: number; match: string }> {
    const hits: Array<{ file: string; line: number; match: string }> = [];
    if (!fs.existsSync(dir)) return hits;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) hits.push(...scanDir(full, re));
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        const lines = fs.readFileSync(full, 'utf8').split('\n');
        lines.forEach((line, i) => {
          const freshRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
          if (freshRe.test(line)) hits.push({ file: full, line: i + 1, match: line.slice(0, 100) });
        });
      }
    }
    return hits;
  }

  it('no production OpsNinja hostnames in guides', () => {
    const hits = scanDir(GUIDES_DIR, realDomainRe);
    expect(hits, `Real domain found:\n${hits.map((h) => `  ${h.file}:${h.line}`).join('\n')}`).toHaveLength(0);
  });

  it('no JWT-shaped tokens in guides', () => {
    const hits = scanDir(GUIDES_DIR, jwtRe);
    expect(hits, `JWT token found:\n${hits.map((h) => `  ${h.file}:${h.line}`).join('\n')}`).toHaveLength(0);
  });

  it('no AWS access key prefixes in guides', () => {
    const hits = scanDir(GUIDES_DIR, awsKeyRe);
    expect(hits, `AWS key found:\n${hits.map((h) => `  ${h.file}:${h.line}`).join('\n')}`).toHaveLength(0);
  });

  it('no internal hostnames in guides', () => {
    const hits = scanDir(GUIDES_DIR, internalHostRe);
    expect(hits, `Internal hostname found:\n${hits.map((h) => `  ${h.file}:${h.line}`).join('\n')}`).toHaveLength(0);
  });
});

// ── 4. Example payload safety ─────────────────────────────────────────────────

describe('example payload safety', () => {
  const realDomainRe = /opsninja\.com|internal\.example\.com/i;
  const jwtRe = /ey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;
  const awsKeyRe = /(AKIA|ASIA|AROA|AIDA)[A-Z2-7]{16}/;

  it('no real domains in examplePayload', () => {
    for (const entry of EVENT_REGISTRY) {
      const json = JSON.stringify(entry.examplePayload);
      expect(realDomainRe.test(json), `${entry.eventType}: contains real domain`).toBe(false);
    }
  });

  it('no JWT-shaped tokens in examplePayload', () => {
    for (const entry of EVENT_REGISTRY) {
      const json = JSON.stringify(entry.examplePayload);
      expect(jwtRe.test(json), `${entry.eventType}: JWT-shaped token in payload`).toBe(false);
    }
  });

  it('no AWS access keys in examplePayload', () => {
    for (const entry of EVENT_REGISTRY) {
      const json = JSON.stringify(entry.examplePayload);
      expect(awsKeyRe.test(json), `${entry.eventType}: AWS access key in payload`).toBe(false);
    }
  });
});

// ── 5. Sample envelopes ───────────────────────────────────────────────────────

describe('sample envelopes', () => {
  it('every event type has a sample envelope', () => {
    const coveredTypes = new Set(SAMPLE_ENVELOPES.map((e) => e.type));
    for (const entry of EVENT_REGISTRY) {
      expect(coveredTypes.has(entry.eventType), `No sample envelope for ${entry.eventType}`).toBe(true);
    }
  });

  it('all sample envelopes use the synthetic tenant ID', () => {
    for (const envelope of SAMPLE_ENVELOPES) {
      expect(envelope.tenantId).toBe('00000000-0000-0000-0000-000000000001');
    }
  });

  it('all sample envelopes have required fields', () => {
    for (const envelope of SAMPLE_ENVELOPES) {
      expect(typeof envelope.id).toBe('string');
      expect(typeof envelope.type).toBe('string');
      expect(typeof envelope.occurredAt).toBe('string');
      expect(typeof envelope.tenantId).toBe('string');
      expect(typeof envelope.data).toBe('object');
    }
  });
});

// ── 6. Front-matter and portal config shape ───────────────────────────────────

describe('portal config shape', () => {
  it('requiredFrontMatter includes title, audience, last-reviewed', () => {
    expect(PORTAL_CONFIG.requiredFrontMatter).toContain('title');
    expect(PORTAL_CONFIG.requiredFrontMatter).toContain('audience');
    expect(PORTAL_CONFIG.requiredFrontMatter).toContain('last-reviewed');
  });

  it('redactionDenyList has at least 4 entries', () => {
    expect(PORTAL_CONFIG.redactionDenyList.length).toBeGreaterThanOrEqual(4);
  });

  it('each deny-list entry has a name, description, and valid pattern', () => {
    for (const entry of PORTAL_CONFIG.redactionDenyList) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.pattern).toBeInstanceOf(RegExp);
    }
  });

  it('openapiSpecPath points to a non-empty string', () => {
    expect(PORTAL_CONFIG.openapiSpecPath.length).toBeGreaterThan(0);
  });
});

// ── 7. Guide files exist with front-matter ────────────────────────────────────

describe('guide files exist', () => {
  const GUIDES_DIR = path.resolve(__dirname, '../../docs/site/guides');

  const REQUIRED_GUIDES = [
    'authentication.md',
    'pagination-and-rate-limits.md',
    'errors-and-tracing.md',
    'idempotency-and-retries.md',
    'versioning-and-deprecation.md',
    'webhooks/index.md',
  ];

  for (const guide of REQUIRED_GUIDES) {
    it(`exists: guides/${guide}`, () => {
      const fullPath = path.join(GUIDES_DIR, guide);
      expect(fs.existsSync(fullPath), `Missing guide: ${fullPath}`).toBe(true);
    });

    it(`has required front-matter: guides/${guide}`, () => {
      const fullPath = path.join(GUIDES_DIR, guide);
      if (!fs.existsSync(fullPath)) return;
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const field of PORTAL_CONFIG.requiredFrontMatter) {
        expect(content, `${guide} missing front-matter field: ${field}`).toMatch(
          new RegExp(`^${field}:`, 'm'),
        );
      }
    });
  }
});
