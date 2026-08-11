import { http, HttpResponse } from 'msw';
import {
  FIXTURE_PRINCIPAL,
  FIXTURE_TICKETS_PAGE_1,
  FIXTURE_TICKETS_PAGE_2,
  FIXTURE_TICKET_1,
  FIXTURE_TICKET_UPDATED,
  FIXTURE_401_EXPIRED,
  FIXTURE_401_SCOPE_CHANGED,
  FIXTURE_403,
  FIXTURE_404,
  FIXTURE_409,
  FIXTURE_422,
  FIXTURE_429,
  FIXTURE_500,
  FIXTURE_VALIDATION_400,
} from '../fixtures/api.fixtures';

const BASE = 'http://localhost:3001';

/**
 * MSW handlers for the OpsNinja API /api/v1 surface.
 * Validated against the OpenAPI 3.1 contract shapes.
 */
export const defaultHandlers = [
  // Auth: me
  http.get(`${BASE}/api/v1/auth/me`, () =>
    HttpResponse.json(FIXTURE_PRINCIPAL),
  ),

  // Auth: refresh (success by default — override in specific tests)
  http.post(`${BASE}/api/v1/auth/refresh`, () =>
    HttpResponse.json({ accessToken: 'new_access_token_fixture' }),
  ),

  // Auth: logout
  http.post(`${BASE}/api/v1/auth/logout`, () =>
    new HttpResponse(null, { status: 204 }),
  ),

  // Tickets: list (paginated)
  http.get(`${BASE}/api/v1/tickets`, ({ request }) => {
    const url = new URL(request.url);
    const cursor = url.searchParams.get('cursor');
    if (cursor === 'cursor_page_2') {
      return HttpResponse.json(FIXTURE_TICKETS_PAGE_2);
    }
    return HttpResponse.json(FIXTURE_TICKETS_PAGE_1);
  }),

  // Tickets: get one
  http.get(`${BASE}/api/v1/tickets/:id`, ({ params }) => {
    if (params['id'] === 'tkt_test_001') {
      return HttpResponse.json(FIXTURE_TICKET_1);
    }
    return HttpResponse.json(FIXTURE_404, { status: 404 });
  }),

  // Tickets: create
  http.post(`${BASE}/api/v1/tickets`, () =>
    HttpResponse.json(FIXTURE_TICKET_1, { status: 201 }),
  ),

  // Tickets: update (PATCH with version)
  http.patch(`${BASE}/api/v1/tickets/:id`, async ({ request }) => {
    const body = await request.json() as { version?: number };
    if (body.version !== FIXTURE_TICKET_1.version) {
      return HttpResponse.json(FIXTURE_409, { status: 409 });
    }
    return HttpResponse.json(FIXTURE_TICKET_UPDATED);
  }),
];

/**
 * Error scenario handlers — compose with defaultHandlers to override specific routes.
 */
export const errorHandlers = {
  /** Token expired 401 on any tickets GET */
  ticketsExpired401: http.get(`${BASE}/api/v1/tickets`, () =>
    HttpResponse.json(FIXTURE_401_EXPIRED, { status: 401 }),
  ),

  /** Scope-changed 401 on any tickets GET */
  ticketsScopeChanged401: http.get(`${BASE}/api/v1/tickets`, () =>
    HttpResponse.json(FIXTURE_401_SCOPE_CHANGED, { status: 401 }),
  ),

  /** Refresh fails with 401 */
  refreshFails401: http.post(`${BASE}/api/v1/auth/refresh`, () =>
    HttpResponse.json(FIXTURE_401_EXPIRED, { status: 401 }),
  ),

  /** 403 on tickets list */
  ticketsForbidden: http.get(`${BASE}/api/v1/tickets`, () =>
    HttpResponse.json(FIXTURE_403, { status: 403 }),
  ),

  /** 404 on specific ticket */
  ticketNotFound: http.get(`${BASE}/api/v1/tickets/:id`, () =>
    HttpResponse.json(FIXTURE_404, { status: 404 }),
  ),

  /** 409 on ticket update */
  ticketConflict: http.patch(`${BASE}/api/v1/tickets/:id`, () =>
    HttpResponse.json(FIXTURE_409, { status: 409 }),
  ),

  /** 422 on ticket create */
  ticketsBusinessRule: http.post(`${BASE}/api/v1/tickets`, () =>
    HttpResponse.json(FIXTURE_422, { status: 422 }),
  ),

  /** 429 with Retry-After on tickets list */
  ticketsRateLimited: http.get(`${BASE}/api/v1/tickets`, () =>
    HttpResponse.json(FIXTURE_429, {
      status: 429,
      headers: { 'Retry-After': '5' },
    }),
  ),

  /** 500 on tickets list */
  ticketsServerError: http.get(`${BASE}/api/v1/tickets`, () =>
    HttpResponse.json(FIXTURE_500, { status: 500 }),
  ),

  /** 400 validation error on ticket create */
  ticketsValidationError: http.post(`${BASE}/api/v1/tickets`, () =>
    HttpResponse.json(FIXTURE_VALIDATION_400, { status: 400 }),
  ),
};
