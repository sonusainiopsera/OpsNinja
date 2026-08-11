/**
 * Unit tests for the notification event catalogue (WO-081).
 *
 * Verifies:
 *  - All eight required event types are present
 *  - Structural shape of each entry
 *  - getCatalogueEntry helper
 *  - isNotificationEligible helper
 *  - comment_added has checkCommentVisibility = true
 *  - SLA events have audienceType = 'oncall'
 *  - coalescingEnabled set correctly for burst-prone events
 */

import {
  NOTIFICATION_CATALOGUE,
  CATALOGUE_BY_EVENT_TYPE,
  getCatalogueEntry,
  isNotificationEligible,
  NOTIFICATION_EVENT_TYPES,
} from './event-catalogue';

const REQUIRED_EVENT_TYPES = [
  'ticket.created',
  'ticket.status_changed',
  'ticket.comment_added',
  'ticket.assignee_changed',
  'ticket.resolved',
  'ticket.reopened',
  'sla.reminder_threshold_reached',
  'sla.breached',
];

describe('NOTIFICATION_CATALOGUE', () => {
  it('contains exactly 8 entries', () => {
    expect(NOTIFICATION_CATALOGUE).toHaveLength(8);
  });

  it('contains all eight required event types', () => {
    for (const eventType of REQUIRED_EVENT_TYPES) {
      expect(NOTIFICATION_EVENT_TYPES.has(eventType)).toBe(true);
    }
  });

  it('every entry has a non-empty templateKey', () => {
    for (const entry of NOTIFICATION_CATALOGUE) {
      expect(entry.templateKey.length).toBeGreaterThan(0);
    }
  });

  it('every entry has at least one defaultChannel', () => {
    for (const entry of NOTIFICATION_CATALOGUE) {
      expect(entry.defaultChannels.length).toBeGreaterThan(0);
    }
  });

  it('every entry has a valid audienceType', () => {
    const valid = new Set(['customer', 'oncall', 'both']);
    for (const entry of NOTIFICATION_CATALOGUE) {
      expect(valid.has(entry.audienceType)).toBe(true);
    }
  });

  it('every entry has a valid payloadProjection', () => {
    const valid = new Set(['ticket_public', 'ticket_sla', 'comment_public']);
    for (const entry of NOTIFICATION_CATALOGUE) {
      expect(valid.has(entry.payloadProjection)).toBe(true);
    }
  });

  it('catalogue is frozen (immutable)', () => {
    expect(Object.isFrozen(NOTIFICATION_CATALOGUE)).toBe(true);
  });
});

describe('ticket.comment_added entry', () => {
  const entry = getCatalogueEntry('ticket.comment_added')!;

  it('has checkCommentVisibility = true', () => {
    expect(entry.checkCommentVisibility).toBe(true);
  });

  it('has payloadProjection = comment_public', () => {
    expect(entry.payloadProjection).toBe('comment_public');
  });

  it('has audienceType = customer', () => {
    expect(entry.audienceType).toBe('customer');
  });

  it('coalescingEnabled = false (do not coalesce individual comments)', () => {
    expect(entry.coalescingEnabled).toBe(false);
  });
});

describe('SLA event entries', () => {
  it('sla.reminder_threshold_reached has audienceType = oncall', () => {
    const entry = getCatalogueEntry('sla.reminder_threshold_reached')!;
    expect(entry.audienceType).toBe('oncall');
    expect(entry.checkCommentVisibility).toBe(false);
  });

  it('sla.breached has audienceType = oncall', () => {
    const entry = getCatalogueEntry('sla.breached')!;
    expect(entry.audienceType).toBe('oncall');
  });
});

describe('burst-prone events have coalescingEnabled = true', () => {
  it('ticket.status_changed is coalescing-enabled', () => {
    expect(getCatalogueEntry('ticket.status_changed')?.coalescingEnabled).toBe(true);
  });

  it('ticket.assignee_changed is coalescing-enabled', () => {
    expect(getCatalogueEntry('ticket.assignee_changed')?.coalescingEnabled).toBe(true);
  });
});

describe('getCatalogueEntry', () => {
  it('returns entry for a known event type', () => {
    const entry = getCatalogueEntry('ticket.created');
    expect(entry).not.toBeNull();
    expect(entry?.eventType).toBe('ticket.created');
  });

  it('returns null for an unknown event type', () => {
    expect(getCatalogueEntry('ticket.some_unknown_event')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(getCatalogueEntry('')).toBeNull();
  });
});

describe('isNotificationEligible', () => {
  it('returns true for all required event types', () => {
    for (const eventType of REQUIRED_EVENT_TYPES) {
      expect(isNotificationEligible(eventType)).toBe(true);
    }
  });

  it('returns false for webhook events', () => {
    expect(isNotificationEligible('webhook.ping')).toBe(false);
  });

  it('returns false for unknown event types', () => {
    expect(isNotificationEligible('unknown.event')).toBe(false);
  });
});

describe('CATALOGUE_BY_EVENT_TYPE', () => {
  it('contains all required event types as map keys', () => {
    for (const eventType of REQUIRED_EVENT_TYPES) {
      expect(CATALOGUE_BY_EVENT_TYPE.has(eventType)).toBe(true);
    }
  });

  it('map values match NOTIFICATION_CATALOGUE entries', () => {
    for (const entry of NOTIFICATION_CATALOGUE) {
      expect(CATALOGUE_BY_EVENT_TYPE.get(entry.eventType)).toBe(entry);
    }
  });
});
