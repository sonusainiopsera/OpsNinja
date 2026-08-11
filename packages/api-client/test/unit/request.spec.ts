import { describe, it, expect, vi } from 'vitest';
import { request } from '../../src/transport/request';
import { ApiError } from '../../src/errors/ApiError';
import type { ClientConfig } from '../../src/transport/request';

function makeJsonFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    }),
  );
}

const BASE_CONFIG: ClientConfig = { baseUrl: 'http://api.test', timeoutMs: 5_000 };

describe('request — success paths', () => {
  it('returns parsed JSON for 200', async () => {
    const fetchFn = makeJsonFetch(200, { id: '1', name: 'Alice' });
    const config = { ...BASE_CONFIG, fetch: fetchFn };
    const result = await request<{ id: string; name: string }>(config, { path: '/api/v1/users/1' });
    expect(result).toEqual({ id: '1', name: 'Alice' });
  });

  it('sends credentials: include', async () => {
    const fetchFn = makeJsonFetch(200, {});
    const config = { ...BASE_CONFIG, fetch: fetchFn };
    await request(config, { path: '/api/v1/test' });
    const [, init] = fetchFn.mock.calls[0];
    expect(init.credentials).toBe('include');
  });

  it('sends X-Correlation-Id header', async () => {
    const fetchFn = makeJsonFetch(200, {});
    const config = { ...BASE_CONFIG, fetch: fetchFn };
    await request(config, { path: '/api/v1/test' });
    const [, init] = fetchFn.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get('x-correlation-id')).toBeTruthy();
  });

  it('sends Accept: application/json', async () => {
    const fetchFn = makeJsonFetch(200, {});
    const config = { ...BASE_CONFIG, fetch: fetchFn };
    await request(config, { path: '/api/v1/test' });
    const [, init] = fetchFn.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get('accept')).toBe('application/json');
  });

  it('sends Content-Type for POST with body', async () => {
    const fetchFn = makeJsonFetch(201, { id: '1' });
    const config = { ...BASE_CONFIG, fetch: fetchFn };
    await request(config, { method: 'POST', path: '/api/v1/tickets', body: { title: 'T' } });
    const [, init] = fetchFn.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('appends query params to URL', async () => {
    const fetchFn = makeJsonFetch(200, { data: [] });
    const config = { ...BASE_CONFIG, fetch: fetchFn };
    await request(config, { path: '/api/v1/tickets', params: { limit: 10, cursor: 'abc' } });
    const [url] = fetchFn.mock.calls[0];
    expect(url).toContain('limit=10');
    expect(url).toContain('cursor=abc');
  });
});

describe('request — error paths', () => {
  it('throws ApiError for 404', async () => {
    const fetchFn = makeJsonFetch(404, { error: { code: 'NOT_FOUND', message: 'Not found', traceId: 'x' } });
    const config = { ...BASE_CONFIG, fetch: fetchFn };
    await expect(request(config, { path: '/api/v1/tickets/x' })).rejects.toBeInstanceOf(ApiError);
    await expect(request({ ...BASE_CONFIG, fetch: makeJsonFetch(404, { error: { code: 'NOT_FOUND', message: 'NF', traceId: 't1' } }) }, { path: '/api/v1/tickets/x' }))
      .rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('throws ApiError for 401', async () => {
    const fetchFn = makeJsonFetch(401, { error: { code: 'AUTH_TOKEN_EXPIRED', message: 'Expired', traceId: 't2' } });
    await expect(request({ ...BASE_CONFIG, fetch: fetchFn }, { path: '/api/v1/test' }))
      .rejects.toMatchObject({ status: 401, code: 'AUTH_TOKEN_EXPIRED' });
  });

  it('throws ApiError for 500', async () => {
    const fetchFn = makeJsonFetch(500, { error: { code: 'SERVER_ERROR', message: 'Oops', traceId: 't3' } });
    await expect(request({ ...BASE_CONFIG, fetch: fetchFn }, { path: '/api/v1/test' }))
      .rejects.toMatchObject({ status: 500 });
  });

  it('throws RESPONSE_PARSE_ERROR for HTML body on 200', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response('<html>Oops</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );
    await expect(request({ ...BASE_CONFIG, fetch: fetchFn }, { path: '/api/v1/test' }))
      .rejects.toMatchObject({ code: 'RESPONSE_PARSE_ERROR' });
  });

  it('throws NETWORK_ERROR for fetch rejection', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
    await expect(request({ ...BASE_CONFIG, fetch: fetchFn }, { path: '/api/v1/test' }))
      .rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });

  it('throws REQUEST_ABORTED when external signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchFn = makeJsonFetch(200, {});
    await expect(request({ ...BASE_CONFIG, fetch: fetchFn }, { path: '/api/v1/test', signal: controller.signal }))
      .rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
  });

  it('preserves traceId from error envelope', async () => {
    const fetchFn = makeJsonFetch(422, { error: { code: 'BIZ_RULE', message: 'Nope', traceId: 'trace-xyz' } });
    await expect(request({ ...BASE_CONFIG, fetch: fetchFn }, { path: '/api/v1/test' }))
      .rejects.toMatchObject({ traceId: 'trace-xyz' });
  });
});
