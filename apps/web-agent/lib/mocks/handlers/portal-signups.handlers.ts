/**
 * MSW handlers for the admin portal-signup approval queue API (WO-091, AC14).
 *
 * Provides fixtures for:
 *   GET  /api/v1/admin/portal-signups
 *   POST /api/v1/admin/portal-signups/:id/approve
 *   POST /api/v1/admin/portal-signups/:id/reject
 */

import { http, HttpResponse } from 'msw';

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const MOCK_PENDING_SIGNUPS = [
  {
    id: 'aa200000-0000-0000-0000-000000000001',
    maskedEmail: 'a***e@acmecorp.com',
    domain: 'acmecorp.com',
    fullName: 'Alice Example',
    status: 'pending_admin_approval',
    createdAt: '2026-08-10T08:00:00.000Z',
    verificationEmailStatus: 'delivered',
    duplicateDomainConflict: false,
    suggestedOrganizations: [
      { id: 'aa100000-0000-0000-0000-000000000001', name: 'Acme Corp', score: 0.9 },
    ],
  },
  {
    id: 'aa200000-0000-0000-0000-000000000002',
    maskedEmail: 'b*b@betainc.com',
    domain: 'betainc.com',
    fullName: 'Bob Beta',
    status: 'pending_admin_approval',
    createdAt: '2026-08-09T14:00:00.000Z',
    verificationEmailStatus: 'delivered',
    duplicateDomainConflict: true,           // duplicate-domain conflict signal
    suggestedOrganizations: [
      { id: 'aa100000-0000-0000-0000-000000000002', name: 'Beta Inc', score: 0.9 },
    ],
  },
  {
    id: 'aa200000-0000-0000-0000-000000000003',
    maskedEmail: 'c***l@oldcorp.net',
    domain: 'oldcorp.net',
    fullName: 'Carol Old',
    status: 'pending_admin_approval',
    createdAt: '2026-07-15T08:00:00.000Z',   // approaching expiry (28 days old)
    verificationEmailStatus: 'bounced',       // hard-bounce surfaced to admin
    duplicateDomainConflict: false,
    suggestedOrganizations: [],
  },
];

const MOCK_ORGANIZATIONS = [
  { id: 'aa100000-0000-0000-0000-000000000001', name: 'Acme Corp', status: 'active' },
  { id: 'aa100000-0000-0000-0000-000000000002', name: 'Beta Inc',  status: 'active' },
];

// ---------------------------------------------------------------------------
// In-memory state for optimistic UI tests
// ---------------------------------------------------------------------------

let pendingSignups = [...MOCK_PENDING_SIGNUPS];

function resetSignups() {
  pendingSignups = [...MOCK_PENDING_SIGNUPS];
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const portalSignupHandlers = [

  // GET /api/v1/admin/portal-signups
  http.get('/api/v1/admin/portal-signups', ({ request }) => {
    const url     = new URL(request.url);
    const status  = url.searchParams.get('status');
    const domain  = url.searchParams.get('domain');
    const limit   = parseInt(url.searchParams.get('limit') ?? '25', 10);
    const cursor  = url.searchParams.get('cursor');

    let items = [...pendingSignups];

    if (status) {
      items = items.filter((s) => s.status === status);
    }
    if (domain) {
      items = items.filter((s) => s.domain.includes(domain));
    }

    // Simulate cursor: start after the item whose id matches the decoded cursor
    if (cursor) {
      const decoded = atob(cursor);
      const [, id] = decoded.split('|');
      const idx = items.findIndex((s) => s.id === id);
      if (idx >= 0) items = items.slice(idx + 1);
    }

    const page = items.slice(0, limit);
    const nextItem = items[limit] ?? null;
    const nextCursor = nextItem
      ? btoa(`${nextItem.createdAt}|${nextItem.id}`)
      : null;

    return HttpResponse.json({ data: page, nextCursor });
  }),

  // POST /api/v1/admin/portal-signups/:id/approve
  http.post('/api/v1/admin/portal-signups/:id/approve', async ({ params, request }) => {
    const { id } = params as { id: string };
    const body = await request.json() as {
      organizationId: string;
      addVerifiedDomain?: boolean;
    };

    const signup = pendingSignups.find((s) => s.id === id);
    if (!signup) {
      return HttpResponse.json(
        { error: { code: 'SIGNUP_NOT_FOUND', message: 'Signup request not found.' } },
        { status: 404 },
      );
    }
    if (signup.status !== 'pending_admin_approval') {
      return HttpResponse.json(
        { error: { code: 'SIGNUP_ALREADY_DECIDED', message: 'This signup request has already been actioned.' } },
        { status: 409 },
      );
    }

    const org = MOCK_ORGANIZATIONS.find((o) => o.id === body.organizationId);
    if (!org) {
      return HttpResponse.json(
        { error: { code: 'ORGANIZATION_NOT_FOUND', message: 'Organization not found in this tenant.' } },
        { status: 404 },
      );
    }

    // Simulate duplicate-domain conflict when addVerifiedDomain=true for betainc.com
    if (body.addVerifiedDomain && signup.domain === 'betainc.com') {
      return HttpResponse.json(
        { error: { code: 'VERIFIED_DOMAIN_CONFLICT', message: 'Another organization already claims this domain.' } },
        { status: 409 },
      );
    }

    // Optimistic removal
    pendingSignups = pendingSignups.filter((s) => s.id !== id);

    const userId = `user-${id}`;
    return HttpResponse.json({
      userId,
      organizationId: body.organizationId,
      activationPath: 'verification_email',
      verifiedDomainAdded: body.addVerifiedDomain === true,
    });
  }),

  // POST /api/v1/admin/portal-signups/:id/reject
  http.post('/api/v1/admin/portal-signups/:id/reject', async ({ params, request }) => {
    const { id } = params as { id: string };
    const body = await request.json() as {
      reason: string;
      note?: string;
      notifyApplicant?: boolean;
    };

    const VALID_REASONS = new Set([
      'not_a_customer',
      'unrecognised_domain',
      'duplicate_request',
      'security_concern',
      'other',
    ]);

    if (!VALID_REASONS.has(body.reason)) {
      return HttpResponse.json(
        { error: { code: 'INVALID_REJECT_REASON', message: 'Reason must be one of the allowed values.' } },
        { status: 422 },
      );
    }

    const signup = pendingSignups.find((s) => s.id === id);
    if (!signup) {
      return HttpResponse.json(
        { error: { code: 'SIGNUP_NOT_FOUND', message: 'Signup request not found.' } },
        { status: 404 },
      );
    }
    if (signup.status !== 'pending_admin_approval') {
      return HttpResponse.json(
        { error: { code: 'SIGNUP_ALREADY_DECIDED', message: 'This signup request has already been actioned.' } },
        { status: 409 },
      );
    }

    // Optimistic removal
    pendingSignups = pendingSignups.filter((s) => s.id !== id);

    return HttpResponse.json({ status: 'rejected' });
  }),
];

// Export reset helper for test setup/teardown
export { resetSignups as resetPortalSignupsMock };
