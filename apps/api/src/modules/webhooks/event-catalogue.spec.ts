/**
 * Catalogue snapshot test — fails if event types are silently added or removed.
 * Prevents drift between the published catalogue and the internal validator.
 */

import { EVENT_CATALOGUE, VALID_EVENT_TYPES, isValidEventType } from './event-catalogue';
import { EVENT_CATALOGUE_SNAPSHOT } from '../../../test/fixtures/webhook.fixtures';

describe('event-catalogue', () => {
  it('matches the committed snapshot of event type keys', () => {
    const actual = EVENT_CATALOGUE.map((e) => e.eventType).sort();
    const expected = [...EVENT_CATALOGUE_SNAPSHOT].sort();
    expect(actual).toEqual(expected);
  });

  it('VALID_EVENT_TYPES set contains all catalogue entries', () => {
    for (const entry of EVENT_CATALOGUE) {
      expect(VALID_EVENT_TYPES.has(entry.eventType)).toBe(true);
    }
  });

  it('isValidEventType returns true for catalogue entries', () => {
    for (const entry of EVENT_CATALOGUE) {
      expect(isValidEventType(entry.eventType)).toBe(true);
    }
  });

  it('isValidEventType returns false for unknown event types', () => {
    expect(isValidEventType('not.a.real.event')).toBe(false);
    expect(isValidEventType('')).toBe(false);
    expect(isValidEventType('ticket.created.extra')).toBe(false);
  });

  it('every entry has a non-empty examplePayload', () => {
    for (const entry of EVENT_CATALOGUE) {
      expect(Object.keys(entry.examplePayload).length).toBeGreaterThan(0);
    }
  });

  it('every entry has a valid dataClassification', () => {
    const valid = new Set(['public', 'internal', 'confidential']);
    for (const entry of EVENT_CATALOGUE) {
      expect(valid.has(entry.dataClassification)).toBe(true);
    }
  });
});
