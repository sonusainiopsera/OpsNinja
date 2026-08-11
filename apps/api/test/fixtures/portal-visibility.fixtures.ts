/**
 * Portal visibility test fixtures.
 *
 * Provides signed portal and agent tokens, seeded ticket/comment/attachment data,
 * and organisation IDs for two organisations so cross-org isolation can be tested
 * alongside visibility filtering.
 */

import * as jwt from 'jsonwebtoken';
import { TEST_KEY_PAIR, TEST_ISSUER, TENANT_A_ID } from './rbac.fixtures';
import type { Ticket } from '@opsninja/db';
import type { Comment } from '@opsninja/db';
import type { Attachment } from '@opsninja/db';

export { TENANT_A_ID };

// ── Well-known IDs ────────────────────────────────────────────────────────────

export const ORG_A_ID  = '00000000-0000-0000-bbbb-000000000001';
export const ORG_B_ID  = '00000000-0000-0000-bbbb-000000000002';

export const PORTAL_USER_A_ID  = '00000000-0000-0000-cccc-000000000001';
export const PORTAL_USER_B_ID  = '00000000-0000-0000-cccc-000000000002';
export const AGENT_USER_ID     = '00000000-0000-0000-cccc-000000000003';

export const TICKET_A_ID    = '00000000-0000-0000-dddd-000000000001';
export const TICKET_B_ID    = '00000000-0000-0000-dddd-000000000002';
export const PUBLIC_COMMENT_1_ID   = '00000000-0000-0000-eeee-000000000001';
export const PUBLIC_COMMENT_2_ID   = '00000000-0000-0000-eeee-000000000002';
export const INTERNAL_COMMENT_1_ID = '00000000-0000-0000-eeee-000000000003';
export const INTERNAL_COMMENT_2_ID = '00000000-0000-0000-eeee-000000000004';
export const PUBLIC_ATTACHMENT_ID   = '00000000-0000-0000-ffff-000000000001';
export const INTERNAL_ATTACHMENT_ID = '00000000-0000-0000-ffff-000000000002';

// ── Portal token factory ──────────────────────────────────────────────────────

export function mintPortalToken(orgId: string, userId: string = PORTAL_USER_A_ID): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub: userId,
      tenant_id: TENANT_A_ID,
      roles: ['portal_user'],
      org_scope_version: 0,
      org_scope_ids: [orgId],
      user_type: 'portal',
      jti: `portal-jti-${userId}`,
      iat: now,
      exp: now + 900,
      iss: TEST_ISSUER,
      aud: 'opsninja-portal',
    },
    TEST_KEY_PAIR.privateKey,
    { algorithm: 'RS256', keyid: TEST_KEY_PAIR.kid, noTimestamp: true },
  );
}

/** Portal token for org A (the default test org). */
export const PORTAL_TOKEN_ORG_A = mintPortalToken(ORG_A_ID, PORTAL_USER_A_ID);
/** Portal token for org B (cross-org isolation tests). */
export const PORTAL_TOKEN_ORG_B = mintPortalToken(ORG_B_ID, PORTAL_USER_B_ID);

// ── Seeded ticket data ────────────────────────────────────────────────────────

const now = new Date();

/** A ticket belonging to org A with mixed public and internal comments. */
export const SEEDED_TICKET_ORG_A: Ticket = {
  id: TICKET_A_ID,
  tenantId: TENANT_A_ID,
  organizationId: ORG_A_ID,
  subject: 'Login issue - org A',
  description: 'Cannot log in after password reset.',
  status: 'open',
  priority: 'p2',
  assigneeId: AGENT_USER_ID,
  createdById: PORTAL_USER_A_ID,
  isPublic: true,
  aiSummary: 'Customer reports login failure post-reset.',
  createdAt: now,
  updatedAt: now,
  resolvedAt: null,
};

/** A ticket belonging to org B (used to verify cross-org 404). */
export const SEEDED_TICKET_ORG_B: Ticket = {
  id: TICKET_B_ID,
  tenantId: TENANT_A_ID,
  organizationId: ORG_B_ID,
  subject: 'Billing query - org B',
  description: null,
  status: 'open',
  priority: 'p3',
  assigneeId: null,
  createdById: PORTAL_USER_B_ID,
  isPublic: true,
  aiSummary: null,
  createdAt: now,
  updatedAt: now,
  resolvedAt: null,
};

// ── Seeded comment data ───────────────────────────────────────────────────────

export const PUBLIC_COMMENT_1: Comment = {
  id: PUBLIC_COMMENT_1_ID,
  tenantId: TENANT_A_ID,
  ticketId: TICKET_A_ID,
  authorId: PORTAL_USER_A_ID,
  body: 'Still seeing the issue.',
  visibility: 'public',
  createdAt: now,
  updatedAt: now,
};

export const PUBLIC_COMMENT_2: Comment = {
  id: PUBLIC_COMMENT_2_ID,
  tenantId: TENANT_A_ID,
  ticketId: TICKET_A_ID,
  authorId: AGENT_USER_ID,
  body: 'We are looking into it.',
  visibility: 'public',
  createdAt: now,
  updatedAt: now,
};

export const INTERNAL_COMMENT_1: Comment = {
  id: INTERNAL_COMMENT_1_ID,
  tenantId: TENANT_A_ID,
  ticketId: TICKET_A_ID,
  authorId: AGENT_USER_ID,
  body: 'Internal: check the auth microservice logs.',
  visibility: 'internal',
  createdAt: now,
  updatedAt: now,
};

export const INTERNAL_COMMENT_2: Comment = {
  id: INTERNAL_COMMENT_2_ID,
  tenantId: TENANT_A_ID,
  ticketId: TICKET_A_ID,
  authorId: AGENT_USER_ID,
  body: 'Internal note: escalate to tier-2.',
  visibility: 'internal',
  createdAt: now,
  updatedAt: now,
};

export const ALL_COMMENTS = [
  PUBLIC_COMMENT_1,
  PUBLIC_COMMENT_2,
  INTERNAL_COMMENT_1,
  INTERNAL_COMMENT_2,
];
export const PUBLIC_COMMENTS = [PUBLIC_COMMENT_1, PUBLIC_COMMENT_2];
export const INTERNAL_COMMENTS = [INTERNAL_COMMENT_1, INTERNAL_COMMENT_2];

// ── Seeded attachment data ────────────────────────────────────────────────────

export const PUBLIC_ATTACHMENT: Attachment = {
  id: PUBLIC_ATTACHMENT_ID,
  tenantId: TENANT_A_ID,
  commentId: PUBLIC_COMMENT_1_ID,
  filename: 'screenshot.png',
  mimeType: 'image/png',
  sizeBytes: 102400,
  s3Key: 'attachments/tenant-a/screenshot.png',
  createdAt: now,
};

export const INTERNAL_ATTACHMENT: Attachment = {
  id: INTERNAL_ATTACHMENT_ID,
  tenantId: TENANT_A_ID,
  commentId: INTERNAL_COMMENT_1_ID,
  filename: 'debug-logs.txt',
  mimeType: 'text/plain',
  sizeBytes: 2048,
  s3Key: 'attachments/tenant-a/debug-logs.txt',
  createdAt: now,
};
