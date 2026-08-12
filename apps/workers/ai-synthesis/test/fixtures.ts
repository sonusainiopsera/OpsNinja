/**
 * AI Synthesis Worker — test fixtures.
 *
 * AC-13: seeded tickets with 1, 12 and 30 comments across two tenants,
 *        including internal-only notes, for reuse by unit and integration tests.
 */

import type { SynthesisMessage } from '../src/synthesis.service';
import type { SynthesisRequest, SynthesisResult, ThreadMessage } from '../src/llm-provider.port';

// ---------------------------------------------------------------------------
// Deterministic UUIDs
// ---------------------------------------------------------------------------

export const AS_TENANT_A = 'a0000000-0000-0000-0000-000000000001';
export const AS_TENANT_B = 'b0000000-0000-0000-0000-000000000002';

export const AS_TICKET_1_COMMENT = 'c0000000-0000-0000-0000-000000000001';
export const AS_TICKET_12_COMMENTS = 'c0000000-0000-0000-0000-000000000012';
export const AS_TICKET_30_COMMENTS = 'c0000000-0000-0000-0000-000000000030';
export const AS_TICKET_INTERNAL_ONLY = 'c0000000-0000-0000-0000-000000000099';
export const AS_TICKET_NO_COMMENTS = 'c0000000-0000-0000-0000-000000000000';
export const AS_TICKET_TENANT_B = 'c0000000-0000-0000-0000-000000000088';

export const AS_EVENT_ID_1 = 'e0000000-0000-0000-0000-000000000001';
export const AS_EVENT_ID_2 = 'e0000000-0000-0000-0000-000000000002';
export const AS_EVENT_ID_3 = 'e0000000-0000-0000-0000-000000000003';

// ---------------------------------------------------------------------------
// SynthesisMessage fixtures
// ---------------------------------------------------------------------------

export const MSG_TENANT_A_1_COMMENT: SynthesisMessage = {
  eventId: AS_EVENT_ID_1,
  eventType: 'ticket.resolved',
  tenantId: AS_TENANT_A,
  ticketId: AS_TICKET_1_COMMENT,
  occurredAt: '2026-01-10T12:00:00.000Z',
  traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
};

export const MSG_TENANT_A_12_COMMENTS: SynthesisMessage = {
  eventId: AS_EVENT_ID_2,
  eventType: 'ticket.resolved',
  tenantId: AS_TENANT_A,
  ticketId: AS_TICKET_12_COMMENTS,
  occurredAt: '2026-01-11T09:30:00.000Z',
};

export const MSG_TENANT_B: SynthesisMessage = {
  eventId: AS_EVENT_ID_3,
  eventType: 'ticket.resolved',
  tenantId: AS_TENANT_B,
  ticketId: AS_TICKET_TENANT_B,
  occurredAt: '2026-01-12T14:00:00.000Z',
};

// ---------------------------------------------------------------------------
// ThreadMessage helpers
// ---------------------------------------------------------------------------

function publicMsg(body: string, daysAgo: number): ThreadMessage {
  const d = new Date('2026-01-10T00:00:00Z');
  d.setDate(d.getDate() - daysAgo);
  return { role: 'portal_user', visibility: 'public', body, createdAt: d.toISOString() };
}

function agentMsg(body: string, daysAgo: number): ThreadMessage {
  const d = new Date('2026-01-10T00:00:00Z');
  d.setDate(d.getDate() - daysAgo);
  return { role: 'agent', visibility: 'public', body, createdAt: d.toISOString() };
}

function internalMsg(body: string, daysAgo: number): ThreadMessage {
  const d = new Date('2026-01-10T00:00:00Z');
  d.setDate(d.getDate() - daysAgo);
  return { role: 'agent', visibility: 'internal', body, createdAt: d.toISOString() };
}

// ---------------------------------------------------------------------------
// SynthesisRequest fixtures — 1, 12 and 30 comments across two tenants
// ---------------------------------------------------------------------------

/** Ticket with exactly 1 public comment (Tenant A). */
export const REQUEST_1_COMMENT: SynthesisRequest = {
  ticketId: AS_TICKET_1_COMMENT,
  tenantId: AS_TENANT_A,
  subject: 'Cannot log in after password reset',
  description: 'User reports login page returns 401 after password reset flow.',
  priority: 'P2',
  categoryPath: 'Authentication > Login',
  organizationName: 'Acme Corp',
  truncated: false,
  messages: [
    publicMsg('I reset my password but still cannot log in. Error: 401 Unauthorized.', 5),
  ],
};

