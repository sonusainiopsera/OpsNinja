/**
 * portal-ticket.fixtures.ts — WO-089 fixtures for portal ticket creation tests.
 *
 * Provides:
 *   - Onboarded portal user fixture
 *   - Category tree fixture
 *   - Sample presign/confirm request fixtures
 *   - Sample attachment row fixtures (pending and confirmed)
 *
 * AC-14: these fixtures are committed alongside the integration tests.
 */

import type { TicketAttachment } from '@opsninja/db';

// ---------------------------------------------------------------------------
// Deterministic UUIDs
// ---------------------------------------------------------------------------

export const PORTAL_TENANT_ID     = 'cc000000-0000-0000-0000-000000000001';
export const PORTAL_ORG_ID        = 'cc000000-0000-0001-0000-000000000001';
export const PORTAL_USER_ID       = 'cc000000-0000-0002-0000-000000000001';
export const PORTAL_CATEGORY_ID   = 'cc000000-0000-0003-0000-000000000001';
export const PORTAL_ATTACHMENT_ID = 'cc000000-0000-0004-0000-000000000001';
export const PORTAL_TICKET_ID     = 'cc000000-0000-0005-0000-000000000001';

// ---------------------------------------------------------------------------
// Onboarded portal user principal fixture (AC-14)
// ---------------------------------------------------------------------------

export const ONBOARDED_PORTAL_PRINCIPAL = {
  sub:                 PORTAL_USER_ID,
  tenantId:            PORTAL_TENANT_ID,
  userId:              PORTAL_USER_ID,
  principalKind:       'portal' as const,
  roles:               ['portal_user'],
  orgScopeIds:         [PORTAL_ORG_ID],
  boundOrganizationId: PORTAL_ORG_ID,
  traceId:             'fixture-trace-cc-001',
};

// ---------------------------------------------------------------------------
// Category tree fixture (AC-14)
// ---------------------------------------------------------------------------

export const CATEGORY_TREE = [
  {
    id:       PORTAL_CATEGORY_ID,
    tenantId: PORTAL_TENANT_ID,
    label:    'Pipeline / CI–CD',
    parentId: null,
    children: [
      {
        id:       'cc000000-0000-0003-0000-000000000002',
        tenantId: PORTAL_TENANT_ID,
        label:    'Jenkins Integration',
        parentId: PORTAL_CATEGORY_ID,
        children: [],
      },
      {
        id:       'cc000000-0000-0003-0000-000000000003',
        tenantId: PORTAL_TENANT_ID,
        label:    'GitHub Actions',
        parentId: PORTAL_CATEGORY_ID,
        children: [],
      },
    ],
  },
  {
    id:       'cc000000-0000-0003-0000-000000000004',
    tenantId: PORTAL_TENANT_ID,
    label:    'Infrastructure',
    parentId: null,
    children: [],
  },
];

// ---------------------------------------------------------------------------
// Presign request fixture (AC-5)
// ---------------------------------------------------------------------------

export const PRESIGN_REQUEST = {
  fileName:            'pipeline-failure.log',
  declaredContentType: 'text/plain',
  sizeBytes:           4096,
};

export const PRESIGN_REQUEST_PNG = {
  fileName:            'screenshot.png',
  declaredContentType: 'image/png',
  sizeBytes:           102400,
};

// Spoofed extension: shell script named as PNG
export const PRESIGN_REQUEST_SPOOFED = {
  fileName:            'exploit.png',
  declaredContentType: 'image/png',
  sizeBytes:           136, // small — matches spoofed-shell.png fixture
};

// ---------------------------------------------------------------------------
// Attachment row fixtures
// ---------------------------------------------------------------------------

const BASE_DATE = new Date('2026-01-15T10:00:00Z');

/** Pending attachment row (presigned, not yet confirmed). */
export const PENDING_ATTACHMENT_ROW: Partial<TicketAttachment> = {
  id:               PORTAL_ATTACHMENT_ID,
  tenantId:         PORTAL_TENANT_ID,
  organizationId:   PORTAL_ORG_ID,
  uploadedByUserId: PORTAL_USER_ID,
  ticketId:         null,
  filename:         'pipeline-failure.log',
  mimeType:         'text/plain',
  detectedMime:     null,
  s3Key:            `tenants/${PORTAL_TENANT_ID}/attachments/${PORTAL_ATTACHMENT_ID}`,
  fileSizeBytes:    null,
  isFinalized:      false,
  createdAt:        BASE_DATE,
  finalizedAt:      null,
};

/** Confirmed attachment row (magic bytes verified, ready to link). */
export const CONFIRMED_ATTACHMENT_ROW: Partial<TicketAttachment> = {
  ...PENDING_ATTACHMENT_ROW,
  detectedMime:  'text/plain',
  fileSizeBytes: 4096,
  isFinalized:   true,
  finalizedAt:   new Date('2026-01-15T10:02:00Z'),
};

// ---------------------------------------------------------------------------
// Valid portal ticket creation request (AC-1)
// ---------------------------------------------------------------------------

export const VALID_TICKET_REQUEST = {
  subject:           'Jenkins pipeline failing on main — all tests fail',
  description:       `## Problem\n\nAll PRs to main have failed at the integration-test stage since 08:00 UTC today.\n\n## Steps to reproduce\n\n1. Open any PR targeting main\n2. Observe that tests fail at stage: integration-tests\n3. Error: ETIMEDOUT connecting to test-db.internal\n\n## Expected\n\nTests pass as they did before 08:00 UTC.`,
  categoryId:        PORTAL_CATEGORY_ID,
  requestedPriority: 'P2',
  customFields:      {},
  attachmentIds:     [] as string[],
};

export const TICKET_REQUEST_WITH_ATTACHMENT = {
  ...VALID_TICKET_REQUEST,
  attachmentIds: [PORTAL_ATTACHMENT_ID],
};
