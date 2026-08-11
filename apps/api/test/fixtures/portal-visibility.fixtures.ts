/**
 * Portal visibility test fixtures — runnable offline without a real database.
 *
 * Provides seeded in-memory data for integration tests:
 *   - One tenant with two organisations (org A and org B)
 *   - One ticket per organisation
 *   - Two public and two internal comments per ticket
 *   - One attachment per comment
 *   - Portal principal bound to org A
 *   - Staff principal with access to both organisations
 *   - Tenant settings with AI summary disabled (default) and enabled variants
 */

import type { Ticket, TicketComment, TicketAttachment, TenantSettings } from '@opsninja/db';
import type { PortalPrincipal } from '../../src/modules/identity/portal/portal-principal';

// ---------------------------------------------------------------------------
// Seeded IDs (deterministic UUIDs for assertions)
// ---------------------------------------------------------------------------

export const FIXTURE_TENANT_ID = '10000000-0000-0000-0000-000000000001';
export const FIXTURE_ORG_A_ID = '10000000-0000-0000-0001-000000000001';
export const FIXTURE_ORG_B_ID = '10000000-0000-0000-0001-000000000002';
export const FIXTURE_PORTAL_USER_ID = '10000000-0000-0000-0002-000000000001';
export const FIXTURE_STAFF_USER_ID = '10000000-0000-0000-0002-000000000002';

export const FIXTURE_TICKET_ORG_A = '10000000-0000-0000-0003-000000000001';
export const FIXTURE_TICKET_ORG_B = '10000000-0000-0000-0003-000000000002';

export const FIXTURE_COMMENT_PUBLIC_1 = '10000000-0000-0000-0004-000000000001';
export const FIXTURE_COMMENT_PUBLIC_2 = '10000000-0000-0000-0004-000000000002';
export const FIXTURE_COMMENT_INTERNAL_1 = '10000000-0000-0000-0004-000000000003';
export const FIXTURE_COMMENT_INTERNAL_2 = '10000000-0000-0000-0004-000000000004';

export const FIXTURE_ATTACHMENT_PUBLIC_1 = '10000000-0000-0000-0005-000000000001';
export const FIXTURE_ATTACHMENT_INTERNAL_1 = '10000000-0000-0000-0005-000000000002';

// ---------------------------------------------------------------------------
// Fixture data builders
// ---------------------------------------------------------------------------

const BASE_DATE = new Date('2024-06-01T00:00:00.000Z');

export const FIXTURE_TICKET_ORG_A_DATA: Ticket = {
  id: FIXTURE_TICKET_ORG_A,
  tenantId: FIXTURE_TENANT_ID,
  organizationId: FIXTURE_ORG_A_ID,
  subject: 'Portal test ticket',
  status: 'open',
  priority: 'P3',
  assigneeId: FIXTURE_STAFF_USER_ID,
  aiSummary: 'AI generated summary',
  affectedAreaTags: ['billing', 'access'],
  createdAt: BASE_DATE,
  updatedAt: BASE_DATE,
  resolvedAt: null,
};

export const FIXTURE_TICKET_ORG_B_DATA: Ticket = {
  id: FIXTURE_TICKET_ORG_B,
  tenantId: FIXTURE_TENANT_ID,
  organizationId: FIXTURE_ORG_B_ID,
  subject: 'Org B ticket — not visible to org A portal user',
  status: 'open',
  priority: 'P2',
  assigneeId: null,
  aiSummary: null,
  affectedAreaTags: null,
  createdAt: BASE_DATE,
  updatedAt: BASE_DATE,
  resolvedAt: null,
};

/** Public comment — visible to portal users. */
export const FIXTURE_PUBLIC_COMMENT_1: TicketComment = {
  id: FIXTURE_COMMENT_PUBLIC_1,
  tenantId: FIXTURE_TENANT_ID,
  ticketId: FIXTURE_TICKET_ORG_A,
  organizationId: FIXTURE_ORG_A_ID,
  authorId: FIXTURE_PORTAL_USER_ID,
  body: 'This is a public comment visible to portal users.',
  visibility: 'public',
  createdAt: BASE_DATE,
  updatedAt: BASE_DATE,
};

/** Second public comment. */
export const FIXTURE_PUBLIC_COMMENT_2: TicketComment = {
  id: FIXTURE_COMMENT_PUBLIC_2,
  tenantId: FIXTURE_TENANT_ID,
  ticketId: FIXTURE_TICKET_ORG_A,
  organizationId: FIXTURE_ORG_A_ID,
  authorId: FIXTURE_STAFF_USER_ID,
  body: 'Agent response visible to portal users.',
  visibility: 'public',
  createdAt: BASE_DATE,
  updatedAt: BASE_DATE,
};