/** Ticket with 12 comments mixing public replies and internal notes (Tenant A). */
export const REQUEST_12_COMMENTS: SynthesisRequest = {
  ticketId: AS_TICKET_12_COMMENTS,
  tenantId: AS_TENANT_A,
  subject: 'Billing invoice shows incorrect amount',
  description: 'Customer reports their March invoice includes charges for cancelled subscription.',
  priority: 'P1',
  categoryPath: 'Billing > Invoices',
  organizationName: 'Globex Corp',
  truncated: false,
  messages: [
    publicMsg('The invoice for March shows $299 but I cancelled in February.', 14),
    agentMsg('Hi, I can see the cancellation in our system. Let me investigate the billing cycle.', 13),
    internalMsg('Checked Stripe — proration was not applied at cancellation. Need to issue credit.', 13),
    publicMsg('Any update on this? Our accounting team is asking.', 12),
    agentMsg('Confirmed the issue — your cancellation proration was missed. Issuing a credit note.', 11),
    internalMsg('Credit note CN-2026-0033 raised in Stripe. Awaiting approval from billing team.', 11),
    publicMsg('Thank you. When will the credit appear?', 10),
    agentMsg('The credit of $149.50 has been approved and will appear within 5 business days.', 9),
    internalMsg('Approved by billing manager Sarah K. Stripe payout scheduled for 2026-01-20.', 9),
    publicMsg('I can see the credit on my account now. Thank you for resolving this.', 6),
    agentMsg('Great, glad we could sort that out. Is there anything else I can help you with?', 5),
    publicMsg('No, all sorted. Thank you!', 4),
  ],
};

/** Ticket with 30 comments (Tenant A). */
export const REQUEST_30_COMMENTS: SynthesisRequest = {
  ticketId: AS_TICKET_30_COMMENTS,
  tenantId: AS_TENANT_A,
  subject: 'API rate limits causing intermittent 429 errors',
  description: 'Integration partner reports 429 errors on the /v2/tickets endpoint during peak hours.',
  priority: 'P1',
  categoryPath: 'API > Rate Limits',
  organizationName: 'TechStart Ltd',
  truncated: false,
  messages: Array.from({ length: 30 }, (_, i) => {
    const daysAgo = 30 - i;
    if (i % 3 === 0) return internalMsg(`Internal review ${i + 1}: checking rate limit counters in Redis.`, daysAgo);
    if (i % 3 === 1) return agentMsg(`Agent update ${i + 1}: rate limit headers have been adjusted.`, daysAgo);
    return publicMsg(`Customer follow-up ${i + 1}: still seeing occasional 429s in the logs.`, daysAgo);
  }),
};

/** Ticket with internal-only notes and no public replies (Tenant A). */
export const REQUEST_INTERNAL_ONLY: SynthesisRequest = {
  ticketId: AS_TICKET_INTERNAL_ONLY,
  tenantId: AS_TENANT_A,
  subject: 'Security audit finding — CVE-2025-1234',
  description: 'Internal security team identified potential XSS vector in the portal comment field.',
  priority: 'P1',
  categoryPath: 'Security',
  organizationName: 'Acme Corp',
  truncated: false,
  messages: [
    internalMsg('Confirmed XSS via unescaped HTML in the comment body renderer.', 10),
    internalMsg('Fix deployed to staging. Awaiting security sign-off.', 8),
    internalMsg('Security sign-off received from Alice. Deploying to production.', 6),
  ],
};

/** Ticket with no comments at all (subject + description only). */
export const REQUEST_NO_COMMENTS: SynthesisRequest = {
  ticketId: AS_TICKET_NO_COMMENTS,
  tenantId: AS_TENANT_A,
  subject: 'Timeout on dashboard load',
  description: 'Dashboard takes over 30 seconds to load for this customer.',
  priority: 'P2',
  categoryPath: 'Performance',
  organizationName: 'Acme Corp',
  truncated: false,
  messages: [],
};

/** Ticket for Tenant B — used to verify cross-tenant invisibility. */
export const REQUEST_TENANT_B: SynthesisRequest = {
  ticketId: AS_TICKET_TENANT_B,
  tenantId: AS_TENANT_B,
  subject: 'SSO configuration not saving',
  description: 'SAML configuration resets to defaults after saving.',
  priority: 'P2',
  categoryPath: 'Authentication > SSO',
  organizationName: 'Initech Ltd',
  truncated: false,
  messages: [
    publicMsg('Every time I save the SAML settings they revert to defaults.', 3),
    agentMsg('We have identified a caching bug causing the revert. Fix is being deployed.', 2),
  ],
};

// ---------------------------------------------------------------------------
// SynthesisResult fixture
// ---------------------------------------------------------------------------

export const SYNTHESIS_RESULT_SUCCESS: SynthesisResult = {
  cruxSummary: 'User was unable to log in after password reset due to a session cache inconsistency.',
  resolutionSummary: 'The session cache was cleared and the authentication flow was corrected. User confirmed login is now working.',
  affectedAreas: [
    { areaLabel: 'authentication', confidence: 'high' },
    { areaLabel: 'session-management', confidence: 'medium' },
  ],
  modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  promptVersion: 'v1.0.0',
  promptTokens: 1200,
  completionTokens: 280,
  generatedAt: new Date('2026-01-10T12:05:00.000Z'),
};

export const SYNTHESIS_RESULT_WITH_DUPLICATES: SynthesisResult = {
  cruxSummary: 'Billing proration was not applied on cancellation.',
  resolutionSummary: 'Credit note issued and approved. Proration logic patched for future cancellations.',
  affectedAreas: [
    { areaLabel: 'Billing', confidence: 'high' },
    { areaLabel: 'billing', confidence: 'medium' },  // duplicate — different case
    { areaLabel: '  Billing  ', confidence: 'low' }, // duplicate — with whitespace
    { areaLabel: 'invoicing', confidence: 'high' },
  ],
  modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  promptVersion: 'v1.0.0',
  promptTokens: 2100,
  completionTokens: 340,
  generatedAt: new Date('2026-01-11T09:35:00.000Z'),
};
