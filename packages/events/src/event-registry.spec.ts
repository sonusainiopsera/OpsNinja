import { describe, it, expect } from 'vitest';
import {
  EVENT_REGISTRY,
  REGISTERED_EVENT_TYPES,
  getRegistryEntry,
  isRegisteredEventType,
  getAvailableEntries,
} from './event-registry';

describe('event-registry', () => {
  it('every entry has a non-empty eventType', () => {
    for (const entry of EVENT_REGISTRY) {
      expect(entry.eventType.trim().length).toBeGreaterThan(0);
    }
  });

  it('every entry has a payloadSchema with at least one property', () => {
    for (const entry of EVENT_REGISTRY) {
      expect(
        Object.keys(entry.payloadSchema.properties).length,
        `${entry.eventType} payloadSchema must have properties`,
      ).toBeGreaterThan(0);
    }
  });

  it('every entry has a non-empty examplePayload', () => {
    for (const entry of EVENT_REGISTRY) {
      expect(
        Object.keys(entry.examplePayload).length,
        `${entry.eventType} examplePayload must not be empty`,
      ).toBeGreaterThan(0);
    }
  });

  it('every entry has a valid deliveryGuarantee', () => {
    for (const entry of EVENT_REGISTRY) {
      expect(entry.deliveryGuarantee).toBe('at-least-once');
    }
  });

  it('every entry has a valid dataClassification', () => {
    const valid = new Set(['public', 'internal', 'confidential']);
    for (const entry of EVENT_REGISTRY) {
      expect(valid.has(entry.dataClassification)).toBe(true);
    }
  });

  it('every entry has a trigger and orderingCaveat', () => {
    for (const entry of EVENT_REGISTRY) {
      expect(entry.trigger.trim().length).toBeGreaterThan(0);
      expect(entry.orderingCaveat.trim().length).toBeGreaterThan(0);
    }
  });

  it('event types are unique', () => {
    const types = EVENT_REGISTRY.map((e) => e.eventType);
    const unique = new Set(types);
    expect(unique.size).toBe(types.length);
  });

  it('REGISTERED_EVENT_TYPES contains all entries', () => {
    for (const entry of EVENT_REGISTRY) {
      expect(REGISTERED_EVENT_TYPES.has(entry.eventType)).toBe(true);
    }
  });

  it('getRegistryEntry returns the correct entry', () => {
    const entry = getRegistryEntry('ticket.created');
    expect(entry?.eventType).toBe('ticket.created');
  });

  it('getRegistryEntry returns undefined for unknown type', () => {
    expect(getRegistryEntry('not.a.real.event')).toBeUndefined();
  });

  it('isRegisteredEventType returns true for known events', () => {
    expect(isRegisteredEventType('ticket.created')).toBe(true);
    expect(isRegisteredEventType('webhook.ping')).toBe(true);
  });

  it('isRegisteredEventType returns false for unknown events', () => {
    expect(isRegisteredEventType('unknown.event')).toBe(false);
    expect(isRegisteredEventType('')).toBe(false);
  });

  it('getAvailableEntries returns only available entries', () => {
    const available = getAvailableEntries();
    for (const entry of available) {
      expect(entry.availability).toBe('available');
    }
  });

  it('examplePayload keys do not contain real domains', () => {
    const realDomainPattern = /opsninja\.com|internal\.example\.com/i;
    for (const entry of EVENT_REGISTRY) {
      const json = JSON.stringify(entry.examplePayload);
      expect(realDomainPattern.test(json), `${entry.eventType} examplePayload contains real domain`).toBe(false);
    }
  });

  it('required fields in payloadSchema are a subset of property keys', () => {
    for (const entry of EVENT_REGISTRY) {
      if (!entry.payloadSchema.required) continue;
      const propKeys = new Set(Object.keys(entry.payloadSchema.properties));
      for (const req of entry.payloadSchema.required) {
        expect(propKeys.has(req), `${entry.eventType}: required field "${req}" not in properties`).toBe(true);
      }
    }
  });
});
