/**
 * Sample SQS notification envelopes for unit and integration tests.
 */

export const TENANT_ID = '00000000-0000-0000-0000-000000000001';
export const TENANT_B_ID = '00000000-0000-0000-0000-000000000002';
export const TICKET_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
export const CONTACT_ID = 'cccccccc-0000-0000-0000-000000000001';

export const validEnvelope = {
  tenantId: TENANT_ID,
  recipientEmail: 'agent@example.com',
  templateKey: 'ticket.created',
  dedupeKey: `${TENANT_ID}:ticket.created:${TICKET_ID}:v1`,
  ticketId: TICKET_ID,
  recipientContactId: CONTACT_ID,
  payload: {
    ticketSubject: 'Login button broken',
    tenantName: 'Acme Corp',
  },
  traceId: 'trace-0001',
};

export const duplicateEnvelope = { ...validEnvelope };

export const crossTenantEnvelope = {
  ...validEnvelope,
  tenantId: TENANT_B_ID,
  dedupeKey: `${TENANT_B_ID}:ticket.created:${TICKET_ID}:v1`,
};

export const invalidEnvelope = {
  tenantId: 'not-a-uuid',
  recipientEmail: 'not-an-email',
  templateKey: '',
  dedupeKey: 'd1',
};

export const envelopeWithHtmlPayload = {
  ...validEnvelope,
  dedupeKey: `${TENANT_ID}:ticket.created:${TICKET_ID}:v2`,
  payload: {
    ticketSubject: '<script>alert("xss")</script>',
    tenantName: 'Acme &amp; Sons',
  },
};