/** Internal comment — must NOT be visible to portal users. */
export const FIXTURE_INTERNAL_COMMENT_1: TicketComment = {
  id: FIXTURE_COMMENT_INTERNAL_1,
  tenantId: FIXTURE_TENANT_ID,
  ticketId: FIXTURE_TICKET_ORG_A,
  organizationId: FIXTURE_ORG_A_ID,
  authorId: FIXTURE_STAFF_USER_ID,
  body: 'Internal note: customer is on legacy plan, expedite.',
  visibility: 'internal',
  createdAt: BASE_DATE,
  updatedAt: BASE_DATE,
};

/** Second internal comment. */
export const FIXTURE_INTERNAL_COMMENT_2: TicketComment = {
  id: FIXTURE_COMMENT_INTERNAL_2,
  tenantId: FIXTURE_TENANT_ID,
  ticketId: FIXTURE_TICKET_ORG_A,
  organizationId: FIXTURE_ORG_A_ID,
  authorId: FIXTURE_STAFF_USER_ID,
  body: 'SLA breach in 2 hours — escalating to L2.',
  visibility: 'internal',
  createdAt: BASE_DATE,
  updatedAt: BASE_DATE,
};

/** Attachment on a public comment — portal users may download. */
export const FIXTURE_ATTACHMENT_ON_PUBLIC: TicketAttachment = {
  id: FIXTURE_ATTACHMENT_PUBLIC_1,
  tenantId: FIXTURE_TENANT_ID,
  ticketId: FIXTURE_TICKET_ORG_A,
  commentId: FIXTURE_COMMENT_PUBLIC_1,
  organizationId: FIXTURE_ORG_A_ID,
  filename: 'screenshot.png',
  mimeType: 'image/png',
  s3Key: `${FIXTURE_TENANT_ID}/attachments/${FIXTURE_ATTACHMENT_PUBLIC_1}.png`,
  createdAt: BASE_DATE,
};

/** Attachment on an internal comment — portal users must NOT download. */
export const FIXTURE_ATTACHMENT_ON_INTERNAL: TicketAttachment = {
  id: FIXTURE_ATTACHMENT_INTERNAL_1,
  tenantId: FIXTURE_TENANT_ID,
  ticketId: FIXTURE_TICKET_ORG_A,
  commentId: FIXTURE_COMMENT_INTERNAL_1,
  organizationId: FIXTURE_ORG_A_ID,
  filename: 'internal-diagnostic.pdf',
  mimeType: 'application/pdf',
  s3Key: `${FIXTURE_TENANT_ID}/attachments/${FIXTURE_ATTACHMENT_INTERNAL_1}.pdf`,
  createdAt: BASE_DATE,
};

/** Portal principal bound to org A. */
export const FIXTURE_PORTAL_PRINCIPAL: PortalPrincipal = {
  tenantId: FIXTURE_TENANT_ID,
  userId: FIXTURE_PORTAL_USER_ID,
  principalKind: 'portal',
  roles: ['portal_user'],
  orgScopeIds: [FIXTURE_ORG_A_ID],
  traceId: 'fixture-trace-portal-001',
  boundOrganizationId: FIXTURE_ORG_A_ID,
};

/** Tenant settings with AI summary disabled (default). */
export const FIXTURE_TENANT_SETTINGS_AI_DISABLED: TenantSettings = {
  tenantId: FIXTURE_TENANT_ID,
  portalAiSummaryEnabled: false,
  updatedAt: BASE_DATE,
};

/** Tenant settings with AI summary enabled. */
export const FIXTURE_TENANT_SETTINGS_AI_ENABLED: TenantSettings = {
  tenantId: FIXTURE_TENANT_ID,
  portalAiSummaryEnabled: true,
  updatedAt: BASE_DATE,
};

/** All comments for org A ticket (public + internal). */
export const ALL_COMMENTS = [
  FIXTURE_PUBLIC_COMMENT_1,
  FIXTURE_PUBLIC_COMMENT_2,
  FIXTURE_INTERNAL_COMMENT_1,
  FIXTURE_INTERNAL_COMMENT_2,
];

/** Only public comments — what portal users should see. */
export const PUBLIC_COMMENTS_ONLY = [FIXTURE_PUBLIC_COMMENT_1, FIXTURE_PUBLIC_COMMENT_2];
