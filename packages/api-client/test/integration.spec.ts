/**
 * MSW-backed integration tests (AC14 / AC15).
 *
 * Uses real MSW handlers and exercises the full request → error parsing → session path.
 * Verifies:
 *   - Successful list request returns typed data
 *   - Paginated follow-up with cursor
 *   - 401 expired → refresh → replay
 *   - Scope-changed 401 → reauthorization-required, no refresh
 *   - 409 conflict surfaces currentVersion
 *   - 429 with Retry-After carries retryAfterMs
 *   - HTML error page produces ApiError (not a parse exception)
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { handlers, BASE_URL } from './msw/handlers';
import { fixtures } from './msw/fixtures';
import { createRequestFn } from '../src/transport/request';
import { SessionManager } from '../src/session/SessionManager';
import { ApiError } from '../src/errors/ApiError';

const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const request = createRequestFn({ baseUrl: BASE_URL });

describe('Integration — successful requests', () => {
  it('GET /api/v1/tickets returns ticket list', async () => {
    const data = await request<typeof fixtures.ticketList>({ path: '/api/v1/tickets' });
    expect(data.data).toHaveLength(2);
    expect(data.pagination.nextCursor).toBe('cursor-page-2');
  });

  it('cursor pagination fetches page 2', async () => {
    const data = await request<typeof fixtures.ticketListPage2>({
      path: '/api/v1/tickets',
      query: { cursor: 'cursor-page-2', limit: 20 },
    });
    expect(data.data).toHaveLength(1);
    expect(data.pagination.nextCursor).toBeNull();
  });
});

describe('Integration — status taxonomy', () => {
  it('400 produces validation ApiError', async () => {
    await expect(request({ path: '/api/v1/error/400' })).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.isValidationError() && e.traceId === 'trace-400',
    );
  });

  it('403 produces forbidden ApiError', async () => {
    await expect(request({ path: '/api/v1/error/403' })).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.isForbidden(),
    );
  });

  it('404 produces notFound ApiError', async () => {
    await expect(request({ path: '/api/v1/error/404' })).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.isNotFound(),
    );
  });

  it('409 produces conflict ApiError with currentVersion', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/error/409`, () =>
        HttpResponse.json(fixtures.err409, { status: 409 }),
      ),
    );
    await expect(request({ path: '/api/v1/error/409' })).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.isConflict() && e.currentVersion === 'v4',
    );
  });

  it('422 produces business rule ApiError', async () => {
    await expect(request({ path: '/api/v1/error/422' })).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.isBusinessRule(),
    );
  });

  it('429 carries retryAfterMs from Retry-After header', async () => {
    await expect(request({ path: '/api/v1/error/429' })).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.isRateLimited() && (e as ApiError).retryAfterMs === 30_000,
    );
  });

  it('HTML error page produces ApiError without throwing parse error', async () => {
    await expect(request({ path: '/api/v1/error/html' })).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.status === 502,
    );
  });

  it('empty body produces ApiError', async () => {
    await expect(request({ path: '/api/v1/error/empty' })).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.status === 503,
    );
  });
});

describe('Integration — session / 401 handling', () => {
  it('401 expired → refresh → replay succeeds', async () => {
    let firstCall = true;
    server.use(
      http.get(`${BASE_URL}/api/v1/tickets`, () => {
        if (firstCall) {
          firstCall = false;
          return HttpResponse.json(fixtures.err401Expired, { status: 401 });
        }
        return HttpResponse.json(fixtures.ticketList);
      }),
    );

    let refreshCalls = 0;
    server.use(
      http.post(`${BASE_URL}/api/v1/auth/refresh`, () => {
        refreshCalls++;
        return HttpResponse.json(fixtures.refreshSuccess);
      }),
    );

    const sm = new SessionManager({ request });
    const data = await sm.execute<typeof fixtures.ticketList>({ path: '/api/v1/tickets' });
    expect(data.data).toHaveLength(2);
    expect(refreshCalls).toBe(1);
  });

  it('scope-changed 401 emits reauthorization-required, no refresh', async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/tickets`, () =>
        HttpResponse.json(fixtures.err401ScopeChanged, { status: 401 }),
      ),
    );

    let refreshCalls = 0;
    server.use(
      http.post(`${BASE_URL}/api/v1/auth/refresh`, () => {
        refreshCalls++;
        return HttpResponse.json(fixtures.refreshSuccess);
      }),
    );

    const sm = new SessionManager({ request });
    const events: string[] = [];
    sm.on((e) => events.push(e));

    await expect(sm.execute({ path: '/api/v1/tickets' })).rejects.toBeInstanceOf(ApiError);
    expect(refreshCalls).toBe(0);
    expect(events).toContain('reauthorization-required');
  });
});
