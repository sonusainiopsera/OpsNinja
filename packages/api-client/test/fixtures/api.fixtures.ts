/**
 * JSON fixtures for MSW handlers, validated against the OpenAPI 3.1 contract.
 * All IDs, emails and names use example.invalid / TEST-NET addresses.
 */

import type {
  ApiErrorEnvelope,
  Ticket,
  Agent,
  Organization,
  PaginatedResponse,
  Principal,
} from '../../src/generated/openapi-types';

// ── Principals ─────────────────────────────────────────────────────────────────

export const FIXTURE_PRINCIPAL: Principal = {
  id: 'usr_test_001',
  name: 'Test Agent',
  email: 'agent@example.invalid',
  role: 'agent',
  roles: ['agent'],
  tenantId: 'tnt_test_001',
  orgScopeVersion: 1,
};

// ── Organizations ──────────────────────────────────────────────────────────────

export const FIXTURE_ORG_ALPHA: Organization = {
  id: 'org_alpha_001',
  name: 'Alpha Corp',
  tenantId: 'tnt_test_001',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

export const FIXTURE_ORG_BETA: Organization = {
  id: 'org_beta_001',
  name: 'Beta Inc',
  tenantId: 'tnt_test_001',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

// ── Tickets ────────────────────────────────────────────────────────────────────

export const FIXTURE_TICKET_1: Ticket = {
  id: 'tkt_test_001',
  title: 'Test ticket 1',
  description: 'A test ticket',
  status: 'open',
  priority: 'medium',
  tenantId: 'tnt_test_001',
  organizationId: 'org_alpha_001',
  assigneeId: null,
  createdAt: '2025-06-01T10:00:00.000Z',
  updatedAt: '2025-06-01T10:00:00.000Z',
  version: 1,
};

export const FIXTURE_TICKET_2: Ticket = {
  ...FIXTURE_TICKET_1,
  id: 'tkt_test_002',
  title: 'Test ticket 2',
};

export const FIXTURE_TICKET_UPDATED: Ticket = {
  ...FIXTURE_TICKET_1,
  title: 'Updated ticket',
  version: 2,
  updatedAt: '2025-06-01T11:00:00.000Z',
};

export const FIXTURE_TICKETS_PAGE_1: PaginatedResponse<Ticket> = {
  data: [FIXTURE_TICKET_1, FIXTURE_TICKET_2],
  pagination: { nextCursor: 'cursor_page_2' },
};

export const FIXTURE_TICKETS_PAGE_2: PaginatedResponse<Ticket> = {
  data: [{ ...FIXTURE_TICKET_1, id: 'tkt_test_003', title: 'Ticket 3' }],
  pagination: { nextCursor: null },
};

// ── Agents ─────────────────────────────────────────────────────────────────────

export const FIXTURE_AGENT_1: Agent = {
  id: 'usr_agent_001',
  name: 'Alice Agent',
  email: 'alice@example.invalid',
  role: 'agent',
  tenantId: 'tnt_test_001',
  organizationIds: ['org_alpha_001'],
  orgScopeVersion: 1,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

// ── Error Envelopes ────────────────────────────────────────────────────────────

export function makeErrorEnvelope(
  code: string,
  message: string,
  overrides?: Partial<ApiErrorEnvelope['error']>,
): ApiErrorEnvelope {
  return {
    error: {
      code,
      message,
      traceId: 'trace_test_' + code.toLowerCase(),
      details: [],
      ...overrides,
    },
  };
}

export const FIXTURE_401_EXPIRED = makeErrorEnvelope(
  'AUTH_TOKEN_EXPIRED',
  'Access token has expired',
);

export const FIXTURE_401_SCOPE_CHANGED = makeErrorEnvelope(
  'AUTH_REAUTHORIZE_REQUIRED',
  'Organization scope has changed, please re-authorize',
  { details: [{ reason: 'scope_changed' }] },
);

export const FIXTURE_401_UNKNOWN = makeErrorEnvelope(
  'UNKNOWN_AUTH_ERROR',
  'Authentication failed',
);

export const FIXTURE_403 = makeErrorEnvelope(
  'FORBIDDEN',
  'You do not have permission to perform this action',
);

export const FIXTURE_404 = makeErrorEnvelope(
  'RESOURCE_NOT_FOUND',
  'The requested resource was not found',
);

export const FIXTURE_409 = makeErrorEnvelope(
  'OPTIMISTIC_LOCK_CONFLICT',
  'The resource was modified since you last read it',
  { currentVersion: '3' },
);

export const FIXTURE_422 = makeErrorEnvelope(
  'BUSINESS_RULE_VIOLATION',
  'Cannot close a ticket with open sub-tasks',
);

export const FIXTURE_429 = makeErrorEnvelope(
  'AUTH_RATE_LIMITED',
  'Too many attempts. Please try again later.',
);

export const FIXTURE_500 = makeErrorEnvelope(
  'INTERNAL_ERROR',
  'An internal server error occurred',
);

export const FIXTURE_VALIDATION_400 = makeErrorEnvelope(
  'VALIDATION_ERROR',
  'Request validation failed',
  {
    details: [
      { field: 'title', message: 'Title is required' },
      { field: 'priority', message: 'Invalid priority value' },
    ],
  },
);
