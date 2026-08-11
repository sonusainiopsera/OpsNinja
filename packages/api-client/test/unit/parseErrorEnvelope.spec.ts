import { describe, it, expect } from 'vitest';
import { parseErrorEnvelope } from '../../src/errors/parseErrorEnvelope';
import { ApiError } from '../../src/errors/ApiError';

function makeResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const jsonBody = body !== null ? JSON.stringify(body) : null;
  return new Response(jsonBody, {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function makeHtmlResponse(status: number): Response {
  return new Response('<html><body>Error</body></html>', {
    status,
    headers: { 'Content-Type': 'text/html' },
  });
}

function makeEmptyResponse(status: number): Response {
  return new Response(null, { status, headers: { 'Content-Type': 'application/json' } });
}

describe('parseErrorEnvelope', () => {
  it('parses a valid error envelope', async () => {
    const res = makeResponse(400, {
      error: { code: 'VALIDATION_ERROR', message: 'Bad input', traceId: 'trace1', details: [{ field: 'name' }] },
    });
    const err = await parseErrorEnvelope(res);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.traceId).toBe('trace1');
    expect(err.details).toHaveLength(1);
  });

  it('includes currentVersion in details for 409', async () => {
    const res = makeResponse(409, {
      error: { code: 'CONFLICT', message: 'Conflict', traceId: 't1', currentVersion: '5' },
    });
    const err = await parseErrorEnvelope(res);
    expect(err.details.some(d => d.field === '_currentVersion' && d.message === '5')).toBe(true);
  });

  it('produces synthetic error for HTML body', async () => {
    const res = makeHtmlResponse(503);
    const err = await parseErrorEnvelope(res);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(503);
    expect(err.code).toBe('RESPONSE_PARSE_ERROR');
  });

  it('produces synthetic error for empty body', async () => {
    const res = makeEmptyResponse(401);
    const err = await parseErrorEnvelope(res);
    expect(err.status).toBe(401);
    expect(err.code).toBe('RESPONSE_PARSE_ERROR');
  });

  it('produces synthetic error for malformed JSON', async () => {
    const res = new Response('not json {{{', {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
    const err = await parseErrorEnvelope(res);
    expect(err.status).toBe(500);
    expect(err.code).toBe('RESPONSE_PARSE_ERROR');
  });

  it('parses Retry-After in delta-seconds for 429', async () => {
    const res = makeResponse(429,
      { error: { code: 'RATE_LIMIT', message: 'slow down' } },
      { 'Retry-After': '30' },
    );
    const err = await parseErrorEnvelope(res);
    expect(err.retryAfterMs).toBe(30_000);
  });

  it('parses Retry-After in HTTP-date for 429', async () => {
    // 60 seconds in the future
    const futureDate = new Date(Date.now() + 60_000).toUTCString();
    const res = makeResponse(429,
      { error: { code: 'RATE_LIMIT', message: 'slow down' } },
      { 'Retry-After': futureDate },
    );
    const err = await parseErrorEnvelope(res);
    expect(err.retryAfterMs).toBeGreaterThan(55_000);
    expect(err.retryAfterMs).toBeLessThan(65_000);
  });

  it('returns 0 retryAfterMs for past HTTP-date (clock skew)', async () => {
    const pastDate = new Date(Date.now() - 10_000).toUTCString();
    const res = makeResponse(429,
      { error: { code: 'RATE_LIMIT', message: 'slow down' } },
      { 'Retry-After': pastDate },
    );
    const err = await parseErrorEnvelope(res);
    expect(err.retryAfterMs).toBe(0);
  });

  it('omits retryAfterMs on non-429 responses', async () => {
    const res = makeResponse(500, { error: { code: 'SERVER_ERROR', message: 'oops' } }, { 'Retry-After': '60' });
    const err = await parseErrorEnvelope(res);
    expect(err.retryAfterMs).toBeUndefined();
  });

  it('produces synthetic error for missing error.code field', async () => {
    const res = makeResponse(400, { error: { message: 'missing code' } });
    const err = await parseErrorEnvelope(res);
    expect(err.code).toBe('RESPONSE_PARSE_ERROR');
  });
});
