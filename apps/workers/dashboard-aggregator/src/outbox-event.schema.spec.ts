/**
 * Unit tests for the outbox event parser.
 * Tests SNS envelope unwrapping, field validation, and malformed input rejection.
 */

import { parseOutboxEvent } from './outbox-event.schema';
import {
  ticketCreatedP1,
  makeSqsBody,
  makeSnsSqsBody,
} from '../test/fixtures/outbox-events.fixtures';

describe('parseOutboxEvent', () => {
  it('parses a direct JSON body', () => {
    const result = parseOutboxEvent(makeSqsBody(ticketCreatedP1));
    expect(result).not.toBeNull();
    expect(result?.eventId).toBe(ticketCreatedP1.eventId);
    expect(result?.eventType).toBe('ticket.created');
  });

  it('unwraps an SNS fan-out envelope', () => {
    const result = parseOutboxEvent(makeSnsSqsBody(ticketCreatedP1));
    expect(result).not.toBeNull();
    expect(result?.tenantId).toBe(ticketCreatedP1.tenantId);
  });

  it('returns null for malformed JSON', () => {
    expect(parseOutboxEvent('not json')).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    const incomplete = JSON.stringify({ eventType: 'ticket.created' });
    expect(parseOutboxEvent(incomplete)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseOutboxEvent('')).toBeNull();
  });
});
