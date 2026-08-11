/**
 * MSW JSON fixtures — success envelopes, all error codes, paginated cursors,
 * and refresh outcomes. Used by both unit and integration tests.
 */

export const fixtures = {
  // ── Success responses ────────────────────────────────────────────────────

  ticketList: {
    data: [
      { id: 'ticket-1', subject: 'Login issue', status: 'open', organizationId: 'org-1' },
      { id: 'ticket-2', subject: 'Billing query', status: 'pending', organizationId: 'org-2' },
    ],
    pagination: { nextCursor: 'cursor-page-2' },
  },

  ticketListPage2: {
    data: [
      { id: 'ticket-3', subject: 'Slow dashboard', status: 'open', organizationId: 'org-1' },
    ],
    pagination: { nextCursor: null },
  },

  ticketDetail: {
    id: 'ticket-1',
    subject: 'Login issue',
    status: 'open',
    organizationId: 'org-1',
    version: 'v3',
  },

  refreshSuccess: {
    accessToken: 'new-access-token-stub',
    expiresIn: 900,
    orgScopeVersion: 1,
  },

  // ── Error envelopes ───────────────────────────────────────────────────────

  err400: {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Request body failed schema validation',
      details: [{ field: 'email', message: 'must be a valid email' }],
      traceId: 'trace-400',
    },
  },

  err401Expired: {
    error: {
      code: 'AUTH_TOKEN_EXPIRED',
      message: 'Access token has expired',
      details: [],
      traceId: 'trace-401-expired',
    },
  },

  err401ScopeChanged: {
    error: {
      code: 'AUTH_REAUTHORIZE_REQUIRED',
      message: 'Organization scope has changed — re-authorization required',
      details: [{ reason: 'scope_changed' }],
      traceId: 'trace-401-scope',
    },
  },

  err401Unknown: {
    error: {
      code: 'UNKNOWN_AUTH_CODE',
      message: 'Unrecognised authentication failure',
      details: [],
      traceId: 'trace-401-unknown',
    },
  },

  err403: {
    error: {
      code: 'AUTHZ_PERMISSION_DENIED',
      message: 'You do not have permission to perform this action',
      details: [],
      traceId: 'trace-403',
    },
  },

  err404: {
    error: {
      code: 'RESOURCE_NOT_FOUND',
      message: 'Resource not found',
      details: [],
      traceId: 'trace-404',
    },
  },

  err409: {
    error: {
      code: 'OPTIMISTIC_LOCK_CONFLICT',
      message: 'Ticket was modified by another user — please reload',
      details: [],
      traceId: 'trace-409',
      currentVersion: 'v4',
    },
  },

  err422: {
    error: {
      code: 'BUSINESS_RULE_VIOLATION',
      message: 'Cannot close a ticket that has unresolved sub-tasks',
      details: [],
      traceId: 'trace-422',
    },
  },

  err429: {
    error: {
      code: 'AUTH_RATE_LIMITED',
      message: 'Too many attempts. Please try again later.',
      details: [],
      traceId: 'trace-429',
    },
  },

  err500: {
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
      details: [],
      traceId: 'trace-500',
    },
  },
};
