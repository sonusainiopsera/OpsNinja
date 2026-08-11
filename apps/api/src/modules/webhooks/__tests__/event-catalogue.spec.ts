import { EVENT_CATALOGUE, VALID_EVENT_TYPES, findInvalidEventTypes } from '../event-catalogue';

describe('event-catalogue', () => {
  it('every entry has a non-empty eventType, description, examplePayload and dataClassification', () => {
    for (const entry of EVENT_CATALOGUE) {
      expect(entry.eventType).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
      expect(entry.description.length).toBeGreaterThan(5);
      expect(typeof entry.examplePayload).toBe('object');
      expect(['public', 'internal', 'restricted']).toContain(entry.dataClassification);
    }
  });

  it('every examplePayload contains the matching eventType', () => {
    for (const entry of EVENT_CATALOGUE) {
      expect((entry.examplePayload as Record<string, unknown>).eventType).toBe(entry.eventType);
    }
  });

  it('VALID_EVENT_TYPES matches EVENT_CATALOGUE entries', () => {
    for (const entry of EVENT_CATALOGUE) {
      expect(VALID_EVENT_TYPES.has(entry.eventType)).toBe(true);
    }
    expect(VALID_EVENT_TYPES.size).toBe(EVENT_CATALOGUE.length);
  });

  describe('findInvalidEventTypes', () => {
    it('returns empty array for all valid types', () => {
      const all = EVENT_CATALOGUE.map((e) => e.eventType);
      expect(findInvalidEventTypes(all)).toEqual([]);
    });

    it('returns only the invalid entries', () => {
      const invalid = findInvalidEventTypes(['ticket.created', 'fake.event', 'another.bad']);
      expect(invalid).toEqual(['fake.event', 'another.bad']);
    });

    it('returns all entries when none are valid', () => {
      const invalid = findInvalidEventTypes(['bad.one', 'bad.two']);
      expect(invalid).toHaveLength(2);
    });
  });
});
