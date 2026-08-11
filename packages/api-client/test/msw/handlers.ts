/**
 * MSW v2 request handlers for api-client integration tests.
 *
 * Handlers cover:
 *   - GET /api/v1/tickets (paginated, with cursor support)
 *   - GET /api/v1/tickets/:id (detail, including 404 and 409)
 *   - PUT /api/v1/tickets/:id (409 conflict)
 *   - POST /api/v1/auth/refresh (success, 401, and 429)
 *   - All error status codes (400, 401, 403, 404, 409, 422, 429, 500)
 */

import { http, HttpResponse } from 'msw';
import { fixtures } from './fixtures';

export const BASE_URL = 'http://localhost:3000';

export const handlers = [
  // ── Tickets list (paginated) ─────────────────────────────────────────────
  http.get(`${BASE_URL}/api/v1/tickets`, ({ request }) => {
    const url = new URL(request.url);
    const cursor = url.searchParams.get('cursor');
    if (cursor === 'cursor-page-2') {
      return HttpResponse.json(fixtures.ticketListPage2);
    }
    return HttpResponse.json(fixtures.ticketList);
  }),

  // ── Ticket detail ────────────────────────────────────────────────────────
  http.get(`${BASE_URL}/api/v1/tickets/:id`, ({ params }) => {
    if (params['id'] === 'not-found') {
      return HttpResponse.json(fixtures.err404, { status: 404 });
    }
    return HttpResponse.json(fixtures.ticketDetail);
  }),

  // ── Ticket update (409 conflict) ─────────────────────────────────────────
  http.put(`${BASE_URL}/api/v1/tickets/:id`, () => {
    return HttpResponse.json(fixtures.err409, { status: 409 });
  }),

  // ── Auth refresh ─────────────────────────────────────────────────────────
  http.post(`${BASE_URL}/api/v1/auth/refresh`, () => {
    return HttpResponse.json(fixtures.refreshSuccess);
  }),

  // ── Error status handlers (used by override in tests) ────────────────────
  http.get(`${BASE_URL}/api/v1/error/400`, () =>
    HttpResponse.json(fixtures.err400, { status: 400 }),
  ),
  http.get(`${BASE_URL}/api/v1/error/401-expired`, () =>
    HttpResponse.json(fixtures.err401Expired, { status: 401 }),
  ),
  http.get(`${BASE_URL}/api/v1/error/401-scope`, () =>
    HttpResponse.json(fixtures.err401ScopeChanged, { status: 401 }),
  ),
  http.get(`${BASE_URL}/api/v1/error/401-unknown`, () =>
    HttpResponse.json(fixtures.err401Unknown, { status: 401 }),
  ),
  http.get(`${BASE_URL}/api/v1/error/403`, () =>
    HttpResponse.json(fixtures.err403, { status: 403 }),
  ),
  http.get(`${BASE_URL}/api/v1/error/404`, () =>
    HttpResponse.json(fixtures.err404, { status: 404 }),
  ),
  http.get(`${BASE_URL}/api/v1/error/409`, () =>
    HttpResponse.json(fixtures.err409, { status: 409 }),
  ),
  http.get(`${BASE_URL}/api/v1/error/422`, () =>
    HttpResponse.json(fixtures.err422, { status: 422 }),
  ),
  http.get(`${BASE_URL}/api/v1/error/429`, () =>
    HttpResponse.json(fixtures.err429, {
      status: 429,
      headers: { 'Retry-After': '30' },
    }),
  ),
  http.get(`${BASE_URL}/api/v1/error/500`, () =>
    HttpResponse.json(fixtures.err500, { status: 500 }),
  ),
  // Non-JSON body
  http.get(`${BASE_URL}/api/v1/error/html`, () =>
    new HttpResponse('<html><body>Bad Gateway</body></html>', {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    }),
  ),
  // Empty body
  http.get(`${BASE_URL}/api/v1/error/empty`, () =>
    new HttpResponse(null, { status: 503 }),
  ),
];
