import { NotificationEnvelope } from '../../src/sqs-envelope.schema';

export const TENANT_ID = '00000000-0000-0000-0000-000000000001';
export const CONTACT_ID = '00000000-0000-0000-0000-000000000002';
export const TICKET_ID = '00000000-0000-0000-0000-000000000003';

export function makeEnvelope(overrides?: Partial<NotificationEnvelope['data']>): string {
  const envelope: NotificationEnvelope = {
    version: '1',
    type: 'notification',
    data: {
      tenantId: TENANT_ID,
      dedupeKey: 'test-dedupe-key-001',
      templateKey: 'ticket_created',
      channel: 'email',
      recipientEmail: 'user@example.com',
      recipientContactId: CONTACT_ID,
      ticketId: TICKET_ID,
      locale: 'en',
      payload: { ticketTitle: 'Test ticket', portalUrl: 'https://portal.example.com' },
      outboxTraceId: 'trace-abc-123',
      ...overrides,
    },
  };
  return JSON.stringify(envelope);
}

export const DUPLICATE_ENVELOPE = makeEnvelope({ dedupeKey: 'test-dedupe-key-001' });

export const INVALID_ENVELOPE = JSON.stringify({ version: '2', type: 'unknown' });

export const MALFORMED_JSON = '{ not valid json }';
