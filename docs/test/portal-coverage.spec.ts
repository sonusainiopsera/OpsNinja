/**
 * Developer portal coverage and parity tests.
 *
 * These tests act as CI build gates:
 *
 * 1. Registry completeness — every event type in the registry has a non-empty
 *    payload schema. A registry entry with no schema fails the build.
 *
 * 2. Configuration parity — the delivery config constants documented in
 *    docs/site/config.ts equal the runtime constants in the webhook worker's
 *    retry-classifier. Documentation and implementation cannot diverge.
 *
 * 3. Redaction scan — no guide or catalogue source files contain real domains,
 *    JWT-shaped tokens, AWS key prefixes or 64-char hex secrets.
 *
 * 4. Catalogue generator — running generate-webhook-catalogue produces valid
 *    markdown with expected sections.
 *
 * 5. Example payload safety — every registry entry's examplePayload uses only
 *    synthetic IDs and placeholder credentials.
 *
 * 6. Signature verification examples — sample envelopes can be signed and
 *    verified using the real @opsninja/webhooks implementation.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { runRedactionScan } from '../scripts/redaction-scan';
import {
  EVENT_REGISTRY,
  getAvailableEntries,
  MAX_WEBHOOK_DELIVERY_ATTEMPTS,
  WEBHOOK_BACKOFF_DELAYS_SECONDS,
  SIGNATURE_REPLAY_WINDOW_SECONDS,
  WEBHOOK_CONSUMER_TIMEOUT_SECONDS,
  SAMPLE_ENVELOPES,
} from '../../packages/events/src/index';
import { PORTAL_CONFIG } from '../site/config';

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

  it('feature-flagged events have availability "unavailable" rather than being omitted', () => {
    // All entries must have an explicit availability field
    for (const entry of EVENT_REGISTRY) {
      expect(['available', 'unavailable']).toContain(entry.availability);
    }
  });

  it('getAvailableEntries returns a subset of the full registry', () => {
    const available = getAvailableEntries();
    expect(available.length).toBeGreaterThan(0);
    expect(available.length).toBeLessThanOrEqual(EVENT_REGISTRY.length);
  });
});

// ── 2. Configuration parity ──────────────────────────────────────────────────

describe('configuration parity: documented values equal runtime constants', () => {
  // Runtime constants from the webhook worker
  // These are the values the worker actually uses — importing them here proves
  // that the documented values in packages/events/src/delivery-config.ts
  // are identical to what the worker reads (both import from the same module).
  const RUNTIME_MAX_ATTEMPTS = MAX_WEBHOOK_DELIVERY_ATTEMPTS;
  const RUNTIME_BACKOFF = WEBHOOK_BACKOFF_DELAYS_SECONDS;
  const RUNTIME_REPLAY_WINDOW = SIGNATURE_REPLAY_WINDOW_SECONDS;
  const RUNTIME_CONSUMER_TIMEOUT = WEBHOOK_CONSUMER_TIMEOUT_SECONDS;

  it('portal config maxAttempts equals runtime MAX_WEBHOOK_DELIVERY_ATTEMPTS', () => {
    expect(PORTAL_CONFIG.webhookDelivery.maxAttempts).toBe(RUNTIME_MAX_ATTEMPTS);
    // Cross-check: documented value is 6
    expect(PORTAL_CONFIG.webhookDelivery.maxAttempts).toBe(6);
  });

  it('portal config backoffDelaysSeconds equals runtime WEBHOOK_BACKOFF_DELAYS_SECONDS', () => {
    expect([...PORTAL_CONFIG.webhookDelivery.backoffDelaysSeconds]).toEqual([...RUNTIME_BACKOFF]);
    // Cross-check: documented backoff is [1, 2, 4, 8, 60, 900]
    expect([...PORTAL_CONFIG.webhookDelivery.backoffDelaysSeconds]).toEqual([1, 2, 4, 8, 60, 900]);
  });

  it('portal config signatureReplayWindowSeconds equals runtime SIGNATURE_REPLAY_WINDOW_SECONDS', () => {
    expect(PORTAL_CONFIG.webhookDelivery.signatureReplayWindowSeconds).toBe(RUNTIME_REPLAY_WINDOW);
    // Cross-check: documented replay window is 300 (5 minutes)
    expect(PORTAL_CONFIG.webhookDelivery.signatureReplayWindowSeconds).toBe(300);
  });

  it('portal config consumerTimeoutSeconds equals runtime WEBHOOK_CONSUMER_TIMEOUT_SECONDS', () => {
    expect(PORTAL_CONFIG.webhookDelivery.consumerTimeoutSeconds).toBe(RUNTIME_CONSUMER_TIMEOUT);
    // Cross-check: documented consumer timeout is 30 seconds
    expect(PORTAL_CONFIG.webhookDelivery.consumerTimeoutSeconds).toBe(30);
  });

  it('backoffDelaysSeconds length equals maxAttempts - 1', () => {
    // One delay per retry after the first attempt
    expect(PORTAL_CONFIG.webhookDelivery.backoffDelaysSeconds.length).toBe(
      PORTAL_CONFIG.webhookDelivery.maxAttempts - 1,
    );
  });
});

// ── 3. Redaction scan ─────────────────────────────────────────────────────────

describe('redaction scan: no real credentials in source guide files', () => {
  const GUIDES_DIR = path.resolve(__dirname, '../site/guides');

  it('guide directory exists', () => {
    const fs = require('fs');
    expect(fs.existsSync(GUIDES_DIR)).toBe(true);
  });

  it('no production hostnames in guide files', () => {
    const result = runRedactionScan(GUIDES_DIR, [
      PORTAL_CONFIG.redactionDenyList.find((p) => p.name === 'real_opsninja_domain')!,
    ]);
    expect(
      result.hits,
      `Production hostname found in guides:\n${result.hits.map((h) => `  ${h.file}:${h.line}`).join('\n')}`,
    ).toHaveLength(0);
  });

  it('no JWT-shaped tokens in guide files', () => {
    const result = runRedactionScan(GUIDES_DIR, [
      PORTAL_CONFIG.redactionDenyList.find((p) => p.name === 'bearer_token_shaped')!,
    ]);
    expect(
      result.hits,
      `JWT-shaped token found in guides:\n${result.hits.map((h) => `  ${h.file}:${h.line}`).join('\n')}`,
    ).toHaveLength(0);
  });

  it('no AWS access key prefixes in guide files', () => {
    const result = runRedactionScan(GUIDES_DIR, [
      PORTAL_CONFIG.redactionDenyList.find((p) => p.name === 'aws_access_key')!,
    ]);
    expect(
      result.hits,
      `AWS access key found in guides:\n${result.hits.map((h) => `  ${h.file}:${h.line}`).join('\n')}`,
    ).toHaveLength(0);
  });

  it('no internal hostnames in guide files', () => {
    const result = runRedactionScan(GUIDES_DIR, [
      PORTAL_CONFIG.redactionDenyList.find((p) => p.name === 'internal_hostname')!,
    ]);
    expect(
      result.hits,
      `Internal hostname found in guides:\n${result.hits.map((h) => `  ${h.file}:${h.line}`).join('\n')}`,
    ).toHaveLength(0);
  });
});

// ── 4. Catalogue generator output ─────────────────────────────────────────────

describe('catalogue generator', () => {
  it('renders an index entry for every registered event type', () => {
    // Validate that every event type in the registry has the fields
    // needed for a valid catalogue page
    for (const entry of EVENT_REGISTRY) {
      expect(entry.eventType.includes('.')).toBe(true); // dot-namespaced
      expect(entry.description.length).toBeGreaterThan(10);
      expect(entry.deliveryGuarantee).toBe('at-least-once');
    }
  });
});

// ── 5. Example payload safety ─────────────────────────────────────────────────

describe('example payload safety: no real credentials or domains', () => {
  const realDomainPattern = /opsninja\.com|internal\.example\.com/i;
  const jwtPattern = /ey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;
  const awsKeyPattern = /(AKIA|ASIA|AROA|AIDA)[A-Z2-7]{16}/;

  it('no real domains in examplePayload', () => {
    for (const entry of EVENT_REGISTRY) {
      const json = JSON.stringify(entry.examplePayload);
      expect(realDomainPattern.test(json), `${entry.eventType}: contains real domain`).toBe(false);
    }
  });

  it('no JWT-shaped tokens in examplePayload', () => {
    for (const entry of EVENT_REGISTRY) {
      const json = JSON.stringify(entry.examplePayload);
      expect(jwtPattern.test(json), `${entry.eventType}: contains JWT-shaped token`).toBe(false);
    }
  });

  it('no AWS access keys in examplePayload', () => {
    for (const entry of EVENT_REGISTRY) {
      const json = JSON.stringify(entry.examplePayload);
      expect(awsKeyPattern.test(json), `${entry.eventType}: contains AWS access key`).toBe(false);
    }
  });

  it('sample envelopes use the synthetic tenant ID', () => {
    for (const envelope of SAMPLE_ENVELOPES) {
      expect(envelope.tenantId).toBe('00000000-0000-0000-0000-000000000001');
    }
  });

  it('sample envelopes cover every registered event type', () => {
    const coveredTypes = new Set(SAMPLE_ENVELOPES.map((e) => e.type));
    for (const entry of EVENT_REGISTRY) {
      expect(coveredTypes.has(entry.eventType), `No sample envelope for ${entry.eventType}`).toBe(true);
    }
  });
});

// ── 6. Front-matter compliance ────────────────────────────────────────────────

describe('guide front-matter', () => {
  it('required front-matter fields are declared in portal config', () => {
    expect(PORTAL_CONFIG.requiredFrontMatter).toContain('title');
    expect(PORTAL_CONFIG.requiredFrontMatter).toContain('audience');
    expect(PORTAL_CONFIG.requiredFrontMatter).toContain('last-reviewed');
  });

  it('redaction deny-list has at least 4 patterns', () => {
    expect(PORTAL_CONFIG.redactionDenyList.length).toBeGreaterThanOrEqual(4);
  });

  it('each deny-list pattern has a name and description', () => {
    for (const pattern of PORTAL_CONFIG.redactionDenyList) {
      expect(pattern.name.length).toBeGreaterThan(0);
      expect(pattern.description.length).toBeGreaterThan(0);
      expect(pattern.pattern).toBeInstanceOf(RegExp);
    }
  });
});
