/**
 * Canonical payload serialisation tests.
 *
 * Tests stable-key ordering so any accidental change in key order fails.
 * Golden-file assertions ensure serialisation drift is caught at build time.
 */
import { describe, it, expect } from 'vitest';
import { canonicalStringify, buildCanonicalEvent } from './canonical-payload';

// ---------------------------------------------------------------------------
// Known-good golden serialisations (committed — drift fails the build)
// ---------------------------------------------------------------------------

const GOLDEN_TICKET_CREATED = JSON.stringify({
  id: '00000000-0000-0000-0000-000000000001',
  type: 'ticket.created',
  occurredAt: '2026-01-15T12:00:00.000Z',
  tenantId: '10000000-0000-0000-0000-000000000001',
  data: { assigneeId: null, priority: 'P1', subject: 'Test ticket', ticketId: '40000000-0000-0000-0000-000000000001' },
});

const GOLDEN_TICKET_RESOLVED = JSON.stringify({
  id: '00000000-0000-0000-0000-000000000002',
  type: 'ticket.resolved',
  occurredAt: '2026-01-15T13:00:00.000Z',
  tenantId: '10000000-0000-0000-0000-000000000001',
  data: { resolvedAt: '2026-01-15T13:00:00.000Z', resolutionMinutes: 60, ticketId: '40000000-0000-0000-0000-000000000001' },
});

describe('canonicalStringify', () => {
  it('produces stable key order (top-level keys sorted)', () => {
    const event1 = buildCanonicalEvent(
      '00000000-0000-0000-0000-000000000001',
      'ticket.created',
      '10000000-0000-0000-0000-000000000001',
      new Date('2026-01-15T12:00:00.000Z'),
      { ticketId: '40000000-0000-0000-0000-000000000001', subject: 'Test ticket', priority: 'P1', assigneeId: null },
    );
    // Top-level event keys: id, type, occurredAt, tenantId, data (in canonical order)
    const result = canonicalStringify(event1);
    const parsed = JSON.parse(result);
    expect(Object.keys(parsed)).toEqual(['id', 'type', 'occurredAt', 'tenantId', 'data']);
  });

  it('sorts data keys recursively', () => {
    const event = buildCanonicalEvent(
      'id1', 'test.event', 'tenant1', new Date('2026-01-01T00:00:00Z'),
      { z: 1, a: 2, m: { y: 3, b: 4 } },
    );
    const result = canonicalStringify(event);
    const parsed = JSON.parse(result);
    expect(Object.keys(parsed.data)).toEqual(['a', 'm', 'z']);
    expect(Object.keys(parsed.data.m)).toEqual(['b', 'y']);
  });

  it('is deterministic regardless of insertion order', () => {
    const event1 = buildCanonicalEvent('id1', 't', 'tenant', new Date('2026-01-01'), { b: 1, a: 2 });
    const event2 = buildCanonicalEvent('id1', 't', 'tenant', new Date('2026-01-01'), { a: 2, b: 1 });
    expect(canonicalStringify(event1)).toBe(canonicalStringify(event2));
  });

  it('preserves array ordering (arrays are not sorted)', () => {
    const event = buildCanonicalEvent('id', 't', 'tenant', new Date('2026-01-01'), {
      items: [3, 1, 2],
    });
    const result = canonicalStringify(event);
    const parsed = JSON.parse(result);
    expect(parsed.data.items).toEqual([3, 1, 2]);
  });

  it('ticket.created golden file assertion', () => {
    const event = buildCanonicalEvent(
      '00000000-0000-0000-0000-000000000001',
      'ticket.created',
      '10000000-0000-0000-0000-000000000001',
      new Date('2026-01-15T12:00:00.000Z'),
      { ticketId: '40000000-0000-0000-0000-000000000001', subject: 'Test ticket', priority: 'P1', assigneeId: null },
    );
    expect(canonicalStringify(event)).toBe(GOLDEN_TICKET_CREATED);
  });

  it('ticket.resolved golden file assertion', () => {
    const event = buildCanonicalEvent(
      '00000000-0000-0000-0000-000000000002',
      'ticket.resolved',
      '10000000-0000-0000-0000-000000000001',
      new Date('2026-01-15T13:00:00.000Z'),
      { ticketId: '40000000-0000-0000-0000-000000000001', resolutionMinutes: 60, resolvedAt: '2026-01-15T13:00:00.000Z' },
    );
    expect(canonicalStringify(event)).toBe(GOLDEN_TICKET_RESOLVED);
  });
});
